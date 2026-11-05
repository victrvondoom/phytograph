"""Occurrence evidence collection from the GBIF Occurrence API.

The search area is a geodesic circle around the declared point, sent to GBIF as a
counter-clockwise WKT polygon. Responses are cached on disk with their original
retrieval time. A cached answer is always labelled ``cached``; it is never presented as live.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

from ..gbif import LIVE_MODE, PAGE_SIZE, GBIFClient, parse_occurrence
from .schemas import OccurrenceRecord, OccurrenceSearchResult

EARTH_RADIUS_KM = 6371.0088
MAX_RADIUS_KM = 100.0
MAX_RECORDS = 1000


def circle_polygon_wkt(lat: float, lon: float, radius_km: float, vertices: int = 36) -> str:
    """Approximate geodesic circle as a counter-clockwise WKT polygon (GBIF requires CCW rings)."""
    lat1, lon1 = math.radians(lat), math.radians(lon)
    delta = radius_km / EARTH_RADIUS_KM
    ring: list[tuple[float, float]] = []
    # Walk bearings in reverse (360 -> 0) so the ring is counter-clockwise on a north-up map.
    for i in range(vertices):
        bearing = math.radians(360 - i * 360 / vertices)
        lat2 = math.asin(math.sin(lat1) * math.cos(delta) + math.cos(lat1) * math.sin(delta) * math.cos(bearing))
        lon2 = lon1 + math.atan2(math.sin(bearing) * math.sin(delta) * math.cos(lat1), math.cos(delta) - math.sin(lat1) * math.sin(lat2))
        ring.append((((math.degrees(lon2) + 540) % 360) - 180, math.degrees(lat2)))
    ring.append(ring[0])
    return "POLYGON((" + ", ".join(f"{x:.6f} {y:.6f}" for x, y in ring) + "))"


def ring_is_counter_clockwise(wkt: str) -> bool:
    body = wkt[len("POLYGON(("):-2]
    pts = [tuple(map(float, p.split())) for p in body.split(", ")]
    area2 = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:]))
    return area2 > 0


def search_occurrences(
    client: GBIFClient,
    taxon_key: int,
    center_lat: float,
    center_lon: float,
    radius_km: float,
    limit: int = 300,
    refresh: bool = False,
) -> OccurrenceSearchResult:
    if not (0 < radius_km <= MAX_RADIUS_KM):
        raise ValueError(f"radius_km must be in (0, {MAX_RADIUS_KM}]")
    limit = max(1, min(limit, MAX_RECORDS))
    wkt = circle_polygon_wkt(center_lat, center_lon, radius_km)
    base = {
        "taxonKey": taxon_key,
        "geometry": wkt,
        "hasCoordinate": "true",
        "occurrenceStatus": "PRESENT",
    }
    records: list[OccurrenceRecord] = []
    urls: list[str] = []
    provs: list[dict[str, Any]] = []
    total = 0
    offset = 0
    while len(records) < limit:
        page_size = min(PAGE_SIZE, limit - len(records))
        body, prov = client.get_json(
            "/occurrence/search",
            {**base, "limit": page_size, "offset": offset},
            use_cache=not refresh,
            allow_stale=True,
        )
        provs.append(prov)
        urls.append(prov["url"])
        total = int(body.get("count", 0))
        results = body.get("results", [])
        mode = "cached" if prov.get("from_cache") else LIVE_MODE
        for raw in results:
            p = parse_occurrence(raw)
            records.append(OccurrenceRecord(
                gbif_id=p["gbif_id"],
                occurrence_key=p["occurrence_key"],
                scientific_name=p.get("scientific_name"),
                accepted_scientific_name=p.get("accepted_scientific_name"),
                taxon_key=taxon_key,
                lat=p["lat"],
                lon=p["lon"],
                coordinate_uncertainty_m=p["coordinate_uncertainty_m"],
                event_date=p["event_date"],
                year=p["year"],
                basis_of_record=p["basis_of_record"],
                occurrence_status=p["occurrence_status"],
                dataset_key=p["dataset_key"],
                dataset_name=p["dataset_name"],
                publisher_key=p["publisher_key"],
                institution_code=p["institution_code"],
                catalog_number=p["catalog_number"],
                license=p["license"],
                country_code=p["country_code"],
                issues=p["issues"],
                source_url=prov["url"],
                retrieved_at=prov["retrieved_at"],
                data_mode=mode,
            ))
        offset += len(results)
        if not results or offset >= total or offset >= MAX_RECORDS * 100:
            break

    records = records[:limit]
    cached = [p for p in provs if p.get("from_cache")]
    any_cached = bool(cached)
    original_times = sorted(p["retrieved_at"] for p in provs)
    stale_errors = [p["live_error"] for p in provs if p.get("live_error")]
    note = None
    if any_cached:
        note = (
            f"CACHED GBIF response(s), originally retrieved {original_times[0]}"
            + (f" (latest page {original_times[-1]})" if len(original_times) > 1 else "")
            + (f". Live request failed: {stale_errors[0]}" if stale_errors else ". Served from local cache, not a live request.")
        )
    return OccurrenceSearchResult(
        taxon_key=taxon_key,
        center_lat=center_lat,
        center_lon=center_lon,
        radius_km=radius_km,
        search_area_wkt_sha256=hashlib.sha256(wkt.encode()).hexdigest(),
        gbif_total_count=total,
        returned_count=len(records),
        truncated=total > len(records),
        records=records,
        source_urls=urls,
        retrieved_at=min(original_times) if original_times else "",
        data_mode="cached" if any_cached else LIVE_MODE,
        cached_note=note,
    )


