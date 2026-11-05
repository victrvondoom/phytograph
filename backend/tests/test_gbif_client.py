"""GBIF client behaviour, exercised against the FakeGBIF transport (synthetic test double)."""

import httpx
import pytest

from fixtures import FakeGBIF, synthetic_records
from vanasignal.gbif import GBIFClient, GBIFError, GBIFUnavailableError, SpeciesNotResolvedError, bbox_to_wkt, parse_occurrence
from vanasignal.models import AnalysisRequest
from pydantic import ValidationError


def make_client(tmp_path, fake: FakeGBIF, retries=2) -> GBIFClient:
    return GBIFClient(tmp_path / "cache", max_retries=retries, backoff_seconds=0.0, transport=fake.transport)


def test_bbox_wkt_is_counter_clockwise():
    wkt = bbox_to_wkt((74.8, 8.1, 77.5, 12.8))
    pts = [tuple(map(float, p.split())) for p in wkt[len("POLYGON(("):-2].split(", ")]
    area2 = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:]))
    assert area2 > 0, "GBIF requires counter-clockwise rings"


def test_resolve_accepted_species(tmp_path):
    fake = FakeGBIF(records=[])
    resolved = make_client(tmp_path, fake).resolve_species("Withania somnifera")
    assert resolved.accepted_key == 9100002 and resolved.usage_key == 9100001
    assert resolved.match_type == "EXACT" and resolved.warnings == []
    assert resolved.request_url.startswith("https://api.gbif.org/v1/species/match?")


def test_resolve_synonym_warns_and_uses_accepted_key(tmp_path):
    fake = FakeGBIF(records=[], species_status="SYNONYM")
    resolved = make_client(tmp_path, fake).resolve_species("Withania somnifera")
    assert resolved.warnings and "SYNONYM" in resolved.warnings[0]


def test_unmatched_name_raises_with_no_silent_fallback(tmp_path):
    with pytest.raises(SpeciesNotResolvedError) as exc:
        make_client(tmp_path, FakeGBIF(records=[])).resolve_species("Nonexistent plantus")
    assert exc.value.suggestions and exc.value.suggestions[0].key == 9300001


def test_higher_rank_is_rejected(tmp_path):
    with pytest.raises(SpeciesNotResolvedError, match="rank GENUS"):
        make_client(tmp_path, FakeGBIF(records=[])).resolve_species("Genusa")


def test_pagination_collects_all_pages_and_records_urls(tmp_path, monkeypatch):
    records = synthetic_records(n=650)
    client = make_client(tmp_path, FakeGBIF(records))
    got, meta = client.fetch_occurrences(9000001, (74.8, 8.1, 77.5, 12.8), max_records=10_000)
    assert len(got) == 650 and not meta["truncated"]
    assert len(meta["page_urls"]) == 3  # 300 + 300 + 50
    assert all("occurrenceStatus=PRESENT" in u for u in meta["page_urls"])


def test_max_records_truncates_and_reports_it(tmp_path):
    client = make_client(tmp_path, FakeGBIF(synthetic_records(n=400)))
    got, meta = client.fetch_occurrences(9000001, (74.8, 8.1, 77.5, 12.8), max_records=120)
    assert len(got) == 120 and meta["truncated"] and meta["gbif_total_count"] == 400


def test_retry_after_transient_503_succeeds(tmp_path):
    fake = FakeGBIF(records=[], status_script=[503])
    resolved = make_client(tmp_path, fake, retries=2).resolve_species("Withania somnifera")
    assert resolved.accepted_key == 9100002
    assert len(fake.calls) == 2


def test_policy_denial_is_not_retried(tmp_path):
    fake = FakeGBIF(records=[], status_script=[403, 403, 403])
    client = make_client(tmp_path, fake, retries=3)
    with pytest.raises(GBIFError) as exc:
        client.resolve_species("Withania somnifera")
    assert not isinstance(exc.value, GBIFUnavailableError)
    assert len(fake.calls) == 1


def test_exhausted_transport_errors_raise_unavailable(tmp_path):
    def refuse(request):
        raise httpx.ConnectError("tunnel refused", request=request)

    client = GBIFClient(tmp_path / "cache", max_retries=1, backoff_seconds=0.0, transport=httpx.MockTransport(refuse))
    with pytest.raises(GBIFUnavailableError, match="unreachable after 2 attempts"):
        client.get_json("/species/match", {"name": "x"})


def test_successful_responses_are_cached_with_provenance(tmp_path):
    fake = FakeGBIF(records=[])
    client = make_client(tmp_path, fake)
    client.resolve_species("Withania somnifera")
    first_calls = len(fake.calls)
    client2 = make_client(tmp_path, FakeGBIF(records=[]))
    resolved = client2.resolve_species("Withania somnifera")
    assert first_calls == 1 and len(client2.request_log) == 1 and client2.request_log[0]["from_cache"] is True
    assert resolved.retrieved_at


def test_parse_occurrence_keeps_licence_and_dataset_identifiers():
    rec = parse_occurrence({"gbifID": "42", "key": 7, "datasetKey": "abc", "license": "CC0_1_0", "issues": ["ZERO_COORDINATE"]})
    assert rec["gbif_id"] == "42" and rec["dataset_key"] == "abc" and rec["license"] == "CC0_1_0"
    assert rec["issues"] == ["ZERO_COORDINATE"]


def test_analysis_request_rejects_bad_bbox_and_huge_span():
    with pytest.raises(ValidationError):
        AnalysisRequest(species="Withania somnifera", bbox=(77, 8, 74, 12))
    with pytest.raises(ValidationError):
        AnalysisRequest(species="Withania somnifera", bbox=(-100, -60, 60, 60))
