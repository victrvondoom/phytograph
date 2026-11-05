"""Origin Gate test suite.

Connector behaviour uses hand-authored GBIF-shaped fixtures (see tests/fixtures/gbif/README.md).
These are deterministic unit tests. They are NOT evidence that the live GBIF API was queried.
The live check is in tests/test_live_gbif_integration.py.
"""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from connector_fixtures import ConnectorDouble, FIX
from vanasignal.api import create_app
from vanasignal.config import Settings
from vanasignal.gbif import GBIFClient
from vanasignal.origin.consistency import evaluate_origin
from vanasignal.origin.dossier import verify_integrity
from vanasignal.origin.occurrences import search_occurrences, circle_polygon_wkt, ring_is_counter_clockwise
from vanasignal.origin.record_quality import classify_records
from vanasignal.origin.schemas import OccurrenceQualityRequest, OccurrenceRecord, TaxonomyResolution

DECALEPIS = "Decalepis hamiltonii"
VALID = {
    "batch_id": "TEST-001", "supplier_name": "Fixture Supplier", "declared_botanical_name": DECALEPIS,
    "plant_part": "root", "declared_country": "India", "declared_state": "Kerala", "declared_district": "Wayanad",
    "latitude": 11.6, "longitude": 76.0, "collection_date": "2025-11-12", "collection_type": "wild-harvested",
    "supplier_batch_reference": "SB-1", "document_references": ["DOC-1"], "data_origin": "manual",
}


def make_app(tmp_path, mode="ok", cache=None):
    settings = Settings(data_dir=tmp_path, db_path=tmp_path / "t.sqlite3", wdpa_path=None, land_mask_path=None, cors_origins=())
    double = ConnectorDouble(mode)
    app = create_app(settings=settings, origin_transport=double.transport)
    return TestClient(app), double, settings


# ----------------------------------------------------------- batch intake
def test_valid_batch_is_created_and_read_back(tmp_path):
    http, _, _ = make_app(tmp_path)
    r = http.post("/api/batches", json=VALID)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["batch_id"] == "TEST-001" and body["latitude"] == 11.6
    assert body["completeness"]["required_missing"] == []
    assert body["created_at"] and body["updated_at"]
    assert http.get("/api/batches/TEST-001").json()["declared_botanical_name"] == DECALEPIS


@pytest.mark.parametrize("patch", [
    {"latitude": 95.0, "longitude": 76.0},
    {"latitude": 11.6, "longitude": 181.0},
    {"latitude": 11.6, "longitude": None},
    {"latitude": 0.0, "longitude": 0.0},
])
def test_invalid_coordinates_are_rejected(tmp_path, patch):
    http, _, _ = make_app(tmp_path)
    r = http.post("/api/batches", json={**VALID, **patch})
    assert r.status_code == 422


def test_malformed_and_future_dates_are_rejected(tmp_path):
    http, _, _ = make_app(tmp_path)
    assert http.post("/api/batches", json={**VALID, "collection_date": "2025-02-30"}).status_code == 422
    assert http.post("/api/batches", json={**VALID, "collection_date": "12/11/2025"}).status_code == 422
    future = (date.today() + timedelta(days=30)).isoformat()
    assert http.post("/api/batches", json={**VALID, "collection_date": future}).status_code == 422


def test_missing_optional_fields_are_explicit_nulls_not_fabricated(tmp_path):
    http, _, _ = make_app(tmp_path)
    minimal = {k: VALID[k] for k in ["batch_id", "supplier_name", "declared_botanical_name", "plant_part", "declared_country", "collection_type"]}
    r = http.post("/api/batches", json=minimal)
    assert r.status_code == 201
    body = r.json()
    assert body["latitude"] is None and body["longitude"] is None and body["collection_date"] is None
    assert body["declared_state"] is None
    assert body["collection_type"] == "wild-harvested"
    assert "latitude" in body["completeness"]["optional_missing"]
    assert "collection_date" in body["completeness"]["optional_missing"]
    assert body["completeness"]["required_missing"] == []


def test_collection_type_is_required_and_unknown_is_explicit(tmp_path):
    http, _, _ = make_app(tmp_path)
    no_type = {k: v for k, v in VALID.items() if k != "collection_type"}
    assert http.post("/api/batches", json=no_type).status_code == 422
    r = http.post("/api/batches", json={**VALID, "batch_id": "TEST-UNK", "collection_type": "unknown"})
    assert r.status_code == 201 and r.json()["collection_type"] == "unknown"


def test_duplicate_batch_reference_is_rejected(tmp_path):
    http, _, _ = make_app(tmp_path)
    assert http.post("/api/batches", json=VALID).status_code == 201
    r = http.post("/api/batches", json=VALID)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "duplicate_batch_id"


def test_update_replaces_fields_and_keeps_batch_id(tmp_path):
    http, _, _ = make_app(tmp_path)
    http.post("/api/batches", json=VALID)
    r = http.put("/api/batches/TEST-001", json={**VALID, "supplier_name": "Renamed Supplier", "latitude": None, "longitude": None})
    assert r.status_code == 200
    assert r.json()["supplier_name"] == "Renamed Supplier" and r.json()["latitude"] is None
    assert http.get("/api/batches/NOPE").status_code == 404


# -------------------------------------------------------------- taxonomy
def test_taxonomy_exact_accepted_match_is_resolved_automatically(tmp_path):
    http, double, _ = make_app(tmp_path)
    r = http.get("/api/taxonomy/resolve", params={"name": DECALEPIS})
    assert r.status_code == 200
    t = r.json()
    assert t["resolution_status"] == "RESOLVED" and t["taxon_key"] == 900000101 and t["selection"] == "automatic"
    assert t["source_url"].startswith("https://api.gbif.org/v1/species/match?") and t["retrieved_at"]
    assert t["data_mode"] == "live"


def test_synonym_resolves_to_accepted_taxon(tmp_path):
    http, _, _ = make_app(tmp_path)
    t = http.get("/api/taxonomy/resolve", params={"name": "Gymnema hamiltonii Fixture syn."}).json()
    assert t["resolution_status"] == "SYNONYM_RESOLVED" and t["taxon_key"] == 900000201


def test_ambiguous_name_is_never_auto_selected(tmp_path):
    http, _, _ = make_app(tmp_path)
    t = http.get("/api/taxonomy/resolve", params={"name": "Withania somnifera"}).json()
    assert t["resolution_status"] == "AMBIGUOUS" and t["taxon_key"] is None and t["selection"] == "none"
    assert len(t["candidates"]) >= 2
    assert "Select one candidate" in t["explanation"]


def test_user_confirmation_must_come_from_gbif_candidates(tmp_path):
    http, _, _ = make_app(tmp_path)
    ok = http.get("/api/taxonomy/resolve", params={"name": "Withania somnifera", "confirm_key": 900000302}).json()
    assert ok["selection"] == "user_confirmed" and ok["taxon_key"] == 900000302
    bad = http.get("/api/taxonomy/resolve", params={"name": "Withania somnifera", "confirm_key": 123})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_candidate"


def test_unresolved_name_returns_unresolved_with_explanation(tmp_path):
    http, _, _ = make_app(tmp_path)
    t = http.get("/api/taxonomy/resolve", params={"name": "Nonexistentia fakei"}).json()
    assert t["resolution_status"] == "UNRESOLVED" and t["taxon_key"] is None
    assert "did not match" in t["explanation"]


def test_higher_rank_match_is_unresolved(tmp_path):
    http, _, _ = make_app(tmp_path)
    t = http.get("/api/taxonomy/resolve", params={"name": "Decalepis"}).json()
    assert t["resolution_status"] == "UNRESOLVED" and "GENUS" in t["explanation"]


# ----------------------------------------------------- occurrence evidence
def test_occurrence_records_preserve_identifiers_dataset_coordinates_and_provenance(tmp_path):
    http, _, _ = make_app(tmp_path)
    r = http.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0, "radius_km": 100})
    assert r.status_code == 200
    s = r.json()
    assert s["returned_count"] == 19 and s["gbif_total_count"] == 19 and s["truncated"] is False
    first = s["records"][0]
    assert first["gbif_id"] == "1001" and first["dataset_key"] == "ds-A" and first["license"] == "CC_BY_4_0"
    assert first["lat"] == 11.62 and first["coordinate_uncertainty_m"] == 30 and first["basis_of_record"] == "HUMAN_OBSERVATION"
    assert first["source_url"].startswith("https://api.gbif.org/v1/occurrence/search?") and first["retrieved_at"]
    assert first["data_mode"] == "live"
    assert s["data_mode"] == "live" and s["cached_note"] is None


def test_empty_occurrence_result_is_not_treated_as_absence(tmp_path):
    http, _, _ = make_app(tmp_path)
    s = http.get("/api/occurrences/search", params={"taxon_key": 900000303, "lat": 11.6, "lon": 76.0}).json()
    assert s["returned_count"] == 0 and s["records"] == []
    assert "not evidence that the taxon is absent" in s["absence_note"]


def test_search_limit_and_radius_are_validated(tmp_path):
    http, _, _ = make_app(tmp_path)
    assert http.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0, "radius_km": 500}).status_code == 422
    assert http.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0, "limit": 5000}).status_code == 422


def test_search_circle_is_counter_clockwise_and_hash_is_stable():
    wkt = circle_polygon_wkt(11.6, 76.0, 100)
    assert ring_is_counter_clockwise(wkt)
    client = GBIFClient(FIX.parent / "_unused_cache", transport=ConnectorDouble().transport)
    a = search_occurrences(client, 900000101, 11.6, 76.0, 100)
    b = search_occurrences(client, 900000101, 11.6, 76.0, 100)
    assert a.search_area_wkt_sha256 == b.search_area_wkt_sha256


# ------------------------------------------------------- quality classes
def _records_from_fixture():
    client = GBIFClient(FIX.parent / "_unused_cache2", transport=ConnectorDouble().transport)
    return search_occurrences(client, 900000101, 11.6, 76.0, 100).records


def test_planted_errors_match_expected_outcomes_exactly():
    expected = json.loads((FIX / "expected_quality_outcomes.json").read_text())
    report = classify_records(OccurrenceQualityRequest(
        records=_records_from_fixture(), declared_latitude=11.6, declared_longitude=76.0,
        uncertainty_threshold_m=expected["uncertainty_threshold_m"]))
    assert len(report.findings) == len(expected["expected"])
    for exp, got in zip(expected["expected"], report.findings):
        assert got.gbif_id == exp["gbif_id"], exp
        assert got.record_class == exp["class"], (exp, got.record_class, [r.code for r in got.reasons])
        assert {r.code for r in got.reasons} == set(exp["codes"]), (exp, [r.code for r in got.reasons])
        assert got.explanation
    assert report.counts == expected["expected_counts"]


def test_no_record_is_deleted_by_classification():
    recs = _records_from_fixture()
    report = classify_records(OccurrenceQualityRequest(records=recs))
    assert len(report.findings) == len(recs) == report.records_total


def test_invalid_and_excessive_uncertainty_detected_explicitly():
    recs = [
        OccurrenceRecord(gbif_id="a", lat=0.0, lon=0.0, dataset_key="d", event_date="2020-01-01", coordinate_uncertainty_m=5),
        OccurrenceRecord(gbif_id="b", lat=11.6, lon=76.0, dataset_key="d", event_date="2020-01-01", coordinate_uncertainty_m=20000),
    ]
    rep = classify_records(OccurrenceQualityRequest(records=recs, declared_latitude=11.6, declared_longitude=76.0))
    assert rep.findings[0].record_class == "invalid" and "ZERO_COORDINATES" in rep.reason_counts
    assert rep.findings[1].record_class == "usable_with_caution" and "EXCESSIVE_COORDINATE_UNCERTAINTY" in rep.reason_counts


# -------------------------------------------------------- origin status
def _tax(status="RESOLVED", key=900000101):
    return TaxonomyResolution(submitted_name=DECALEPIS, resolution_status=status, explanation="x", taxon_key=key,
                              source_url="https://api.gbif.org/v1/species/match?name=x", retrieved_at="2026-11-05T09:00:00+00:00", data_mode="live", candidates=[])


def _search_and_quality(lat, lon, radius=100.0):
    recs = _records_from_fixture()
    from vanasignal.origin.schemas import OccurrenceSearchResult
    search = OccurrenceSearchResult(taxon_key=900000101, center_lat=lat, center_lon=lon, radius_km=radius, search_area_wkt_sha256="x",
                                    gbif_total_count=len(recs), returned_count=len(recs), truncated=False, records=recs,
                                    source_urls=["https://api.gbif.org/v1/occurrence/search?x"], retrieved_at="2026-11-05T09:00:00+00:00", data_mode="live")
    q = classify_records(OccurrenceQualityRequest(records=recs, declared_latitude=lat, declared_longitude=lon))
    return search, q


def test_origin_corroborated_when_usable_records_near_declared_point():
    search, q = _search_and_quality(11.6, 76.0)
    res = evaluate_origin(declared_latitude=11.6, declared_longitude=76.0, taxonomy=_tax(), search=search, quality=q)
    assert res.status == "CORROBORATED"
    assert res.evidence["usable_records_within_near_radius"] >= 3
    assert any("does not establish" in l or "not establish" in l for l in res.limitations)


def test_origin_location_conflict_when_usable_records_exist_but_none_near():
    search, q = _search_and_quality(12.3, 76.0)
    res = evaluate_origin(declared_latitude=12.3, declared_longitude=76.0, taxonomy=_tax(), search=search, quality=q)
    assert res.status == "LOCATION_CONFLICT"
    assert "not proof that the batch is false" in res.explanation


def test_origin_statuses_for_identity_coordinates_and_retrieval_failures():
    search, q = _search_and_quality(11.6, 76.0)
    assert evaluate_origin(declared_latitude=11.6, declared_longitude=76.0, taxonomy=_tax("AMBIGUOUS", None), search=search, quality=q).status == "IDENTITY_UNRESOLVED"
    assert evaluate_origin(declared_latitude=None, declared_longitude=None, taxonomy=_tax(), search=search, quality=q).status == "NOT_CHECKED"
    assert evaluate_origin(declared_latitude=11.6, declared_longitude=76.0, taxonomy=None, search=None, quality=None, service_error="down").status == "NOT_CHECKED"
    assert evaluate_origin(declared_latitude=11.6, declared_longitude=76.0, taxonomy=_tax(), search=None, quality=None, service_error="down").status == "NOT_CHECKED"


def test_origin_zero_records_is_insufficient_not_absence():
    from vanasignal.origin.schemas import OccurrenceSearchResult
    empty = OccurrenceSearchResult(taxon_key=900000303, center_lat=11.6, center_lon=76.0, radius_km=100, search_area_wkt_sha256="x",
                                   gbif_total_count=0, returned_count=0, truncated=False, records=[], source_urls=["u"], retrieved_at="t", data_mode="live")
    q = classify_records(OccurrenceQualityRequest(records=[]))
    res = evaluate_origin(declared_latitude=11.6, declared_longitude=76.0, taxonomy=_tax(key=900000303), search=empty, quality=q)
    assert res.status == "INSUFFICIENT_PUBLIC_RECORDS" and "not evidence of absence" in res.explanation


# --------------------------------------------- audit, registry and export
def _create(http, **over):
    assert http.post("/api/batches", json={**VALID, **over}).status_code == 201


def test_full_audit_runs_stores_and_is_retrievable(tmp_path):
    http, _, _ = make_app(tmp_path)
    _create(http)
    assert http.get("/api/batches/TEST-001/audit").status_code == 404
    r = http.post("/api/batches/TEST-001/audit")
    assert r.status_code == 200, r.text
    audit = r.json()
    assert audit["origin"]["status"] == "CORROBORATED"
    assert audit["overall_status"] == "CORROBORATED_PENDING_REVIEW"
    assert [s["name"] for s in audit["timeline"]] == ["batch_snapshot", "taxonomy_resolution", "occurrence_retrieval", "occurrence_quality", "origin_consistency"]
    latest = http.get("/api/batches/TEST-001/audit").json()
    assert latest["audit_id"] == audit["audit_id"]
    assert http.get("/api/batches/TEST-001").json()["latest_audit"]["origin_status"] == "CORROBORATED"


def test_every_finding_carries_complete_provenance(tmp_path):
    http, _, _ = make_app(tmp_path)
    _create(http)
    audit = http.post("/api/batches/TEST-001/audit").json()
    assert audit["findings"], "findings expected"
    required = ["finding_id", "batch_id", "audit_id", "category", "status", "explanation", "source_name", "method_version", "limitations", "review_state"]
    for f in audit["findings"]:
        for key in required:
            assert f[key] not in (None, "", []), (key, f)
        assert f["review_state"] in ("automated", "awaiting_human_review")
    gbif = [f for f in audit["findings"] if f["category"] in ("botanical_identity", "occurrence_retrieval", "origin_consistency")]
    for f in gbif:
        assert f["source_url"] and f["retrieved_at"], f
    assert all(f["review_state"] == "awaiting_human_review" for f in audit["findings"] if f["category"] == "origin_consistency")
    quality_ids = [i for f in audit["findings"] if f["category"] == "occurrence_quality" for i in f["source_record_ids"]]
    assert "1005" in quality_ids and "1019" in quality_ids  # zero-coordinate and unknown-uncertainty records are reported by id


def test_export_json_and_markdown_have_verifiable_integrity(tmp_path):
    http, _, _ = make_app(tmp_path)
    _create(http)
    audit = http.post("/api/batches/TEST-001/audit").json()
    exported = http.get("/api/batches/TEST-001/audit/export.json")
    assert exported.status_code == 200 and "attachment" in exported.headers["content-disposition"]
    data = exported.json()
    assert data["integrity"]["body_sha256"] == audit["integrity"]["body_sha256"]
    assert verify_integrity(data) is True
    tampered = dict(data, overall_status="CORROBORATED_PENDING_REVIEW", origin={**data["origin"], "status": "LOCATION_CONFLICT"})
    assert verify_integrity(tampered) is False
    md = http.get("/api/batches/TEST-001/audit/export.md")
    assert md.status_code == 200 and "Batch-field completeness" in md.text and audit["integrity"]["body_sha256"] in md.text
    assert http.get("/api/integrity/TEST-001").json() == {"verified": True}


def test_gbif_timeout_is_an_explicit_error_state_not_a_result(tmp_path):
    http, _, _ = make_app(tmp_path, mode="timeout")
    _create(http)
    r = http.get("/api/taxonomy/resolve", params={"name": DECALEPIS})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "gbif_unavailable"
    audit = http.post("/api/batches/TEST-001/audit").json()
    assert audit["taxonomy"] is None and audit["origin"]["status"] == "NOT_CHECKED"
    assert [s["status"] for s in audit["timeline"] if s["name"] == "taxonomy_resolution"] == ["failed"]
    assert any(f["category"] == "botanical_identity" and f["status"] == "NOT_CHECKED" for f in audit["findings"])


def test_gbif_policy_denial_is_reported_as_error_not_retried_as_success(tmp_path):
    http, double, _ = make_app(tmp_path, mode="http403")
    r = http.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0})
    assert r.status_code == 502 and r.json()["detail"]["code"] == "gbif_error"
    assert len(double.calls) == 1, "policy denials must not be retried"


def test_cached_response_is_labelled_with_original_retrieval_time(tmp_path):
    http, _, _ = make_app(tmp_path, mode="ok")
    first = http.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0, "radius_km": 100}).json()
    assert first["data_mode"] == "live"
    # Second app instance shares the cache directory but its live connector now fails.
    settings = Settings(data_dir=tmp_path, db_path=tmp_path / "t2.sqlite3", wdpa_path=None, land_mask_path=None, cors_origins=())
    failing = ConnectorDouble("timeout")
    http2 = TestClient(create_app(settings=settings, origin_transport=failing.transport))
    r = http2.get("/api/occurrences/search", params={"taxon_key": 900000101, "lat": 11.6, "lon": 76.0, "radius_km": 100, "refresh": "true"})
    assert r.status_code == 200
    body = r.json()
    assert body["data_mode"] == "cached"
    assert body["cached_note"] and "CACHED" in body["cached_note"] and first["retrieved_at"] in body["cached_note"]
    assert all(rec["data_mode"] == "cached" for rec in body["records"])


def test_audit_of_unknown_batch_is_404(tmp_path):
    http, _, _ = make_app(tmp_path)
    assert http.post("/api/batches/MISSING-1/audit").status_code == 404
    assert http.get("/api/batches/MISSING-1/audit/export.json").status_code == 404


def test_occurrence_quality_endpoint_is_stateless_and_validated(tmp_path):
    http, _, _ = make_app(tmp_path)
    r = http.post("/api/audits/occurrence-quality", json={"records": [{"gbif_id": "x", "lat": 0, "lon": 0}], "declared_latitude": 11.6, "declared_longitude": 76.0})
    assert r.status_code == 200 and r.json()["counts"]["invalid"] == 1
    assert http.post("/api/audits/occurrence-quality", json={"records": [], "uncertainty_threshold_m": -1}).status_code == 422
