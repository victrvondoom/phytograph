"""GBIF API integration: species resolution and occurrence retrieval.

Every response is cached on disk together with its request URL and retrieval
timestamp, so each analysis can be traced back to the exact API calls that
produced it. Nothing here fabricates responses: if GBIF cannot be reached the
client raises ``GBIFUnavailableError`` and the caller must surface that.

API reference: https://techdocs.gbif.org/en/openapi/
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .models import ResolvedSpecies, SpeciesSuggestion

GBIF_API = "https://api.gbif.org/v1"
USER_AGENT = "VanaSignal/0.1 (biodiversity gap analysis; research prototype)"
PAGE_SIZE = 300  # GBIF maximum for occurrence/search
MAX_OFFSET = 100_000  # GBIF maximum offset for occurrence/search
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
ACCEPTED_RANKS = {"SPECIES", "SUBSPECIES", "VARIETY"}


class GBIFError(RuntimeError):
    """A GBIF request failed in a way that is not a normal empty result."""


class GBIFUnavailableError(GBIFError):
    """GBIF could not be reached (network, proxy or policy denial)."""


class SpeciesNotResolvedError(ValueError):
    """The name could not be matched to a GBIF taxon."""

    def __init__(self, message: str, suggestions: list[SpeciesSuggestion]):
        super().__init__(message)
        self.suggestions = suggestions


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bbox_to_wkt(bbox: tuple[float, float, float, float]) -> str:
    """Counter-clockwise WKT polygon for a bounding box (GBIF expects CCW rings)."""
    min_lon, min_lat, max_lon, max_lat = bbox
    ring = [
        (min_lon, min_lat),
        (max_lon, min_lat),
        (max_lon, max_lat),
        (min_lon, max_lat),
        (min_lon, min_lat),
    ]
    coords = ", ".join(f"{x} {y}" for x, y in ring)
    return f"POLYGON(({coords}))"


def parse_occurrence(r: dict[str, Any]) -> dict[str, Any]:
    """Keep the fields needed for quality audit, analysis and provenance."""
    return {
        "gbif_id": str(r.get("gbifID") or r.get("key")),
        "occurrence_key": r.get("key"),
        "species_key": r.get("speciesKey"),
        "accepted_scientific_name": r.get("acceptedScientificName"),
        "lat": r.get("decimalLatitude"),
        "lon": r.get("decimalLongitude"),
        "coordinate_uncertainty_m": r.get("coordinateUncertaintyInMeters"),
        "event_date": r.get("eventDate"),
        "year": r.get("year"),
        "basis_of_record": r.get("basisOfRecord"),
        "occurrence_status": r.get("occurrenceStatus"),
        "recorded_by": r.get("recordedBy"),
        "country_code": r.get("countryCode"),
        "dataset_key": r.get("datasetKey"),
        "dataset_name": r.get("datasetName"),
        "publisher_key": r.get("publishingOrgKey"),
        "institution_code": r.get("institutionCode"),
        "catalog_number": r.get("catalogNumber"),
        "license": r.get("license"),
        "issues": list(r.get("issues") or []),
        "last_interpreted": r.get("lastInterpreted"),
    }


class GBIFClient:
    """Thin, cached, retrying HTTP client for the GBIF REST API."""

    def __init__(
        self,
        cache_dir: str | Path,
        timeout: float = 30.0,
        max_retries: int = 3,
        backoff_seconds: float = 2.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self._client = httpx.Client(
            timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            transport=transport,
        )
        self.request_log: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ HTTP
    def _cache_file(self, url: str) -> Path:
        return self.cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.json"

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
        """GET a GBIF endpoint. Returns ``(body, provenance)``."""
        url = str(httpx.Request("GET", f"{GBIF_API}{path}", params=params or {}).url)
        cache_file = self._cache_file(url)
        if cache_file.exists():
            envelope = json.loads(cache_file.read_text(encoding="utf-8"))
            prov = dict(envelope["provenance"], from_cache=True)
            self.request_log.append(prov)
            return envelope["body"], prov

        last_error = "unknown"
        for attempt in range(self.max_retries + 1):
            try:
                response = self._client.get(url)
            except httpx.TransportError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            else:
                if response.status_code == 200:
                    body = response.json()
                    prov = {
                        "url": url,
                        "http_status": 200,
                        "retrieved_at": utc_now(),
                        "from_cache": False,
                    }
                    tmp = cache_file.with_suffix(".tmp")
                    tmp.write_text(json.dumps({"body": body, "provenance": prov}), encoding="utf-8")
                    os.replace(tmp, cache_file)
                    self.request_log.append(prov)
                    return body, prov
                if response.status_code not in RETRYABLE_STATUS:
                    raise GBIFError(f"GBIF returned HTTP {response.status_code} for {url}")
                last_error = f"HTTP {response.status_code}"
            if attempt < self.max_retries:
                time.sleep(self.backoff_seconds * (2**attempt))

        raise GBIFUnavailableError(f"GBIF unreachable after {self.max_retries + 1} attempts ({last_error}): {url}")

    def health(self) -> dict[str, Any]:
        """Lightweight reachability probe used by the dashboard."""
        started = time.monotonic()
        try:
            body, _ = self.get_json("/species/match", {"name": "Puma concolor"})
            return {"reachable": True, "latency_ms": round((time.monotonic() - started) * 1000), "probe_usage_key": body.get("usageKey")}
        except GBIFError as exc:
            return {"reachable": False, "error": str(exc)}

    # --------------------------------------------------------- species
    def resolve_species(self, name: str) -> ResolvedSpecies:
        body, prov = self.get_json("/species/match", {"name": name, "verbose": "true"})
        suggestions = [
            SpeciesSuggestion(
                key=int(alt["usageKey"]),
                scientific_name=alt.get("scientificName", ""),
                rank=alt.get("rank"),
                status=alt.get("status"),
                kingdom=alt.get("kingdom"),
            )
            for alt in (body.get("alternatives") or [])
            if alt.get("usageKey") is not None
        ]
        match_type = body.get("matchType", "NONE")
        if match_type == "NONE" or body.get("usageKey") is None:
            raise SpeciesNotResolvedError(f"GBIF could not match '{name}' to a taxon.", suggestions)

        rank = body.get("rank")
        if rank not in ACCEPTED_RANKS:
            raise SpeciesNotResolvedError(
                f"'{name}' resolved to rank {rank}. Provide a species-level binomial for occurrence analysis.",
                suggestions,
            )

        warnings: list[str] = []
        if match_type != "EXACT":
            warnings.append(f"GBIF matchType is {match_type} (confidence {body.get('confidence')}); verify the taxon before interpreting results.")
        status = body.get("status")
        accepted_key = body.get("acceptedUsageKey") or body["usageKey"]
        if status and status != "ACCEPTED":
            warnings.append(f"Name status is {status}; occurrences were retrieved for the accepted taxon.")

        return ResolvedSpecies(
            query=name,
            usage_key=int(body["usageKey"]),
            accepted_key=int(accepted_key),
            scientific_name=body.get("scientificName") or name,
            canonical_name=body.get("canonicalName"),
            rank=rank,
            status=status,
            match_type=match_type,
            confidence=body.get("confidence"),
            kingdom=body.get("kingdom"),
            warnings=warnings,
            retrieved_at=prov["retrieved_at"],
            request_url=prov["url"],
            suggestions=suggestions,
        )

    # ------------------------------------------------------- occurrences
    def count_occurrences(self, taxon_key: int, **filters: Any) -> int:
        params = {"taxonKey": taxon_key, "limit": 0, **filters}
        body, _ = self.get_json("/occurrence/search", params)
        return int(body.get("count", 0))

    def fetch_occurrences(
        self,
        taxon_key: int,
        bbox: tuple[float, float, float, float],
        max_records: int,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Retrieve present, georeferenced occurrences inside ``bbox``.

        Returns ``(records, meta)``. ``meta`` records the total GBIF count, how
        many records were retrieved, whether the retrieval was truncated, and
        the URL of every page requested.
        """
        base = {
            "taxonKey": taxon_key,
            "geometry": bbox_to_wkt(bbox),
            "hasCoordinate": "true",
            "occurrenceStatus": "PRESENT",
        }
        records: list[dict[str, Any]] = []
        page_urls: list[str] = []
        total = None
        offset = 0
        while True:
            params = {**base, "limit": PAGE_SIZE, "offset": offset}
            body, prov = self.get_json("/occurrence/search", params)
            page_urls.append(prov["url"])
            if total is None:
                total = int(body.get("count", 0))
            results = body.get("results", [])
            records.extend(parse_occurrence(r) for r in results)
            offset += PAGE_SIZE
            if not results or len(records) >= max_records or offset >= total or offset >= MAX_OFFSET:
                break
        records = records[:max_records]
        meta = {
            "gbif_total_count": total,
            "retrieved_count": len(records),
            "truncated": (total or 0) > len(records),
            "page_urls": page_urls,
            "retrieved_at": utc_now(),
        }
        return records, meta

    def close(self) -> None:
        self._client.close()
