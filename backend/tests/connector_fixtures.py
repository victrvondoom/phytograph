"""Recorded-shape connector doubles for deterministic unit tests.

The responses come from ``tests/fixtures/gbif`` (hand-authored, see its README). The transport
implements only the endpoints VanaSignal calls, with optional failure modes, and counts requests.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

FIX = Path(__file__).parent / "fixtures" / "gbif"
SPECIES = {
    "decalepis hamiltonii": "species_match_exact.json",
    "gymnema hamiltonii fixture syn.": "species_match_synonym.json",
    "withania somnifera": "species_match_ambiguous.json",
    "nonexistentia fakei": "species_match_none.json",
    "decalepis": "species_match_genus.json",
}
OCCURRENCES = {"900000101": "occurrence_planted_errors.json", "900000303": "occurrence_empty.json"}


class ConnectorDouble:
    def __init__(self, mode: str = "ok"):
        self.mode = mode  # ok | timeout | http403 | http503
        self.calls: list[str] = []
        self.transport = httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(str(request.url))
        if self.mode == "timeout":
            raise httpx.ReadTimeout("simulated timeout", request=request)
        if self.mode == "http403":
            return httpx.Response(403, text="forbidden")
        if self.mode == "http503":
            return httpx.Response(503, text="unavailable")
        url = urlparse(str(request.url))
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/v1/species/match":
            name = q.get("name", "").lower()
            fname = SPECIES.get(name)
            if fname is None:
                return httpx.Response(404, json={"message": "not in fixture set"})
            return httpx.Response(200, json=json.loads((FIX / fname).read_text()))
        if url.path == "/v1/occurrence/search":
            fname = OCCURRENCES.get(q.get("taxonKey", ""))
            if fname is None:
                return httpx.Response(404, json={"message": "no fixture for taxon"})
            payload = json.loads((FIX / fname).read_text())
            results = payload["results"]
            offset = int(q.get("offset", 0))
            limit = int(q.get("limit", 300))
            page = results[offset: offset + limit]
            return httpx.Response(200, json={"count": len(results), "offset": offset, "limit": limit,
                                             "endOfRecords": offset + limit >= len(results), "results": page})
        return httpx.Response(404, json={"message": "unknown path"})
