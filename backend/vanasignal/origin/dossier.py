"""Dossier generation: content integrity hash, JSON export and readable Markdown report."""

from __future__ import annotations

import hashlib
import json

from .schemas import AuditReport

OVERALL_LABELS = {
    "EVIDENCE_INCOMPLETE": "Evidence incomplete",
    "CONFLICT_REQUIRES_REVIEW": "Location conflict in public data: requires human review",
    "INSUFFICIENT_PUBLIC_EVIDENCE": "Insufficient public evidence",
    "CORROBORATED_PENDING_REVIEW": "Declared area corroborated by public records: pending human review",
}


def canonical_body(report: AuditReport) -> str:
    return json.dumps(report.model_dump(mode="json", exclude={"integrity"}), sort_keys=True, separators=(",", ":"))


def finalize(report: AuditReport) -> AuditReport:
    o = report.origin.status
    if o in ("NOT_CHECKED", "IDENTITY_UNRESOLVED"):
        overall = "EVIDENCE_INCOMPLETE"
    elif o == "LOCATION_CONFLICT":
        overall = "CONFLICT_REQUIRES_REVIEW"
    elif o == "INSUFFICIENT_PUBLIC_RECORDS":
        overall = "INSUFFICIENT_PUBLIC_EVIDENCE"
    else:
        overall = "CORROBORATED_PENDING_REVIEW"

    questions = []
    if report.batch_completeness.required_missing:
        questions.append("Required batch fields missing: " + ", ".join(report.batch_completeness.required_missing))
    if "collection_date" in report.batch_completeness.optional_missing:
        questions.append("Collection date not provided; origin timing cannot be checked.")
    if "latitude" in report.batch_completeness.optional_missing:
        questions.append("No declared coordinates; the location claim cannot be checked against public records.")
    if "document_references" in report.batch_completeness.optional_missing:
        questions.append("No supporting collection or transfer documents are referenced.")
    if report.taxonomy and report.taxonomy.resolution_status == "AMBIGUOUS":
        questions.append("Botanical identity is ambiguous; a human must confirm the accepted taxon.")
    if report.occurrence_error:
        questions.append("Public occurrence evidence could not be retrieved in this audit.")
    if report.batch_snapshot.get("data_origin") == "synthetic":
        questions.append("This batch is SYNTHETIC demonstration data and does not describe a real supplier shipment.")

    limitations = [
        "This is an evidence review, not a legal, regulatory or certification determination.",
        "VanaSignal does not establish legal harvesting, medicinal efficacy, sustainable harvesting or population abundance.",
        "Public biodiversity records are opportunistic and spatially biased; absence of records is not absence of the taxon.",
        "A nearby public observation does not prove the batch origin.",
    ]
    sources = [
        {"name": "GBIF Species API", "url": report.taxonomy.source_url if report.taxonomy else None,
         "retrieved_at": report.taxonomy.retrieved_at if report.taxonomy else None, "data_mode": report.taxonomy.data_mode if report.taxonomy else None},
        {"name": "GBIF Occurrence API", "urls": report.occurrence_search.source_urls if report.occurrence_search else [],
         "retrieved_at": report.occurrence_search.retrieved_at if report.occurrence_search else None,
         "data_mode": report.occurrence_search.data_mode if report.occurrence_search else None},
        {"name": "Batch intake (SQLite)", "data_origin": report.batch_snapshot.get("data_origin")},
    ]
    updated = report.model_copy(update={"overall_status": overall, "unresolved_questions": questions,
                                        "scientific_limitations": limitations, "sources": sources})
    body = canonical_body(updated)
    digest = hashlib.sha256(body.encode()).hexdigest()
    return updated.model_copy(update={"integrity": {"body_sha256": digest, "algorithm": "sha256", "canonical": "json, sort_keys, compact, excluding integrity"}})


def verify_integrity(report_json: dict) -> bool:
    integrity = report_json.get("integrity", {})
    stored = integrity.get("body_sha256")
    rebuilt = AuditReport.model_validate(report_json)
    return stored == hashlib.sha256(canonical_body(rebuilt).encode()).hexdigest()


def to_markdown(report: AuditReport) -> str:
    lines = [
        f"# Botanical origin evidence dossier: {report.batch_id}",
        "",
        f"**Evidence status:** {OVERALL_LABELS.get(report.overall_status, report.overall_status)}  ",
        "**Review:** awaiting human review. This is not a certification.  ",
        f"**Audit ID:** `{report.audit_id}`  ",
        f"**Audit timestamp:** {report.created_at}  ",
        f"**Method version:** {report.method_version}  ",
        f"**Integrity (SHA-256 of canonical JSON):** `{report.integrity.get('body_sha256', '')}`",
        "",
        "## Batch summary",
        "",
    ]
    snap = report.batch_snapshot
    data_label = "SYNTHETIC demonstration data" if snap.get("data_origin") == "synthetic" else "Manually entered"
    lines += [
        f"- Data origin: **{data_label}**",
        f"- Supplier: {snap.get('supplier_name')}",
        f"- Declared botanical name: {snap.get('declared_botanical_name')}",
        f"- Plant part: {snap.get('plant_part')}",
        f"- Declared location: {snap.get('declared_country')}, {snap.get('declared_state') or 'state unknown'}, {snap.get('declared_district') or 'district unknown'}",
        f"- Declared coordinates: {snap.get('latitude')}, {snap.get('longitude')}" if snap.get("latitude") is not None else "- Declared coordinates: not provided (unknown)",
        f"- Collection date: {snap.get('collection_date') or 'not provided'}",
        f"- Collection type: {snap.get('collection_type')}",
        f"- Supplier batch reference: {snap.get('supplier_batch_reference') or 'not provided'}",
        f"- Supporting documents referenced: {', '.join(snap.get('document_references') or []) or 'none'}",
        "",
        "## Batch-field completeness",
        "",
        f"- Required fields missing: {', '.join(report.batch_completeness.required_missing) or 'none'}",
        f"- Optional fields missing: {', '.join(report.batch_completeness.optional_missing) or 'none'}",
        f"- Documentation completeness: {report.batch_completeness.completeness_share:.0%} (not a quality or sustainability score)",
        "",
        "## Botanical identity",
        "",
    ]
    t = report.taxonomy
    if t:
        lines += [
            f"- Status: **{t.resolution_status}** (selection: {t.selection}, data: {t.data_mode})",
            f"- Accepted taxon key: {t.taxon_key or 'not established'}",
            f"- Resolved name: {t.resolved_name or 'n/a'}",
            f"- Explanation: {t.explanation}",
            f"- Source: {t.source_name} {t.source_url} (retrieved {t.retrieved_at})",
        ]
        if t.candidates:
            lines.append("- Candidates: " + "; ".join(f"{c.scientific_name} (key {c.usage_key}, {c.taxonomic_status})" for c in t.candidates[:8]))
    else:
        lines.append("- Not checked: GBIF Species API unavailable.")
    lines += ["", "## Location evidence", ""]
    o = report.origin
    lines += [f"- Origin status: **{o.status}**", f"- {o.explanation}"]
    if report.occurrence_search:
        s = report.occurrence_search
        lines += [f"- GBIF present records in search area: {s.gbif_total_count} total, {s.returned_count} retrieved ({s.data_mode}).",
                  f"- Search radius: {s.radius_km:g} km around the declared point.",
                  f"- Retrieved: {s.retrieved_at}"]
        if s.cached_note:
            lines.append(f"- **{s.cached_note}**")
    if report.occurrence_error:
        lines.append(f"- Occurrence retrieval error: {report.occurrence_error['message']}")
    lines += ["", "## Occurrence-quality findings", ""]
    if report.quality:
        lines.append("- Class counts: " + ", ".join(f"{k}: {v}" for k, v in report.quality.counts.items()))
        lines.append("- Reason counts: " + (", ".join(f"{k}: {v}" for k, v in report.quality.reason_counts.items()) or "none"))
    else:
        lines.append("- No occurrence records were classified.")
    lines += ["", "## Evidence findings", "", "| Finding ID | Category | Status | Review | Source |", "|---|---|---|---|---|"]
    for f in report.findings:
        lines.append(f"| `{f.finding_id}` | {f.category} | {f.status} | {f.review_state} | {f.source_name} |")
    lines += ["", "## Unresolved questions", ""]
    lines += [f"- {q}" for q in report.unresolved_questions] or ["- None recorded."]
    lines += ["", "## Scientific limitations", ""] + [f"- {x}" for x in report.scientific_limitations]
    lines += ["", "## Source references", ""]
    for s in report.sources:
        lines.append(f"- {s.get('name')}: {s.get('url') or ', '.join(s.get('urls', []) or []) or 'n/a'} (retrieved {s.get('retrieved_at') or 'n/a'}, data: {s.get('data_mode') or s.get('data_origin') or 'n/a'})")
    lines += ["", "## Audit timeline", ""]
    for step in report.timeline:
        lines.append(f"- {step.started_at} · **{step.name}** · {step.status} · {step.detail}")
    lines.append("")
    return "\n".join(lines)
