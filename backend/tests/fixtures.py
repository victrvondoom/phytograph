"""SYNTHETIC TEST FIXTURES. Nothing in this module is GBIF data.

``synthetic_records`` generates occurrence-like rows, and ``FakeGBIF`` is an
httpx transport that answers in the shape of the GBIF REST API. They exist so
the real client, audit, spatial and pipeline code can be exercised offline.
Outputs produced from these fixtures are labelled ``fixture`` in every manifest.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np

from vanasignal.models import ResolvedSpecies

REGION = (74.8, 8.1, 77.5, 12.8)  # Kerala-ish test box
HOTSPOTS = [(10.0, 76.3), (11.3, 75.8), (8.7, 77.0)]  # (lat, lon)
FIXTURE_ACCEPTED_KEY = 9000001
FIXTURE_USAGE_KEY = 9000001


def synthetic_records(n: int = 240, seed: int = 0, with_faults: bool = False) -> list[dict[str, Any]]:
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    for i in range(n):
        clat, clon = HOTSPOTS[i % len(HOTSPOTS)]
        if rng.random() < 0.25:  # some scattered records
            lat = rng.uniform(REGION[1] + 0.2, REGION[3] - 0.2)
            lon = rng.uniform(REGION[0] + 0.2, REGION[2] - 0.2)
        else:
            lat = clat + rng.normal(0, 0.12)
            lon = clon + rng.normal(0, 0.12)
        unc = float(rng.choice([10, 100, 500, 1000, 3000]))
        rows.append({
            "gbif_id": str(100000 + i),
            "occurrence_key": 500000 + i,
            "species_key": FIXTURE_ACCEPTED_KEY,
            "accepted_scientific_name": "Fixturea testis",
            "lat": round(float(lat), 6),
            "lon": round(float(lon), 6),
            "coordinate_uncertainty_m": unc,
            "event_date": f"{2000 + (i % 20)}-0{1 + i % 9}-1{i % 9}",
            "year": 2000 + (i % 20),
            "basis_of_record": "PRESERVED_SPECIMEN" if i % 5 else "HUMAN_OBSERVATION",
            "occurrence_status": "PRESENT",
            "recorded_by": f"collector {i % 7}",
            "country_code": "IN",
            "dataset_key": f"ds-{i % 3}",
            "dataset_name": f"Synthetic dataset {i % 3}",
            "publisher_key": "org-0",
            "institution_code": "TEST",
            "catalog_number": f"CAT-{i}",
            "license": "CC_BY_4_0",
            "issues": [],
            "last_interpreted": "2026-01-01T00:00:00Z",
        })
    return rows


class FixtureSource:
    """RecordSource double. Reports its name as 'fixture', never 'gbif'."""

    name = "fixture"

    def __init__(self, records: list[dict[str, Any]], missing_absence: bool = False):
        self.records = records
        self.missing_absence = missing_absence

    def resolve(self, species: str) -> ResolvedSpecies:
        return ResolvedSpecies(
            query=species, usage_key=FIXTURE_USAGE_KEY, accepted_key=FIXTURE_ACCEPTED_KEY,
            scientific_name="Fixturea testis", canonical_name="Fixturea testis", rank="SPECIES",
            status="ACCEPTED", match_type="EXACT", confidence=100, kingdom="Plantae",
            retrieved_at="fixture", request_url="fixture://species", suggestions=[],
        )

    def fetch(self, resolved, bbox, max_records):
        recs = self.records[:max_records]
        return [dict(r) for r in recs], {
            "gbif_total_count": len(self.records),
            "retrieved_count": len(recs),
            "truncated": len(self.records) > len(recs),
            "page_urls": ["fixture://occurrence/search"],
            "retrieved_at": "fixture",
        }

    def counts(self, resolved, bbox):
        return {"absent_records_with_coordinates_in_region": 0, "present_records_without_coordinates_species_wide": 0,
                "note": "fixture"}


class FakeGBIF:
    """httpx transport that mimics the GBIF endpoints used by VanaSignal. Test double only."""

    def __init__(self, records: list[dict[str, Any]], status_script: list[int] | None = None, species_status: str = "ACCEPTED"):
        self.records = records
        self.calls: list[str] = []
        self.status_script = list(status_script or [])
        self.species_status = species_status
        self.transport = httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(str(request.url))
        if self.status_script:
            code = self.status_script.pop(0)
            if code != 200:
                return httpx.Response(code, text="fake failure")
        url = urlparse(str(request.url))
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/v1/species/match":
            if q.get("name", "").lower().startswith("withania"):
                body = {
                    "usageKey": 9100001, "acceptedUsageKey": 9100002,
                    "scientificName": "Withania somnifera (L.) Dunal", "canonicalName": "Withania somnifera",
                    "rank": "SPECIES", "status": self.species_status, "matchType": "EXACT", "confidence": 100,
                    "kingdom": "Plantae",
                    "alternatives": [{"usageKey": 9100003, "scientificName": "Withania somnifera var. x", "rank": "VARIETY", "status": "ACCEPTED"}],
                }
            elif q.get("name", "").lower().startswith("genus"):
                body = {"usageKey": 9200001, "scientificName": "Genusa", "rank": "GENUS", "matchType": "EXACT", "status": "ACCEPTED", "alternatives": []}
            else:
                body = {"matchType": "NONE", "alternatives": [{"usageKey": 9300001, "scientificName": "Withania somnif", "rank": "SPECIES", "status": "ACCEPTED"}]}
            return httpx.Response(200, json=body)
        if url.path == "/v1/occurrence/search":
            if q.get("occurrenceStatus") == "ABSENT":
                return httpx.Response(200, json={"count": 7, "results": []})
            if q.get("hasCoordinate") == "false":
                return httpx.Response(200, json={"count": 3, "results": []})
            limit = int(q.get("limit", 300))
            offset = int(q.get("offset", 0))
            page = self.records[offset: offset + limit]
            results = [_to_gbif_json(r) for r in page]
            return httpx.Response(200, json={"count": len(self.records), "offset": offset, "limit": limit,
                                             "endOfRecords": offset + limit >= len(self.records), "results": results})
        return httpx.Response(404, json={"message": "not in fake"})


def _to_gbif_json(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": r["occurrence_key"], "gbifID": r["gbif_id"], "speciesKey": r["species_key"],
        "acceptedScientificName": r["accepted_scientific_name"], "decimalLatitude": r["lat"],
        "decimalLongitude": r["lon"], "coordinateUncertaintyInMeters": r["coordinate_uncertainty_m"],
        "eventDate": r["event_date"], "year": r["year"], "basisOfRecord": r["basis_of_record"],
        "occurrenceStatus": r["occurrence_status"], "recordedBy": r["recorded_by"],
        "countryCode": r["country_code"], "datasetKey": r["dataset_key"], "datasetName": r["dataset_name"],
        "publishingOrgKey": r["publisher_key"], "institutionCode": r["institution_code"],
        "catalogNumber": r["catalog_number"], "license": r["license"], "issues": r["issues"],
        "lastInterpreted": r["last_interpreted"],
    }


def dumps(obj: Any) -> str:
    return json.dumps(obj)
