"""Central audit orchestrator.

Order: batch intake snapshot -> taxonomy resolver -> occurrence collector -> quality auditor
-> origin consistency -> evidence registry. Every step is timed and recorded in the timeline.
Service failures are recorded as steps, never converted into fabricated results.
"""

from __future__ import annotations

import logging
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from ..gbif import GBIFClient, GBIFError, GBIFUnavailableError
from .batches import BatchRepository, completeness_for
from .consistency import evaluate_origin
from .occurrences import search_occurrences
from .record_quality import DEMO_REGION, classify_records
from .registry import build_findings, persist_audit
from .schemas import AuditReport, AuditStep, OccurrenceQualityRequest, OccurrenceSearchResult, TaxonomyResolution, utc_now_iso
from .taxonomy import resolve_taxon
from . import METHOD_VERSION
from .dossier import finalize

log = logging.getLogger("vanasignal.audit")


def _ts() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def run_batch_audit(conn: sqlite3.Connection, client: GBIFClient, batch_id: str, *, refresh: bool = False, uncertainty_threshold_m: float = 5000.0) -> AuditReport:
    repo = BatchRepository(conn)
    batch_read = repo.get(batch_id)  # raises BatchNotFoundError
    batch = repo.raw(batch_id)
    audit_id = f"AUD-{batch_id}-{uuid.uuid4().hex[:10]}"
    created = utc_now_iso()
    timeline: list[AuditStep] = []
    service_error: str | None = None
    occurrence_error: dict[str, Any] | None = None

    def step(name: str, status: str, started: str, detail: str) -> None:
        timeline.append(AuditStep(name=name, status=status, started_at=started, finished_at=_ts(), detail=detail))

    t0 = _ts()
    step("batch_snapshot", "ok", t0, f"Batch {batch_id} read from SQLite; completeness {batch_read.completeness.completeness_share:.0%}.")

    taxonomy: TaxonomyResolution | None = None
    t = _ts()
    try:
        taxonomy = resolve_taxon(client, batch["declared_botanical_name"], allow_stale=not refresh)
        step("taxonomy_resolution", "ok", t, f"{taxonomy.resolution_status}: {taxonomy.explanation}")
    except GBIFError as exc:
        service_error = f"GBIF Species API error: {exc}"
        step("taxonomy_resolution", "failed", t, service_error)
        log.warning("taxonomy failed for %s: %s", batch_id, exc)

    search: OccurrenceSearchResult | None = None
    quality = None
    t = _ts()
    if taxonomy is None or taxonomy.taxon_key is None:
        step("occurrence_retrieval", "skipped", t, "No confirmed accepted taxon; occurrence search not run.")
    elif batch["latitude"] is None or batch["longitude"] is None:
        step("occurrence_retrieval", "skipped", t, "No declared coordinates; search area cannot be defined.")
    else:
        try:
            search = search_occurrences(client, taxonomy.taxon_key, batch["latitude"], batch["longitude"], 100.0, limit=300, refresh=refresh)
            detail = f"{search.returned_count} of {search.gbif_total_count} GBIF records retrieved ({search.data_mode})."
            if search.cached_note:
                detail += " " + search.cached_note
            step("occurrence_retrieval", "ok", t, detail)
        except GBIFError as exc:
            occurrence_error = {"code": "gbif_unavailable" if isinstance(exc, GBIFUnavailableError) else "gbif_error", "message": str(exc)}
            service_error = f"GBIF Occurrence API error: {exc}"
            step("occurrence_retrieval", "failed", t, service_error)
            log.warning("occurrence retrieval failed for %s: %s", batch_id, exc)

    t = _ts()
    if search is not None:
        quality = classify_records(
            OccurrenceQualityRequest(
                records=search.records,
                declared_latitude=batch["latitude"],
                declared_longitude=batch["longitude"],
                uncertainty_threshold_m=uncertainty_threshold_m,
            ),
            DEMO_REGION["bbox"],
        )
        step("occurrence_quality", "ok", t, f"Classified {quality.records_total} records: {quality.counts}.")
    else:
        step("occurrence_quality", "skipped", t, "No retrieved records to classify.")

    t = _ts()
    origin = evaluate_origin(
        declared_latitude=batch["latitude"],
        declared_longitude=batch["longitude"],
        taxonomy=taxonomy,
        search=search,
        quality=quality,
        service_error=service_error,
    )
    step("origin_consistency", "ok", t, f"Origin status {origin.status}.")

    completeness = completeness_for(batch)
    report = AuditReport(
        audit_id=audit_id,
        batch_id=batch_id,
        created_at=created,
        method_version=METHOD_VERSION,
        batch_snapshot={k: batch[k] for k in batch if k not in ("created_at", "updated_at")},
        batch_completeness=completeness,
        taxonomy=taxonomy,
        occurrence_search=search,
        occurrence_error=occurrence_error,
        quality=quality,
        origin=origin,
        overall_status="",
        findings=[],
        timeline=timeline,
        unresolved_questions=[],
        scientific_limitations=[],
        sources=[],
    )
    report = build_findings(report)
    report = finalize(report)
    persist_audit(conn, report)
    log.info("audit %s batch=%s origin=%s identity=%s", audit_id, batch_id, origin.status, taxonomy.resolution_status if taxonomy else "NOT_RUN")
    return report
