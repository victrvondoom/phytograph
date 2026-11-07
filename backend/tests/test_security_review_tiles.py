"""Security controls, human review closure, formula-safe exports, architecture invariants and the tile proxy."""

import httpx
import pytest

from test_origin_gate import VALID, make_app
from vanasignal.origin.security import safe_csv_cell
from vanasignal.origin import tiles


def test_security_headers_on_every_response(tmp_path):
    http, _, _ = make_app(tmp_path)
    r = http.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["referrer-policy"] == "no-referrer"


def test_oversized_payload_is_rejected_before_processing(tmp_path):
    http, _, _ = make_app(tmp_path)
    r = http.post("/api/audits/occurrence-quality", content=b"{}", headers={"content-type": "application/json", "content-length": "2000000"})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "payload_too_large"


def test_write_token_guards_changes_but_not_reads(tmp_path, monkeypatch):
    monkeypatch.setenv("VANASIGNAL_API_TOKEN", "test-token-123")
    http, _, _ = make_app(tmp_path)
    assert http.post("/api/batches", json=VALID).status_code == 401
    assert http.post("/api/batches", json=VALID, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert http.post("/api/batches", json=VALID, headers={"Authorization": "Bearer test-token-123"}).status_code == 201
    assert http.get("/api/batches").status_code == 200
    health = http.get("/api/health").json()
    assert health["write_token_required"] is True


def test_formula_injection_is_neutralised():
    assert safe_csv_cell("=HYPERLINK(\"http://x\")").startswith("'=")
    assert safe_csv_cell("+1+1").startswith("'+")
    assert safe_csv_cell("-2").startswith("'-")
    assert safe_csv_cell("@SUM(A1)").startswith("'@")
    assert safe_csv_cell("11.6") == "11.6"
    assert safe_csv_cell(None) == ""


def test_review_closure_lifecycle(tmp_path):
    http, _, _ = make_app(tmp_path)
    http.post("/api/batches", json=VALID)
    assert http.post("/api/batches/TEST-001/reviews", json={"audit_id": "AUD-x-000000", "decision": "reject", "reviewer": "A. Reviewer"}).status_code == 409
    audit = http.post("/api/batches/TEST-001/audit").json()
    state = http.get("/api/batches/TEST-001/review").json()
    assert state["state"] == "OPEN" and state["latest_audit_id"] == audit["audit_id"]
    stale = http.post("/api/batches/TEST-001/reviews", json={"audit_id": "AUD-old-000000", "decision": "reject", "reviewer": "A. Reviewer"})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "stale_audit"
    ok = http.post("/api/batches/TEST-001/reviews", json={"audit_id": audit["audit_id"], "decision": "request_more_evidence",
                                                          "reviewer": "A. Reviewer", "note": "Ask for the permit."})
    assert ok.status_code == 201 and ok.json()["decision"] == "request_more_evidence"
    closed = http.get("/api/batches/TEST-001/review").json()
    assert closed["state"] == "CLOSED" and closed["latest_decision"]["reviewer"] == "A. Reviewer" and len(closed["history"]) == 1
    http.post("/api/batches/TEST-001/audit")  # a new audit reopens the review
    assert http.get("/api/batches/TEST-001/review").json()["state"] == "OPEN"


def test_review_rejects_invalid_decision_and_anonymous_reviewer(tmp_path):
    http, _, _ = make_app(tmp_path)
    http.post("/api/batches", json=VALID)
    audit = http.post("/api/batches/TEST-001/audit").json()
    assert http.post("/api/batches/TEST-001/reviews", json={"audit_id": audit["audit_id"], "decision": "approve_legal", "reviewer": "A"}).status_code == 422
    assert http.post("/api/batches/TEST-001/reviews", json={"audit_id": audit["audit_id"], "decision": "reject", "reviewer": "A"}).status_code == 422


def test_records_csv_export_is_formula_safe(tmp_path):
    http, _, _ = make_app(tmp_path)
    http.post("/api/batches", json=VALID)
    audit = http.post("/api/batches/TEST-001/audit").json()
    r = http.get("/api/batches/TEST-001/audit/records.csv")
    assert r.status_code == 200 and r.text.splitlines()[0].startswith("gbif_id,record_class")
    assert len(r.text.splitlines()) == 1 + audit["quality"]["records_total"]
    for line in r.text.splitlines()[1:]:
        assert not line.startswith("=") and not line.startswith("+") and not line.startswith("-") and not line.startswith("@")


def test_architecture_nodes_are_deterministic_and_llm_free(tmp_path):
    http, _, _ = make_app(tmp_path)
    arch = http.get("/api/architecture").json()
    assert arch["nodes"] and all(n["uses_llm"] is False for n in arch["nodes"])
    assert [n["id"] for n in arch["nodes"] if not n["deterministic"]] == ["reviewer"]
    ids = {n["id"] for n in arch["nodes"]}
    assert all(a in ids and b in ids for a, b in arch["edges"])


def test_tile_proxy_validates_coordinates_and_reports_unconfigured(tmp_path, monkeypatch):
    monkeypatch.delenv("VANASIGNAL_SATELLITE_TEMPLATE", raising=False)
    http, _, _ = make_app(tmp_path)
    assert http.get("/api/tiles/satellite/3/9/0").status_code == 400  # x out of range for z=3
    assert http.get("/api/tiles/satellite/25/0/0").status_code == 400
    r = http.get("/api/tiles/satellite/3/4/2")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "satellite_not_configured"
    assert http.get("/api/health").json()["satellite_configured"] is False


def test_tile_fetch_is_server_side_cached_and_checks_content_type(tmp_path, monkeypatch):
    monkeypatch.setenv("VANASIGNAL_SATELLITE_TEMPLATE", "https://tiles.invalid/{z}/{x}/{y}.jpg?key=SERVER_ONLY")
    calls = []
    png = b"\x89PNG-test-bytes"

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=png, headers={"content-type": "image/png"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    body, ctype = tiles.fetch_tile(tmp_path / "tiles", 3, 4, 2, client=client)
    assert body == png and ctype == "image/png"
    again, _ = tiles.fetch_tile(tmp_path / "tiles", 3, 4, 2, client=client)
    assert again == png and len(calls) == 1, "second request must be served from the server cache"
    assert calls[0].endswith("/3/4/2.jpg?key=SERVER_ONLY")

    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>", headers={"content-type": "text/html"})))
    with pytest.raises(RuntimeError):
        tiles.fetch_tile(tmp_path / "tiles2", 1, 0, 0, client=bad)


def test_status_endpoint_is_fast_and_reports_non_gbif_base(tmp_path):
    http, _, _ = make_app(tmp_path)
    s = http.get("/api/status").json()
    assert s["gbif_api_base"].startswith("http") and "record_modes" in s
    assert set(s["record_modes"]) == {"live", "cached", "non_gbif_test_endpoint"}
