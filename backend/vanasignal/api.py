"""FastAPI service: thin transport layer over the analytical modules."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from . import benchmark as bm
from .config import Settings, get_settings
from .gbif import GBIFClient, GBIFError, GBIFUnavailableError, SpeciesNotResolvedError
from .models import AnalysisRequest, BenchmarkRequest, ResolveSpeciesRequest, SimulationRequest
from .pipeline import GBIFSource, NoRecordsError, PipelineOptions, load_run, run_analysis
from .regions import REGION_PRESETS
from .simulate import UnknownCellError, simulate_survey_plan
from .spatial import GridTooLargeError, PriorityConfig, land_union

EXPORTS = {
    "occurrences.csv": ("text/csv", "occurrences"),
    "occurrences.geojson": ("application/geo+json", "occurrences"),
    "grid.geojson": ("application/geo+json", "grid"),
    "grid_metrics.csv": ("text/csv", "grid_metrics"),
    "manifest.json": ("application/json", "manifest"),
    "report.md": ("text/markdown", "report"),
}


def create_app(settings: Settings | None = None, client: GBIFClient | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="VanaSignal API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    state: dict[str, Any] = {"client": client}

    def gbif() -> GBIFClient:
        if state["client"] is None:
            state["client"] = GBIFClient(settings.cache_dir)
        return state["client"]

    def opts() -> PipelineOptions:
        return PipelineOptions(
            out_root=settings.runs_dir,
            land_mask_path=settings.land_mask_path,
            wdpa_path=settings.wdpa_path,
            priority=PriorityConfig(),
        )

    def run_dir(run_id: str) -> Path:
        if not run_id.isalnum() or len(run_id) != 16:
            raise HTTPException(status_code=400, detail={"code": "invalid_run_id"})
        path = settings.runs_dir / run_id
        if not (path / "summary.json").exists():
            raise HTTPException(status_code=404, detail={"code": "run_not_found", "message": f"No analysis run {run_id}."})
        return path

    @app.exception_handler(GBIFUnavailableError)
    async def _gbif_down(_: Request, exc: GBIFUnavailableError):
        return JSONResponse(status_code=503, content={"code": "gbif_unavailable", "message": str(exc)})

    @app.exception_handler(GBIFError)
    async def _gbif_error(_: Request, exc: GBIFError):
        return JSONResponse(status_code=502, content={"code": "gbif_error", "message": str(exc)})

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        probe = GBIFClient(settings.cache_dir, timeout=8.0, max_retries=0)
        try:
            gbif_status = probe.health()
        finally:
            probe.close()
        return {
            "status": "ok",
            "gbif": gbif_status,
            "land_mask_configured": True,
            "protected_areas_configured": settings.wdpa_path is not None,
            "runs_stored": len(list(settings.runs_dir.glob("*/summary.json"))),
        }

    @app.get("/api/regions")
    def regions() -> list[dict[str, Any]]:
        return REGION_PRESETS

    @app.post("/api/species/resolve")
    def resolve(body: ResolveSpeciesRequest) -> dict[str, Any]:
        try:
            resolved = gbif().resolve_species(body.name)
        except SpeciesNotResolvedError as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "species_not_resolved", "message": str(exc), "suggestions": [s.model_dump() for s in exc.suggestions]},
            ) from exc
        return resolved.model_dump(mode="json")

    @app.post("/api/analyses", status_code=201)
    def create_analysis(body: AnalysisRequest) -> dict[str, Any]:
        try:
            return run_analysis(body, GBIFSource(gbif()), opts())
        except SpeciesNotResolvedError as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "species_not_resolved", "message": str(exc), "suggestions": [s.model_dump() for s in exc.suggestions]},
            ) from exc
        except NoRecordsError as exc:
            raise HTTPException(status_code=404, detail={"code": "no_records", "message": str(exc)}) from exc
        except GridTooLargeError as exc:
            raise HTTPException(status_code=422, detail={"code": "region_too_large", "message": str(exc)}) from exc

    @app.get("/api/analyses")
    def list_analyses() -> list[dict[str, Any]]:
        rows = []
        for path in sorted(settings.runs_dir.glob("*/summary.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            s = json.loads(path.read_text(encoding="utf-8"))
            rows.append({
                "run_id": s["run_id"],
                "species": s["resolved_species"]["scientific_name"],
                "created_at": s["created_at"],
                "records_usable": s["quality_audit"]["records_usable"],
                "data_source_kind": s.get("data_source_kind"),
                "bbox": s["request"]["bbox"],
            })
        return rows

    @app.get("/api/analyses/{run_id}")
    def get_analysis(run_id: str) -> dict[str, Any]:
        run_dir(run_id)  # validates the id and existence
        return load_run(settings.runs_dir, run_id)

    @app.get("/api/analyses/{run_id}/grid")
    def grid_geojson(run_id: str) -> Response:
        return _file_response(run_dir(run_id) / "grid.geojson", "application/geo+json")

    @app.get("/api/analyses/{run_id}/occurrences")
    def occurrences_geojson(run_id: str) -> Response:
        return _file_response(run_dir(run_id) / "occurrences.geojson", "application/geo+json")

    @app.get("/api/analyses/{run_id}/manifest")
    def manifest(run_id: str) -> dict[str, Any]:
        return json.loads((run_dir(run_id) / "manifest.json").read_text(encoding="utf-8"))

    @app.get("/api/analyses/{run_id}/report")
    def report(run_id: str) -> PlainTextResponse:
        return PlainTextResponse((run_dir(run_id) / "report.md").read_text(encoding="utf-8"), media_type="text/markdown")

    @app.get("/api/analyses/{run_id}/export/{name}")
    def export(run_id: str, name: str) -> Response:
        path = run_dir(run_id)
        if name == "candidates.csv":
            summary = json.loads((path / "summary.json").read_text(encoding="utf-8"))
            return Response(_candidates_csv(summary["candidates"]), media_type="text/csv",
                            headers={"Content-Disposition": f'attachment; filename="{run_id}-candidates.csv"'})
        if name not in EXPORTS:
            raise HTTPException(status_code=404, detail={"code": "unknown_export"})
        media, _ = EXPORTS[name]
        return _file_response(path / name, media, download_name=f"{run_id}-{name}")

    @app.post("/api/analyses/{run_id}/simulate")
    def simulate(run_id: str, body: SimulationRequest) -> dict[str, Any]:
        path = run_dir(run_id)
        metrics = pd.read_csv(path / "grid_metrics.csv", dtype={"cell": str})
        try:
            return simulate_survey_plan(metrics, body.cell_ids, body.detection_probability, body.visits, body.occupancy_scenarios)
        except UnknownCellError as exc:
            raise HTTPException(status_code=422, detail={"code": "unknown_cells", "message": str(exc), "cells": exc.missing}) from exc

    @app.post("/api/analyses/{run_id}/benchmark")
    def run_benchmark(run_id: str, body: BenchmarkRequest) -> dict[str, Any]:
        path = run_dir(run_id)
        summary = json.loads((path / "summary.json").read_text(encoding="utf-8"))
        priority = PriorityConfig(**summary["priority_config"])
        req = summary["request"]
        occ = pd.read_csv(path / "occurrences.csv", dtype={"gbif_id": str})
        usable = occ[occ["quality_weight"] > 0].copy()
        grid = pd.read_csv(path / "grid_metrics.csv", dtype={"cell": str})[["cell", "center_lat", "center_lon"]]
        withheld = bm.withheld_experiment(
            usable, grid, req["resolution"], body.seeds, body.test_fraction, sorted(set(body.k_values)),
            body.coverage_radius_km, priority,
        )
        raw = bm.load_raw_records(str(path / "occurrences.csv"))
        quality = bm.quality_experiment(raw, tuple(req["bbox"]), req["uncertainty_threshold_m"], body.fault_rate, land=land_union(settings.land_mask_path))
        result = {
            "run_id": run_id,
            "data_source_kind": summary.get("data_source_kind"),
            "parameters": body.model_dump(),
            "withheld_observation": withheld,
            "quality_detection": quality,
            "limitations": [
                "Benchmarks use only the records retrieved for this run; they are not an external validation.",
                "Occupancy is unknown, so none of these metrics measure ecological accuracy.",
                "Quality detection is measured against injected faults with a known injection log.",
            ],
        }
        (path / "benchmark.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        return result

    @app.get("/api/analyses/{run_id}/benchmark")
    def get_benchmark(run_id: str) -> dict[str, Any]:
        path = run_dir(run_id) / "benchmark.json"
        if not path.exists():
            raise HTTPException(status_code=404, detail={"code": "benchmark_not_run", "message": "Run the benchmark first."})
        return json.loads(path.read_text(encoding="utf-8"))

    return app


def _file_response(path: Path, media_type: str, download_name: str | None = None) -> Response:
    if not path.exists():
        raise HTTPException(status_code=404, detail={"code": "file_missing", "message": path.name})
    headers = {"Content-Disposition": f'attachment; filename="{download_name}"'} if download_name else {}
    return Response(path.read_bytes(), media_type=media_type, headers=headers)


def _candidates_csv(candidates: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    fields = ["rank", "cell", "center_lat", "center_lon", "priority_score", "raw_records", "weighted_records",
              "cell_status", "protected_overlap_share", "explanation", "warnings"]
    writer = csv.DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    for c in candidates:
        writer.writerow({
            **{k: c.get(k) for k in fields if k not in ("explanation", "warnings")},
            "explanation": c["explanation"]["text"],
            "warnings": " | ".join(c["explanation"]["warnings"]),
        })
    return buf.getvalue()


app = create_app()
