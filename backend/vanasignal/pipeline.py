"""Central orchestration: species -> occurrences -> audit -> grid -> coverage -> priority -> evidence.

The pipeline depends on a ``RecordSource`` (GBIF in production, a fixture in
tests). Only ``GBIFSource`` can produce records that are labelled as GBIF data,
so test fixtures cannot leak into real analyses.
"""

from __future__ import annotations

import hashlib
import importlib.metadata as md
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import geopandas as gpd
import numpy as np
import pandas as pd

from .gbif import GBIFClient, GBIFError, bbox_to_wkt
from .models import AnalysisRequest, ResolvedSpecies
from .protected import load_protected_areas
from .quality import audit_occurrences
from .spatial import (
    PriorityConfig,
    assign_cells,
    build_grid,
    compute_cell_metrics,
    coverage_stats,
    greedy_candidates,
    land_union,
    load_land_mask,
    protected_overlay,
    DEFAULT_LAND_MASK,
)

TOP_CANDIDATES = 20
MAX_MAP_POINTS = 5000
PIPELINE_VERSION = "0.1.0"


class NoRecordsError(LookupError):
    """GBIF returned no usable georeferenced present records for the request."""


class RecordSource(Protocol):
    def resolve(self, species: str) -> ResolvedSpecies: ...
    def fetch(self, resolved: ResolvedSpecies, bbox: tuple[float, float, float, float], max_records: int) -> tuple[list[dict[str, Any]], dict[str, Any]]: ...
    def counts(self, resolved: ResolvedSpecies, bbox: tuple[float, float, float, float]) -> dict[str, Any]: ...


class GBIFSource:
    """Production record source backed by the live GBIF API (cached on disk)."""

    name = "gbif"

    def __init__(self, client: GBIFClient):
        self.client = client

    def resolve(self, species: str) -> ResolvedSpecies:
        return self.client.resolve_species(species)

    def fetch(self, resolved, bbox, max_records):
        return self.client.fetch_occurrences(resolved.accepted_key, bbox, max_records)

    def counts(self, resolved, bbox) -> dict[str, Any]:
        geometry = bbox_to_wkt(bbox)
        absent_in_region = self.client.count_occurrences(resolved.accepted_key, geometry=geometry, occurrenceStatus="ABSENT")
        no_coordinates_species_wide = self.client.count_occurrences(
            resolved.accepted_key, hasCoordinate="false", occurrenceStatus="PRESENT"
        )
        return {
            "absent_records_with_coordinates_in_region": absent_in_region,
            "present_records_without_coordinates_species_wide": no_coordinates_species_wide,
            "note": "Absence records are reported separately and are not treated as species absence by VanaSignal.",
        }


@dataclass
class PipelineOptions:
    out_root: Path
    land_mask_path: str | None = None
    wdpa_path: str | None = None
    priority: PriorityConfig = PriorityConfig()
    max_grid_cells: int = 50000


def _nan_to_none(v: Any) -> Any:
    if isinstance(v, float) and not np.isfinite(v):
        return None
    return v


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _versions() -> dict[str, str]:
    names = ["pandas", "numpy", "geopandas", "shapely", "h3", "scikit-learn", "httpx", "pydantic"]
    out = {"vanasignal": PIPELINE_VERSION}
    for n in names:
        try:
            out[n] = md.version(n)
        except md.PackageNotFoundError:
            out[n] = "not installed"
    return out


def _explain(row: pd.Series, n_usable_total: int) -> dict[str, Any]:
    raw = int(row["raw_records"])
    nearest = row["nearest_record_km"]
    prot = float(row["protected_overlap_share"])
    parts = [
        (f"{raw} usable record(s) in this cell (quality-weighted {row['weighted_records']:.1f})" if raw else "No usable GBIF record in this cell"),
    ]
    if np.isfinite(nearest):
        parts.append(f"nearest usable record {nearest:.1f} km from the cell centre")
    parts.append(f"questionable share {row['questionable_share']:.2f}")
    text = "; ".join(parts) + "."
    warnings = [
        "Priority measures survey information gain. It is not an ecological probability or a presence/absence estimate.",
    ]
    if raw == 0:
        warnings.append("No record here is not evidence of absence; GBIF sampling is uneven.")
    if prot > 0:
        warnings.append(f"{prot:.0%} of the cell overlaps a protected area. This is context only and does not establish harvest safety.")
    if n_usable_total < 30:
        warnings.append("Few usable records in the analysis; ranking is unstable.")
    return {
        "text": text,
        "indicators": {
            "gap_score": float(row["gap_score"]),
            "isolation_score": float(row["isolation_score"]),
            "quality_deficit": float(row["quality_deficit"]),
            "priority_score": float(row["priority_score"]),
        },
        "warnings": warnings,
    }


def _grid_geojson(grid: gpd.GeoDataFrame) -> dict:
    cols = [
        "cell", "raw_records", "weighted_records", "questionable_share", "nearest_record_km",
        "gap_score", "isolation_score", "quality_deficit", "priority_score", "cell_status",
        "protected_overlap_share", "protected_area_count",
    ]
    return json.loads(grid[cols + ["geometry"]].to_json(na="null", drop_id=True))


def _points_geojson(annotated: pd.DataFrame) -> dict:
    pts = annotated[annotated["quality_weight"] > 0].head(MAX_MAP_POINTS)
    features = []
    for _, r in pts.iterrows():
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
            "properties": {
                "gbif_id": r["gbif_id"],
                "quality_status": r["quality_status"],
                "quality_reasons": r["quality_reasons"],
                "event_date": None if pd.isna(r.get("event_date")) else str(r.get("event_date")),
                "dataset_name": None if pd.isna(r.get("dataset_name")) else str(r.get("dataset_name")),
                "license": None if pd.isna(r.get("license")) else str(r.get("license")),
                "coordinate_uncertainty_m": None if pd.isna(r.get("coordinate_uncertainty_m")) else float(r["coordinate_uncertainty_m"]),
            },
        })
    return {"type": "FeatureCollection", "features": features, "truncated": len(annotated[annotated['quality_weight'] > 0]) > MAX_MAP_POINTS}


def _report_markdown(summary: dict[str, Any], manifest: dict[str, Any]) -> str:
    r = summary["resolved_species"]
    a = summary["quality_audit"]
    c = summary["coverage"]
    lines = [
        f"# VanaSignal analysis report: {r['scientific_name']}",
        "",
        f"Run ID: `{summary['run_id']}`  ",
        f"Created (UTC): {summary['created_at']}  ",
        f"Data source: {summary['data_source']}",
        "",
        "## Taxon",
        f"- Query: `{r['query']}`",
        f"- Accepted GBIF key: {r['accepted_key']} (match: {r['match_type']}, status: {r.get('status')})",
        "",
        "## Study region and grid",
        f"- Bounding box (min_lon, min_lat, max_lon, max_lat): {summary['request']['bbox']}",
        f"- H3 resolution {summary['request']['resolution']} ({c['total_cells']} land cells analysed)",
        "",
        "## Data quality",
        f"- Records retrieved: {a['records_total']} (GBIF total present in region: {summary['gbif_total_count']})",
        f"- Usable (weighted) records: {a['records_usable']} ({a['records_usable_weighted']} weighted)",
        f"- Status counts: {a['status_counts']}",
        f"- Flag counts: {a['flag_counts']}",
        f"- Distinct datasets: {a['distinct_datasets']}",
        f"- Licences of retrieved records: {a['license_counts']}",
        "",
        "## Spatial coverage",
        f"- Occupied cells: {c['occupied_cells']} of {c['total_cells']} ({c['occupied_share']:.1%})",
        f"- Unsurveyed: {c['unsurveyed_cells']}; sparse: {c['sparse_cells']}; covered: {c['covered_cells']}",
        f"- Record-concentration Gini: {c['record_concentration_gini']}",
        "",
        "## Top survey candidates",
    ]
    for cand in summary["candidates"][:10]:
        lines.append(f"{cand['rank']}. `{cand['cell']}` priority {cand['priority_score']:.3f}: {cand['explanation']['text']}")
    lines += ["", "## Warnings and limitations"]
    for w in summary["warnings"]:
        lines.append(f"- {w}")
    lines += [
        "",
        "## Reproduction",
        "Re-run with the same request body against the same GBIF snapshot. The manifest lists every GBIF URL and the SHA-256 of the input record set.",
        "",
        "```json",
        json.dumps(summary["request"], indent=2),
        "```",
        "",
        "VanaSignal scores rank where a survey would add information. They are not ecological probabilities, population estimates, or threat assessments.",
    ]
    return "\n".join(lines) + "\n"


def run_analysis(req: AnalysisRequest, source: RecordSource, opts: PipelineOptions) -> dict[str, Any]:
    """Execute the full workflow and write the evidence bundle. Returns the summary."""
    warnings: list[str] = []
    resolved = source.resolve(req.species)
    warnings.extend(resolved.warnings)

    records, fetch_meta = source.fetch(resolved, req.bbox, req.max_records)
    if not records:
        raise NoRecordsError(
            f"GBIF returned no georeferenced present records for {resolved.scientific_name} in this region. "
            "This is not evidence that the species is absent."
        )
    if fetch_meta.get("truncated"):
        warnings.append(
            f"Retrieval truncated at {fetch_meta['retrieved_count']} of {fetch_meta['gbif_total_count']} GBIF records (max_records). "
            "Coverage reflects only the retrieved subset."
        )

    try:
        absence_counts = source.counts(resolved, req.bbox)
    except GBIFError as exc:
        absence_counts = {"error": str(exc)}
        warnings.append("Absence and no-coordinate counts could not be retrieved from GBIF; they are omitted.")

    df = pd.DataFrame(records)
    land_geom = land_union(opts.land_mask_path)
    annotated, audit = audit_occurrences(df, req.bbox, req.uncertainty_threshold_m, land=land_geom)
    warnings.extend(audit["warnings"])

    usable = annotated[annotated["quality_weight"] > 0].copy()
    usable["cell"] = assign_cells(usable, req.resolution)

    land = load_land_mask(opts.land_mask_path)
    if land is None:
        warnings.append("No land mask loaded: ocean cells inside the bounding box may appear as candidates.")
    grid = build_grid(req.bbox, req.resolution, opts.max_grid_cells, land)
    usable = usable[usable["cell"].isin(set(grid["cell"]))]
    annotated_outside_grid = int(annotated["quality_weight"].gt(0).sum() - len(usable))
    if annotated_outside_grid:
        warnings.append(f"{annotated_outside_grid} usable record(s) fall outside the land grid and were not analysed spatially.")

    metrics = compute_cell_metrics(grid, usable, opts.priority)
    protected_status: dict[str, Any] = {"loaded": False}
    if req.include_protected:
        pa, protected_status = load_protected_areas(opts.wdpa_path, req.bbox)
        metrics = protected_overlay(metrics, pa)
        if not protected_status["loaded"]:
            warnings.append(protected_status["reason"])
    else:
        metrics["protected_overlap_share"] = 0.0
        metrics["protected_area_count"] = 0
        protected_status = {"loaded": False, "reason": "Protected-area overlay disabled by request."}

    coverage = coverage_stats(metrics)
    chosen = greedy_candidates(metrics, TOP_CANDIDATES, min_separation_rings=1)
    by_cell = metrics.set_index("cell")
    candidates = []
    for rank, cell in enumerate(chosen, start=1):
        row = by_cell.loc[cell]
        candidates.append({
            "rank": rank,
            "cell": cell,
            "center_lat": float(row["center_lat"]),
            "center_lon": float(row["center_lon"]),
            "priority_score": float(row["priority_score"]),
            "raw_records": int(row["raw_records"]),
            "weighted_records": float(row["weighted_records"]),
            "cell_status": row["cell_status"],
            "protected_overlap_share": float(row["protected_overlap_share"]),
            "explanation": _explain(row, len(usable)),
        })

    # Content-addressed run id: identical request + identical record set => identical id.
    record_rows = sorted(
        [str(r["gbif_id"]), _nan_to_none(r["lat"]), _nan_to_none(r["lon"]), r["quality_status"]]
        for r in annotated[["gbif_id", "lat", "lon", "quality_status"]].to_dict("records")
    )
    record_digest = hashlib.sha256(_canonical(record_rows).encode()).hexdigest()
    request_payload = req.model_dump(mode="json")
    run_id = hashlib.sha256(_canonical({"request": request_payload, "accepted_key": resolved.accepted_key, "records": record_digest, "config": opts.priority.as_dict(), "v": PIPELINE_VERSION}).encode()).hexdigest()[:16]

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_dir = Path(opts.out_root) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    annotated_out = annotated.copy()
    annotated_out["issues"] = annotated_out["issues"].map(lambda xs: ";".join(xs) if isinstance(xs, list) else "")
    annotated_out.to_csv(run_dir / "occurrences.csv", index=False)
    (run_dir / "occurrences.geojson").write_text(json.dumps(_points_geojson(annotated)), encoding="utf-8")
    (run_dir / "grid.geojson").write_text(json.dumps(_grid_geojson(metrics)), encoding="utf-8")
    metrics.drop(columns="geometry").to_csv(run_dir / "grid_metrics.csv", index=False)

    summary: dict[str, Any] = {
        "run_id": run_id,
        "created_at": created_at,
        "data_source": f"GBIF occurrence search via api.gbif.org (retrieved {fetch_meta['retrieved_at']})" if source.name == "gbif" else f"{source.name} (NOT live GBIF data)",
        "data_source_kind": source.name,
        "request": request_payload,
        "resolved_species": resolved.model_dump(mode="json"),
        "gbif_total_count": fetch_meta.get("gbif_total_count"),
        "absence_and_coordinate_counts": absence_counts,
        "quality_audit": audit,
        "coverage": coverage,
        "protected_areas": protected_status,
        "priority_config": opts.priority.as_dict(),
        "candidates": candidates,
        "warnings": list(dict.fromkeys(warnings)),
        "files": ["occurrences.csv", "occurrences.geojson", "grid.geojson", "grid_metrics.csv", "summary.json", "manifest.json", "report.md"],
    }

    manifest = {
        "run_id": run_id,
        "created_at": created_at,
        "pipeline_version": PIPELINE_VERSION,
        "versions": _versions(),
        "h3_resolution": req.resolution,
        "record_set_sha256": record_digest,
        "request": request_payload,
        "gbif": {
            "species_match_url": resolved.request_url,
            "occurrence_page_urls": fetch_meta.get("page_urls", []),
            "gbif_total_count": fetch_meta.get("gbif_total_count"),
            "retrieved_count": fetch_meta.get("retrieved_count"),
            "truncated": fetch_meta.get("truncated"),
            "retrieved_at": fetch_meta.get("retrieved_at"),
            "licenses": audit["license_counts"],
            "data_policy": "Each record keeps its GBIF key, dataset key, publisher key and licence; see occurrences.csv.",
        },
        "land_mask": {
            "path": str(opts.land_mask_path or DEFAULT_LAND_MASK),
            "sha256": _sha256_file(Path(opts.land_mask_path or DEFAULT_LAND_MASK)) if (opts.land_mask_path or DEFAULT_LAND_MASK).exists() else None,
            "source": "Natural Earth 50m land (public domain), https://www.naturalearthdata.com",
        },
        "protected_areas": protected_status,
        "priority_config": opts.priority.as_dict(),
        "output_sha256": {},
    }
    for name in ["occurrences.csv", "occurrences.geojson", "grid.geojson", "grid_metrics.csv"]:
        manifest["output_sha256"][name] = _sha256_file(run_dir / name)

    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (run_dir / "report.md").write_text(_report_markdown(summary, manifest), encoding="utf-8")
    return summary


def load_run(out_root: Path, run_id: str) -> dict[str, Any]:
    path = Path(out_root) / run_id / "summary.json"
    if not path.exists():
        raise FileNotFoundError(run_id)
    return json.loads(path.read_text(encoding="utf-8"))
