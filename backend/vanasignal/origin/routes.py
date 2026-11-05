"""FastAPI routes for the Origin Gate. Transport only: all logic lives in the origin modules."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..config import Settings
from ..gbif import GBIFClient, GBIFError, GBIFUnavailableError
from .audit import run_batch_audit
from .batches import BatchNotFoundError, BatchRepository, DuplicateBatchError
from .db import connect
from .dossier import to_markdown, verify_integrity
from .occurrences import search_occurrences
from .record_quality import DEMO_REGION, classify_records
from .schemas import AuditReport, BatchCreate, BatchRead, BatchUpdate, OccurrenceQualityReport, OccurrenceQualityRequest, OccurrenceSearchResult, TaxonomyResolution
from .taxonomy import TaxonomyConfirmationError, resolve_taxon

log = logging.getLogger("vanasignal.origin.api")
LAND_PATH = Path(__file__).resolve().parents[2] / "data" / "reference" / "ne_50m_land.geojson"


def _gbif_http_error(exc: GBIFError) -> HTTPException:
    if isinstance(exc, GBIFUnavailableError):
        return HTTPException(503, detail={"code": "gbif_unavailable", "message": str(exc), "live_data": False})
    return HTTPException(502, detail={"code": "gbif_error", "message": str(exc), "live_data": False})


def build_origin_router(settings: Settings, client_factory: Callable[[], GBIFClient]) -> APIRouter:
    conn = connect(settings.db_path)
    lock = threading.Lock()
    router = APIRouter()

    def repo() -> BatchRepository:
        return BatchRepository(conn)

    @router.post("/api/batches", response_model=BatchRead, status_code=201, tags=["batches"], summary="Create a medicinal-botanical batch")
    def create_batch(body: BatchCreate) -> BatchRead:
        with lock:
            try:
                return repo().create(body)
            except DuplicateBatchError as exc:
                raise HTTPException(409, detail={"code": "duplicate_batch_id", "message": str(exc)}) from exc

    @router.get("/api/batches", response_model=list[BatchRead], tags=["batches"], summary="List batches with completeness and latest audit status")
    def list_batches() -> list[BatchRead]:
        with lock:
            return repo().list()

    @router.get("/api/batches/{batch_id}", response_model=BatchRead, tags=["batches"])
    def get_batch(batch_id: str) -> BatchRead:
        with lock:
            try:
                return repo().get(batch_id)
            except BatchNotFoundError as exc:
                raise HTTPException(404, detail={"code": "batch_not_found", "message": f"No batch '{batch_id}'."}) from exc

    @router.put("/api/batches/{batch_id}", response_model=BatchRead, tags=["batches"], summary="Replace the editable fields of a batch")
    def update_batch(batch_id: str, body: BatchUpdate) -> BatchRead:
        with lock:
            try:
                return repo().update(batch_id, body)
            except BatchNotFoundError as exc:
                raise HTTPException(404, detail={"code": "batch_not_found", "message": f"No batch '{batch_id}'."}) from exc

    @router.post("/api/batches/{batch_id}/audit", response_model=AuditReport, tags=["audits"],
                 summary="Run the full origin audit for a batch and store it")
    def run_audit(batch_id: str, refresh: bool = Query(False, description="Force a live GBIF request (falls back to a labelled cache entry if the live request fails).")) -> AuditReport:
        with lock:
            try:
                return run_batch_audit(conn, client_factory(), batch_id, refresh=refresh)
            except BatchNotFoundError as exc:
                raise HTTPException(404, detail={"code": "batch_not_found", "message": f"No batch '{batch_id}'."}) from exc

    def _latest(batch_id: str) -> AuditReport:
        row = conn.execute("SELECT report_json FROM audits WHERE batch_id = ? ORDER BY created_at DESC, audit_id DESC LIMIT 1", (batch_id,)).fetchone()
        if row is None:
            raise HTTPException(404, detail={"code": "audit_not_found", "message": "This batch has not been audited yet."})
        return AuditReport.model_validate(json.loads(row["report_json"]))

    @router.get("/api/batches/{batch_id}/audit", response_model=AuditReport, tags=["audits"], summary="Latest stored audit for a batch")
    def get_audit(batch_id: str) -> AuditReport:
        with lock:
            return _latest(batch_id)

    @router.get("/api/batches/{batch_id}/audits", tags=["audits"], summary="Audit history for a batch (newest first)")
    def list_audits(batch_id: str) -> list[dict]:
        with lock:
            rows = conn.execute("SELECT audit_id, created_at, overall_status, origin_status, identity_status, method_version FROM audits WHERE batch_id = ? ORDER BY created_at DESC, audit_id DESC", (batch_id,)).fetchall()
            return [dict(r) for r in rows]

    @router.get("/api/batches/{batch_id}/audit/export.json", tags=["audits"], summary="Download the audit as JSON with an integrity hash")
    def export_json(batch_id: str) -> Response:
        with lock:
            report = _latest(batch_id)
        return Response(report.model_dump_json(indent=2), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{report.audit_id}.json"'})

    @router.get("/api/batches/{batch_id}/audit/export.md", tags=["audits"], summary="Download the readable dossier as Markdown")
    def export_md(batch_id: str) -> Response:
        with lock:
            report = _latest(batch_id)
        return Response(to_markdown(report), media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{report.audit_id}.md"'})

    @router.get("/api/taxonomy/resolve", response_model=TaxonomyResolution, tags=["taxonomy"],
                summary="Resolve a botanical name with the GBIF Species API")
    def resolve(name: str = Query(..., min_length=3, max_length=200), confirm_key: int | None = Query(None, gt=0, description="A GBIF candidate key chosen by a user.")) -> TaxonomyResolution:
        try:
            return resolve_taxon(client_factory(), name, allow_stale=True, confirm_key=confirm_key)
        except TaxonomyConfirmationError as exc:
            raise HTTPException(422, detail={"code": "invalid_candidate", "message": str(exc)}) from exc
        except GBIFError as exc:
            log.warning("taxonomy request failed: %s", exc)
            raise _gbif_http_error(exc) from exc

    @router.get("/api/occurrences/search", response_model=OccurrenceSearchResult, tags=["occurrences"],
                summary="Retrieve GBIF present occurrences around a declared point")
    def occurrences(
        taxon_key: int = Query(..., gt=0),
        lat: float = Query(..., ge=-90, le=90),
        lon: float = Query(..., ge=-180, le=180),
        radius_km: float = Query(50.0, gt=0, le=100),
        limit: int = Query(300, ge=1, le=1000),
        refresh: bool = Query(False),
    ) -> OccurrenceSearchResult:
        try:
            return search_occurrences(client_factory(), taxon_key, lat, lon, radius_km, limit=limit, refresh=refresh)
        except GBIFError as exc:
            log.warning("occurrence request failed: %s", exc)
            raise _gbif_http_error(exc) from exc

    @router.post("/api/audits/occurrence-quality", response_model=OccurrenceQualityReport, tags=["audits"],
                 summary="Classify occurrence records (deterministic, stateless)")
    def quality(body: OccurrenceQualityRequest) -> OccurrenceQualityReport:
        return classify_records(body, DEMO_REGION["bbox"])

    @router.get("/api/context/demonstration-region", tags=["context"], summary="Approximate demonstration region polygon")
    def region() -> dict:
        min_lon, min_lat, max_lon, max_lat = DEMO_REGION["bbox"]
        return {"type": "Feature", "properties": {"name": DEMO_REGION["name"], "approximate": True},
                "geometry": {"type": "Polygon", "coordinates": [[[min_lon, min_lat], [max_lon, min_lat], [max_lon, max_lat], [min_lon, max_lat], [min_lon, min_lat]]]}}

    @router.get("/api/context/land", tags=["context"], summary="Natural Earth 50m land polygons (public domain)")
    def land() -> Response:
        if not LAND_PATH.exists():
            raise HTTPException(404, detail={"code": "context_missing"})
        return Response(LAND_PATH.read_bytes(), media_type="application/geo+json")

    @router.get("/api/integrity/{batch_id}", tags=["audits"], summary="Recompute and verify the stored audit integrity hash")
    def integrity(batch_id: str) -> dict:
        with lock:
            row = conn.execute("SELECT report_json FROM audits WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1", (batch_id,)).fetchone()
        if row is None:
            raise HTTPException(404, detail={"code": "audit_not_found"})
        return {"verified": verify_integrity(json.loads(row["report_json"]))}

    return router
