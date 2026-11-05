"""MCP server exposing VanaSignal analytical functions as tools.

The analytical modules do not import this file. Each tool validates its inputs
with pydantic and returns a structured JSON object. Tools that need occurrence
records take them as explicit inputs, so a client can audit exactly what was
analysed. Only ``resolve_species`` and ``fetch_occurrences`` touch GBIF.

Run: ``python -m vanasignal.mcp_server`` (stdio transport).
"""

from __future__ import annotations

import json
from typing import Annotated, Any

import pandas as pd
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from .config import get_settings
from .gbif import GBIFClient, GBIFError, SpeciesNotResolvedError
from .models import AnalysisRequest, SimulationRequest
from .pipeline import load_run
from .protected import load_protected_areas
from .quality import audit_occurrences
from .simulate import simulate_survey_plan
from .spatial import PriorityConfig, assign_cells, build_grid, compute_cell_metrics, coverage_stats, greedy_candidates, land_union, load_land_mask, protected_overlay

mcp = FastMCP("vanasignal")
settings = get_settings()
_gbif: GBIFClient | None = None


def _client() -> GBIFClient:
    global _gbif
    if _gbif is None:
        _gbif = GBIFClient(settings.cache_dir)
    return _gbif


class OccurrenceInput(BaseModel):
    gbif_id: str
    lat: float | None = None
    lon: float | None = None
    coordinate_uncertainty_m: float | None = None
    event_date: str | None = None
    year: int | None = None
    basis_of_record: str | None = None
    occurrence_status: str | None = None
    issues: Annotated[list[str], Field(default_factory=list)]
    dataset_key: str | None = None
    license: str | None = None


class BBoxInput(BaseModel):
    min_lon: Annotated[float, Field(ge=-180, le=180)]
    min_lat: Annotated[float, Field(ge=-90, le=90)]
    max_lon: Annotated[float, Field(ge=-180, le=180)]
    max_lat: Annotated[float, Field(ge=-90, le=90)]

    def tup(self) -> tuple[float, float, float, float]:
        return (self.min_lon, self.min_lat, self.max_lon, self.max_lat)


def _records_frame(records: list[OccurrenceInput]) -> pd.DataFrame:
    return pd.DataFrame([r.model_dump() for r in records])


def _analyse(records: list[OccurrenceInput], bbox: BBoxInput, resolution: int, uncertainty_m: float) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any], dict[str, Any]]:
    req = AnalysisRequest(species="placeholder", bbox=bbox.tup(), resolution=resolution, uncertainty_threshold_m=uncertainty_m)
    annotated, audit = audit_occurrences(_records_frame(records), req.bbox, req.uncertainty_threshold_m, land=land_union(settings.land_mask_path))
    usable = annotated[annotated["quality_weight"] > 0].copy()
    usable["cell"] = assign_cells(usable, resolution)
    grid = build_grid(req.bbox, resolution, land=load_land_mask(settings.land_mask_path))
    usable = usable[usable["cell"].isin(set(grid["cell"]))]
    metrics = compute_cell_metrics(grid, usable, PriorityConfig())
    return annotated, metrics, coverage_stats(metrics), audit


# Parameter types are Annotated so pydantic validates them both over MCP and in direct calls.
Name = Annotated[str, Field(min_length=3, max_length=200, description="Scientific name, e.g. 'Withania somnifera'.")]
Resolution = Annotated[int, Field(ge=3, le=6, description="H3 grid resolution.")]
Uncertainty = Annotated[float, Field(gt=0, le=100000, description="Coordinate uncertainty above which a record is questionable.")]


@mcp.tool()
def resolve_species(name: Name) -> dict[str, Any]:
    """Resolve a scientific name to an accepted GBIF taxon. Returns suggestions when unresolved."""
    try:
        return _client().resolve_species(name).model_dump(mode="json")
    except SpeciesNotResolvedError as exc:
        return {"resolved": False, "message": str(exc), "suggestions": [s.model_dump() for s in exc.suggestions]}
    except GBIFError as exc:
        return {"resolved": False, "error": "gbif_unavailable", "message": str(exc)}


@mcp.tool()
def fetch_occurrences(
    accepted_key: Annotated[int, Field(gt=0, description="Accepted GBIF taxon key from resolve_species.")],
    bbox: BBoxInput,
    max_records: Annotated[int, Field(ge=1, le=5000)] = 500,
) -> dict[str, Any]:
    """Retrieve present, georeferenced GBIF occurrences in the region, with licence and dataset identifiers."""
    try:
        records, meta = _client().fetch_occurrences(accepted_key, bbox.tup(), max_records)
    except GBIFError as exc:
        return {"error": "gbif_unavailable", "message": str(exc)}
    return {"records": records, "meta": meta}


@mcp.tool()
def audit_occurrence_quality(
    records: list[OccurrenceInput],
    bbox: BBoxInput,
    uncertainty_threshold_m: Uncertainty = 5000.0,
) -> dict[str, Any]:
    """Flag missing, invalid, zero, duplicate, out-of-region, uncertain and questionable records."""
    annotated, audit = audit_occurrences(_records_frame(records), bbox.tup(), uncertainty_threshold_m, land=land_union(settings.land_mask_path))
    flagged = annotated[annotated["quality_status"] != "clean"][["gbif_id", "quality_status", "quality_reasons"]]
    return {"summary": audit, "flagged_records": flagged.head(500).to_dict("records")}


@mcp.tool()
def detect_sampling_gaps(
    records: list[OccurrenceInput],
    bbox: BBoxInput,
    resolution: Resolution = 5,
    uncertainty_threshold_m: Uncertainty = 5000.0,
    top_n: Annotated[int, Field(ge=1, le=200)] = 20,
) -> dict[str, Any]:
    """Grid the region and report coverage plus the most underrepresented cells."""
    _, metrics, coverage, _ = _analyse(records, bbox, resolution, uncertainty_threshold_m)
    under = metrics[metrics["cell_status"] == "unsurveyed"].sort_values("priority_score", ascending=False).head(top_n)
    return {"coverage": coverage, "unsurveyed_examples": under[["cell", "priority_score", "nearest_record_km"]].to_dict("records")}


@mcp.tool()
def analyze_protected_overlap(bbox: BBoxInput, resolution: Resolution = 5) -> dict[str, Any]:
    """Protected-area overlap for the grid, using the locally configured WDPA extract only (context, not safety)."""
    pa, status = load_protected_areas(settings.wdpa_path, bbox.tup())
    grid = build_grid(bbox.tup(), resolution, land=load_land_mask(settings.land_mask_path))
    overlap = protected_overlay(grid, pa)
    return {
        "status": status,
        "cells_with_overlap": int((overlap["protected_overlap_share"] > 0).sum()),
        "total_cells": int(len(overlap)),
        "note": "Overlap does not establish that a location is safe for harvesting.",
    }


@mcp.tool()
def rank_survey_locations(
    records: list[OccurrenceInput],
    bbox: BBoxInput,
    resolution: Resolution = 5,
    uncertainty_threshold_m: Uncertainty = 5000.0,
    n: Annotated[int, Field(ge=1, le=50)] = 10,
) -> dict[str, Any]:
    """Rank candidate survey cells by quality-aware priority, with contributing indicators and limitations."""
    _, metrics, _, _ = _analyse(records, bbox, resolution, uncertainty_threshold_m)
    chosen = greedy_candidates(metrics, n, min_separation_rings=1)
    rows = metrics.set_index("cell").loc[chosen].reset_index()
    return {
        "candidates": [
            {
                "rank": i + 1,
                "cell": r["cell"],
                "priority_score": float(r["priority_score"]),
                "indicators": {
                    "gap_score": float(r["gap_score"]),
                    "isolation_score": float(r["isolation_score"]),
                    "quality_deficit": float(r["quality_deficit"]),
                },
                "raw_records": int(r["raw_records"]),
                "limitations": [
                    "Priority is survey information gain, not an occupancy probability.",
                    "GBIF sampling is uneven; a missing record is not an absence.",
                ],
            }
            for i, r in rows.iterrows()
        ]
    }


@mcp.tool(name="simulate_survey_plan")
def simulate_survey_plan_tool(
    records: list[OccurrenceInput],
    bbox: BBoxInput,
    cell_ids: Annotated[list[str], Field(min_length=1, max_length=500)],
    resolution: Resolution = 5,
    detection_probability: Annotated[float, Field(gt=0, le=1)] = 0.3,
    visits: Annotated[int, Field(ge=1, le=30)] = 3,
    occupancy_scenarios: Annotated[list[float], Field(min_length=1, max_length=10)] = [0.05, 0.2, 0.5],
) -> dict[str, Any]:
    """Counterfactual survey simulation under explicit occupancy assumptions (not occupancy estimates)."""
    req = SimulationRequest(cell_ids=cell_ids, detection_probability=detection_probability, visits=visits, occupancy_scenarios=occupancy_scenarios)
    _, metrics, _, _ = _analyse(records, bbox, resolution, 5000.0)
    return simulate_survey_plan(metrics, req.cell_ids, req.detection_probability, req.visits, req.occupancy_scenarios)


@mcp.tool()
def generate_evidence_report(
    run_id: Annotated[str, Field(min_length=16, max_length=16, description="Run id returned by the analysis API.")],
) -> dict[str, Any]:
    """Return the stored summary, manifest and Markdown report of an analysis run."""
    try:
        summary = load_run(settings.runs_dir, run_id)
    except FileNotFoundError:
        return {"error": "run_not_found", "run_id": run_id}
    manifest_path = settings.runs_dir / run_id / "manifest.json"
    report_path = settings.runs_dir / run_id / "report.md"
    return {
        "summary": summary,
        "manifest": json.loads(manifest_path.read_text(encoding="utf-8")),
        "report_markdown": report_path.read_text(encoding="utf-8"),
    }


if __name__ == "__main__":
    mcp.run()
