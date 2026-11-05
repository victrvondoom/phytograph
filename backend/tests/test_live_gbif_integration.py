"""Live GBIF integration test. Runs only when api.gbif.org is reachable.

Skips with the recorded reason otherwise. A skip is NOT a pass: it means no live check happened.
"""

import pytest

from vanasignal.gbif import GBIFClient, GBIFError
from vanasignal.origin.occurrences import search_occurrences
import tempfile
from pathlib import Path


def _live_client():
    tmp = Path(tempfile.mkdtemp(prefix="gbif-live-"))
    return GBIFClient(tmp / "cache", timeout=15.0, max_retries=0, backoff_seconds=0.0)


@pytest.fixture(scope="module")
def live():
    client = _live_client()
    try:
        body, prov = client.get_json("/species/match", {"name": "Decalepis hamiltonii", "verbose": "true"}, use_cache=False)
    except GBIFError as exc:
        pytest.skip(f"LIVE GBIF NOT CHECKED: api.gbif.org unreachable from this environment ({exc}).")
    return client, body


def test_live_species_match_schema_has_expected_fields(live):
    _, body = live
    for key in ("usageKey", "matchType", "status", "rank"):
        assert key in body, f"GBIF species/match response missing '{key}' (schema drift?)"


def test_live_occurrence_schema_for_resolved_taxon(live):
    client, body = live
    key = body.get("acceptedUsageKey") or body.get("usageKey")
    res = search_occurrences(client, int(key), 11.6, 76.0, 100.0, limit=20, refresh=True)
    assert res.data_mode == "live"
    assert res.gbif_total_count >= 0
    for rec in res.records:
        assert rec.gbif_id and rec.source_url and rec.retrieved_at
