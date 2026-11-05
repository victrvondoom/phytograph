"""End-to-end pipeline, HTTP API and MCP tools.

GBIF is replaced by FakeGBIF (synthetic transport) or FixtureSource (synthetic
records). Outputs are labelled as fixture/test data in their manifests.
"""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from fixtures import FakeGBIF, FixtureSource, REGION, synthetic_records
from vanasignal.api import create_app
from vanasignal.config import Settings
from vanasignal.gbif import GBIFClient
from vanasignal.models import AnalysisRequest
from vanasignal.pipeline import NoRecordsError, PipelineOptions, run_analysis


def request(**kw):
    base = dict(species="Fixturea testis", bbox=REGION, resolution=5, max_records=3000, uncertainty_threshold_m=5000.0, include_protected=True)
    base.update(kw)
    return AnalysisRequest(**base)


@pytest.fixture
def opts(tmp_path):
    return PipelineOptions(out_root=tmp_path / "runs")


def test_pipeline_writes_complete_evidence_bundle(opts):
    summary = run_analysis(request(), FixtureSource(synthetic_records(n=300)), opts)
    run_dir = opts.out_root / summary["run_id"]
    for name in ["occurrences.csv", "occurrences.geojson", "grid.geojson", "grid_metrics.csv", "summary.json", "manifest.json", "report.md"]:
        assert (run_dir / name).exists(), name
    assert summary["data_source_kind"] == "fixture"
    assert "NOT live GBIF data" in summary["data_source"]
    assert len(summary["candidates"]) == 20
    top = summary["candidates"][0]
    assert top["explanation"]["text"] and top["explanation"]["indicators"]["priority_score"] == top["priority_score"]
    assert any("not an ecological probability" in w for w in top["explanation"]["warnings"])
    assert summary["protected_areas"]["loaded"] is False  # no WDPA configured in tests


def test_run_id_is_content_addressed(opts):
    a = run_analysis(request(), FixtureSource(synthetic_records(n=200)), opts)
    b = run_analysis(request(), FixtureSource(synthetic_records(n=200)), opts)
    c = run_analysis(request(), FixtureSource(synthetic_records(n=201)), opts)
    assert a["run_id"] == b["run_id"] and a["run_id"] != c["run_id"]


def test_manifest_keeps_licences_and_hashes(opts):
    summary = run_analysis(request(), FixtureSource(synthetic_records(n=150)), opts)
    manifest = json.loads((opts.out_root / summary["run_id"] / "manifest.json").read_text())
    assert manifest["gbif"]["licenses"] == {"CC_BY_4_0": 150}
    assert set(manifest["output_sha256"]) == {"occurrences.csv", "occurrences.geojson", "grid.geojson", "grid_metrics.csv"}
    assert all(len(h) == 64 for h in manifest["output_sha256"].values())


def test_truncation_is_reported_as_a_warning(opts):
    summary = run_analysis(request(max_records=100), FixtureSource(synthetic_records(n=400)), opts)
    assert any("truncated" in w.lower() for w in summary["warnings"])


def test_no_records_raises_with_absence_caveat(opts):
    with pytest.raises(NoRecordsError, match="not evidence that the species is absent"):
        run_analysis(request(), FixtureSource([]), opts)


def test_report_states_limitations(opts):
    summary = run_analysis(request(), FixtureSource(synthetic_records(n=200)), opts)
    text = (opts.out_root / summary["run_id"] / "report.md").read_text()
    assert "## Warnings and limitations" in text and "not ecological probabilities" in text


# ------------------------------------------------------------------ API
def api(tmp_path, transport_records=None, status_script=None):
    fake = FakeGBIF(transport_records if transport_records is not None else synthetic_records(n=260), status_script=status_script)
    client = GBIFClient(tmp_path / "cache", max_retries=0, backoff_seconds=0.0, transport=fake.transport)
    settings = Settings(data_dir=tmp_path / "data", wdpa_path=None, land_mask_path=None, cors_origins=("http://localhost:3000",))
    app = create_app(settings=settings, client=client)
    return TestClient(app), settings


def test_api_resolve_and_full_analysis_flow(tmp_path):
    http, settings = api(tmp_path)
    r = http.post("/api/species/resolve", json={"name": "Withania somnifera"})
    assert r.status_code == 200 and r.json()["accepted_key"] == 9100002

    r = http.post("/api/analyses", json={"species": "Withania somnifera", "bbox": list(REGION)})
    assert r.status_code == 201, r.text
    run_id = r.json()["run_id"]
    assert len(run_id) == 16 and r.json()["data_source_kind"] == "gbif"

    assert http.get(f"/api/analyses/{run_id}").json()["run_id"] == run_id
    assert http.get(f"/api/analyses/{run_id}/grid").headers["content-type"].startswith("application/geo+json")
    occ = http.get(f"/api/analyses/{run_id}/occurrences").json()
    assert occ["type"] == "FeatureCollection" and occ["features"]
    assert http.get(f"/api/analyses/{run_id}/export/candidates.csv").text.splitlines()[0].startswith("rank,cell")
    assert http.get(f"/api/analyses/{run_id}/export/occurrences.csv").status_code == 200
    assert http.get(f"/api/analyses/{run_id}/export/unknown.bin").status_code == 404
    assert http.get(f"/api/analyses/{run_id}/manifest").json()["gbif"]["gbif_total_count"] == 260
    assert "VanaSignal analysis report" in http.get(f"/api/analyses/{run_id}/report").text
    assert [row["run_id"] for row in http.get("/api/analyses").json()] == [run_id]


def test_api_simulation_and_benchmark_flow(tmp_path):
    http, _ = api(tmp_path)
    run_id = http.post("/api/analyses", json={"species": "Withania somnifera", "bbox": list(REGION)}).json()["run_id"]
    candidates = http.get(f"/api/analyses/{run_id}").json()["candidates"]
    cells = [c["cell"] for c in candidates[:3]]

    sim = http.post(f"/api/analyses/{run_id}/simulate", json={"cell_ids": cells, "detection_probability": 0.4, "visits": 2})
    assert sim.status_code == 200 and len(sim.json()["scenarios"]) == 3
    bad = http.post(f"/api/analyses/{run_id}/simulate", json={"cell_ids": ["zzz"]})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "unknown_cells"

    assert http.get(f"/api/analyses/{run_id}/benchmark").status_code == 404
    bench = http.post(f"/api/analyses/{run_id}/benchmark", json={"seeds": 3, "fault_rate": 0.05})
    assert bench.status_code == 200, bench.text
    body = bench.json()
    assert body["withheld_observation"]["seeds_run"] == 3
    assert body["quality_detection"]["by_fault_type"]["plausible_shift_1deg"]["detection_rate"] < 0.5
    assert http.get(f"/api/analyses/{run_id}/benchmark").json()["run_id"] == run_id


def test_api_reports_gbif_unavailable_honestly(tmp_path):
    http, _ = api(tmp_path, status_script=[403])
    r = http.post("/api/analyses", json={"species": "Withania somnifera", "bbox": list(REGION)})
    assert r.status_code == 502 and r.json()["code"] == "gbif_error"


def test_api_unresolved_species_returns_suggestions(tmp_path):
    http, _ = api(tmp_path)
    r = http.post("/api/species/resolve", json={"name": "Nonexistent plantus"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "species_not_resolved" and r.json()["detail"]["suggestions"]


def test_api_rejects_invalid_request_before_any_network_call(tmp_path):
    http, _ = api(tmp_path)
    r = http.post("/api/analyses", json={"species": "Withania somnifera", "bbox": [77, 8, 74, 12]})
    assert r.status_code == 422


def test_api_health_reports_unreachable_gbif(tmp_path):
    http, _ = api(tmp_path, status_script=[403])
    body = http.get("/api/health").json()
    assert body["gbif"]["reachable"] is False and body["protected_areas_configured"] is False


def test_api_rejects_malformed_run_ids(tmp_path):
    http, _ = api(tmp_path)
    assert http.get("/api/analyses/..%2Fetc").status_code in (400, 404)
    assert http.get("/api/analyses/0123456789abcdef").status_code == 404


# ------------------------------------------------------------------ MCP
def test_mcp_tools_are_registered_with_expected_names():
    from vanasignal.mcp_server import mcp
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert names == {
        "resolve_species", "fetch_occurrences", "audit_occurrence_quality", "detect_sampling_gaps",
        "analyze_protected_overlap", "rank_survey_locations", "simulate_survey_plan", "generate_evidence_report",
    }


def test_mcp_audit_and_rank_tools_return_structured_output():
    from vanasignal import mcp_server as ms
    recs = [{"gbif_id": str(r["gbif_id"]), "lat": r["lat"], "lon": r["lon"], "coordinate_uncertainty_m": r["coordinate_uncertainty_m"],
             "event_date": r["event_date"], "year": r["year"], "basis_of_record": r["basis_of_record"], "issues": [], "license": "CC_BY_4_0"}
            for r in synthetic_records(n=160)]
    bbox = {"min_lon": REGION[0], "min_lat": REGION[1], "max_lon": REGION[2], "max_lat": REGION[3]}
    audit = ms.audit_occurrence_quality(records=[ms.OccurrenceInput(**r) for r in recs], bbox=ms.BBoxInput(**bbox))
    assert audit["summary"]["records_total"] == 160 and "flagged_records" in audit
    ranked = ms.rank_survey_locations(records=[ms.OccurrenceInput(**r) for r in recs], bbox=ms.BBoxInput(**bbox), n=5)
    assert len(ranked["candidates"]) == 5
    assert ranked["candidates"][0]["limitations"]
    with pytest.raises(Exception):
        ms.BBoxInput(min_lon=500, min_lat=0, max_lon=1, max_lat=1)
