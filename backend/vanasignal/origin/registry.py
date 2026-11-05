"""Evidence registry: builds traceable findings and stores each audit reproducibly."""

from __future__ import annotations

import json
import sqlite3

from . import METHOD_VERSION
from .schemas import AuditReport, EvidenceFinding


def _fid(audit_id: str, n: int) -> str:
    return f"{audit_id}-F{n:03d}"


def build_findings(report: AuditReport) -> AuditReport:
    findings: list[EvidenceFinding] = []
    add_common = dict(batch_id=report.batch_id, audit_id=report.audit_id, method_version=METHOD_VERSION)

    def add(category, status, explanation, source_name, source_url=None, record_ids=None, retrieved_at=None, limitations=None, review="automated"):
        n = len(findings) + 1
        findings.append(EvidenceFinding(
            finding_id=_fid(report.audit_id, n),
            category=category,
            status=status,
            explanation=explanation,
            source_name=source_name,
            source_url=source_url,
            source_record_ids=record_ids or [],
            retrieved_at=retrieved_at,
            limitations=limitations or [],
            review_state=review,
            **add_common,
        ))

    comp = report.batch_completeness
    if comp.required_missing:
        add("batch_completeness", "REQUIRED_FIELDS_MISSING", f"Required fields missing: {', '.join(comp.required_missing)}.",
            "Batch intake record", limitations=["Documentation completeness is not a quality or sustainability score."],
            review="awaiting_human_review")
    else:
        add("batch_completeness", "REQUIRED_FIELDS_PRESENT",
            f"All required fields are present. Optional fields missing: {', '.join(comp.optional_missing) or 'none'}.",
            "Batch intake record", limitations=["Documentation completeness is not a quality or sustainability score."])

    t = report.taxonomy
    if t is None:
        add("botanical_identity", "NOT_CHECKED", "Identity was not checked: GBIF Species API unavailable.", "GBIF Species API",
            limitations=["No identity result exists for this audit."], review="awaiting_human_review")
    else:
        review = "automated" if t.resolution_status in ("RESOLVED", "SYNONYM_RESOLVED") else "awaiting_human_review"
        add("botanical_identity", t.resolution_status, t.explanation, "GBIF Species API", t.source_url, retrieved_at=t.retrieved_at,
            limitations=["Taxonomy is a naming authority, not evidence of where a specimen was collected."], review=review)

    s = report.occurrence_search
    if report.occurrence_error:
        add("occurrence_retrieval", "FAILED", report.occurrence_error["message"], "GBIF Occurrence API",
            limitations=["No occurrence evidence was retrieved. This is an error state, not an absence result."], review="awaiting_human_review")
    elif s is None:
        add("occurrence_retrieval", "NOT_RUN", "Occurrence search was not run (no confirmed taxon or no declared coordinates).", "GBIF Occurrence API",
            limitations=["Not run is not a result about the species."], review="awaiting_human_review")
    else:
        status = "ZERO_RECORDS" if s.returned_count == 0 else ("CACHED" if s.data_mode == "cached" else ("NON_GBIF_TEST_DATA" if s.data_mode == "non_gbif_test_endpoint" else "RETRIEVED"))
        add("occurrence_retrieval", status,
            f"{s.returned_count} of {s.gbif_total_count} GBIF present records retrieved ({s.data_mode}). " + (s.cached_note or ""),
            "GBIF Occurrence API", s.source_urls[0] if s.source_urls else None,
            record_ids=[r.gbif_id for r in s.records][:50], retrieved_at=s.retrieved_at,
            limitations=[s.absence_note, "GBIF records reflect where people reported the taxon, not where it grows or is harvested."])

    if report.quality:
        q = report.quality
        by_code: dict[str, list[str]] = {}
        for f in q.findings:
            for r in f.reasons:
                by_code.setdefault(r.code, []).append(f.gbif_id)
        for code, ids in sorted(by_code.items()):
            add("occurrence_quality", "FLAGGED", f"{len(ids)} record(s): {code}. Records are retained and labelled, not deleted.",
                "Occurrence quality auditor (rule-based)", record_ids=ids[:50],
                limitations=[f"Rule version {METHOD_VERSION}; rules flag a condition, they do not prove an error."])
        add("occurrence_quality", "SUMMARY", "Class counts: " + ", ".join(f"{k}={v}" for k, v in q.counts.items()),
            "Occurrence quality auditor (rule-based)", limitations=q.limitations)

    o = report.origin
    add("origin_consistency", o.status, o.explanation, "Origin consistency analysis (GBIF occurrences vs declared location)",
        report.occurrence_search.source_urls[0] if report.occurrence_search and report.occurrence_search.source_urls else None,
        retrieved_at=report.occurrence_search.retrieved_at if report.occurrence_search else None,
        limitations=o.limitations, review="awaiting_human_review")

    return report.model_copy(update={"findings": findings})


def persist_audit(conn: sqlite3.Connection, report: AuditReport) -> None:
    conn.execute(
        "INSERT INTO audits (audit_id, batch_id, created_at, method_version, overall_status, origin_status, identity_status, report_json, body_sha256) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (report.audit_id, report.batch_id, report.created_at, report.method_version, report.overall_status,
         report.origin.status, report.taxonomy.resolution_status if report.taxonomy else "NOT_CHECKED",
         json.dumps(report.model_dump(mode="json")), report.integrity["body_sha256"]),
    )
    for f in report.findings:
        conn.execute(
            "INSERT INTO findings (finding_id, audit_id, batch_id, category, status, explanation, source_name, source_url, source_record_ids, "
            "retrieved_at, method_version, limitations, review_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f.finding_id, f.audit_id, f.batch_id, f.category, f.status, f.explanation, f.source_name, f.source_url,
             json.dumps(f.source_record_ids), f.retrieved_at, f.method_version, json.dumps(f.limitations), f.review_state),
        )
    conn.commit()
