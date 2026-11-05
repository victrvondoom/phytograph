"""Deterministic occurrence-quality classification.

Every record receives exactly one class. Precedence: invalid > duplicate > insufficient_for_spatial_check
> usable_with_caution > usable. Questionable records are kept and labelled, never deleted.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date

from ..quality import NON_FIELD_BASIS, SEVERE_GBIF_ISSUES
from .occurrences import EARTH_RADIUS_KM
from .schemas import OccurrenceQualityFinding, OccurrenceQualityReport, OccurrenceQualityRequest, OccurrenceRecord, QualityReason
from . import METHOD_VERSION

# Demonstration operational geography: approximate bounding box covering Tamil Nadu and Kerala.
DEMO_REGION = {"name": "Tamil Nadu and Kerala (approximate bounding box)", "bbox": (74.8, 8.0, 80.4, 13.6)}

INVALID = {"INVALID_COORDINATE_RANGE", "ZERO_COORDINATES"}
DUPLICATE = {"DUPLICATE_OCCURRENCE_ID", "DUPLICATE_COORDINATE_DATE"}
INSUFFICIENT = {"MISSING_COORDINATES"}
CAUTION = {
    "EXCESSIVE_COORDINATE_UNCERTAINTY", "UNKNOWN_COORDINATE_UNCERTAINTY", "MISSING_OBSERVATION_DATE",
    "OUTSIDE_DEMONSTRATION_REGION", "REPEATED_COORDINATES", "MISSING_DATASET_ATTRIBUTION",
    "GBIF_SEVERE_GEOSPATIAL_ISSUE", "NON_FIELD_BASIS",
}

MESSAGES = {
    "INVALID_COORDINATE_RANGE": "Latitude or longitude is outside the valid range or not finite.",
    "ZERO_COORDINATES": "Coordinates are exactly (0, 0), a placeholder rather than a location.",
    "DUPLICATE_OCCURRENCE_ID": "This GBIF occurrence identifier already appeared earlier in the same result set.",
    "DUPLICATE_COORDINATE_DATE": "Same coordinates (5 dp) and event date as an earlier record with a different identifier.",
    "MISSING_COORDINATES": "No coordinates; this record cannot inform a spatial check.",
    "EXCESSIVE_COORDINATE_UNCERTAINTY": "Coordinate uncertainty exceeds the configured threshold.",
    "UNKNOWN_COORDINATE_UNCERTAINTY": "Coordinate uncertainty is not reported; precision is unknown.",
    "MISSING_OBSERVATION_DATE": "No observation date is reported.",
    "OUTSIDE_DEMONSTRATION_REGION": "Coordinates fall outside the configured demonstration region.",
    "REPEATED_COORDINATES": "The same rounded coordinates recur across many records; check for a centroid or gazetteer placement.",
    "MISSING_DATASET_ATTRIBUTION": "No dataset key is reported, so source attribution cannot be traced.",
    "GBIF_SEVERE_GEOSPATIAL_ISSUE": "GBIF flagged a severe geospatial issue on this record.",
    "NON_FIELD_BASIS": "Basis of record is fossil or living specimen; not a wild field observation.",
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, a)))


def _in_region(lat: float, lon: float, bbox: tuple[float, float, float, float]) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def _year_date_present(r: OccurrenceRecord) -> bool:
    if r.event_date:
        try:
            date.fromisoformat(r.event_date[:10])
            return True
        except ValueError:
            return r.year is not None
    return r.year is not None


def classify_records(req: OccurrenceQualityRequest, region_bbox: tuple[float, float, float, float] | None = None) -> OccurrenceQualityReport:
    region = region_bbox or DEMO_REGION["bbox"]
    records = req.records
    declared = None
    if req.declared_latitude is not None and req.declared_longitude is not None:
        declared = (req.declared_latitude, req.declared_longitude)

    # Pre-compute repeated coordinates (rounded 5 dp) across all records with finite coordinates.
    # Count DISTINCT identifiers per coordinate, so a duplicated identifier does not inflate the count.
    coord_ids: dict[tuple[float, float], set[str]] = defaultdict(set)
    for r in records:
        if _finite(r.lat, r.lon) and not _zero(r.lat, r.lon):
            coord_ids[(round(r.lat, 5), round(r.lon, 5))].add(r.gbif_id)
    coord_groups = {k: len(v) for k, v in coord_ids.items()}

    seen_ids: set[str] = set()
    seen_coord_date: dict[tuple, str] = {}
    findings: list[OccurrenceQualityFinding] = []
    reason_counter: Counter[str] = Counter()
    class_counter: Counter[str] = Counter()

    for r in records:
        codes: list[str] = []
        has_coords = r.lat is not None and r.lon is not None
        if r.lat is None or r.lon is None:
            if r.lat is not None or r.lon is not None:
                codes.append("INVALID_COORDINATE_RANGE")  # half a coordinate pair is malformed
            codes.append("MISSING_COORDINATES")
        elif not _finite(r.lat, r.lon) or abs(r.lat) > 90 or abs(r.lon) > 180:
            codes.append("INVALID_COORDINATE_RANGE")
        elif _zero(r.lat, r.lon):
            codes.append("ZERO_COORDINATES")

        valid_coords = has_coords and "INVALID_COORDINATE_RANGE" not in codes and "ZERO_COORDINATES" not in codes

        if r.gbif_id in seen_ids:
            codes.append("DUPLICATE_OCCURRENCE_ID")
        seen_ids.add(r.gbif_id)
        if valid_coords:
            key = (round(r.lat, 5), round(r.lon, 5), r.event_date or "")
            if key in seen_coord_date and seen_coord_date[key] != r.gbif_id:
                codes.append("DUPLICATE_COORDINATE_DATE")
            seen_coord_date.setdefault(key, r.gbif_id)

        if valid_coords:
            if r.coordinate_uncertainty_m is None:
                codes.append("UNKNOWN_COORDINATE_UNCERTAINTY")
            elif r.coordinate_uncertainty_m > req.uncertainty_threshold_m:
                codes.append("EXCESSIVE_COORDINATE_UNCERTAINTY")
            if not _in_region(r.lat, r.lon, region):
                codes.append("OUTSIDE_DEMONSTRATION_REGION")
            if coord_groups.get((round(r.lat, 5), round(r.lon, 5)), 0) >= req.repeated_coordinate_threshold:
                codes.append("REPEATED_COORDINATES")
        if not _year_date_present(r):
            codes.append("MISSING_OBSERVATION_DATE")
        if not r.dataset_key:
            codes.append("MISSING_DATASET_ATTRIBUTION")
        if SEVERE_GBIF_ISSUES.intersection(r.issues):
            codes.append("GBIF_SEVERE_GEOSPATIAL_ISSUE")
        if r.basis_of_record in NON_FIELD_BASIS:
            codes.append("NON_FIELD_BASIS")

        codes = list(dict.fromkeys(codes))
        if set(codes) & INVALID:
            cls = "invalid"
        elif set(codes) & DUPLICATE:
            cls = "duplicate"
        elif set(codes) & INSUFFICIENT:
            cls = "insufficient_for_spatial_check"
        elif set(codes) & CAUTION:
            cls = "usable_with_caution"
        else:
            cls = "usable"

        distance = None
        if declared and valid_coords:
            distance = round(_haversine_km(declared[0], declared[1], r.lat, r.lon), 2)

        reasons = [QualityReason(code=c, message=MESSAGES[c]) for c in codes]
        reason_counter.update(codes)
        class_counter[cls] += 1
        explanation = _explain(cls, codes)
        findings.append(OccurrenceQualityFinding(
            gbif_id=r.gbif_id,
            record_class=cls,
            reasons=reasons,
            explanation=explanation,
            distance_km_to_declared=distance,
            dataset_key=r.dataset_key,
            source_url=r.source_url,
        ))

    all_classes = ["usable", "usable_with_caution", "insufficient_for_spatial_check", "invalid", "duplicate"]
    return OccurrenceQualityReport(
        method_version=METHOD_VERSION,
        records_total=len(records),
        counts={c: class_counter.get(c, 0) for c in all_classes},
        reason_counts=dict(sorted(reason_counter.items())),
        findings=findings,
        parameters={
            "uncertainty_threshold_m": req.uncertainty_threshold_m,
            "repeated_coordinate_threshold": req.repeated_coordinate_threshold,
            "demonstration_region_bbox": list(region),
            "declared_point": list(declared) if declared else None,
        },
        limitations=[
            "Classes describe record quality for a spatial check; they do not establish that any record is correct.",
            "Questionable records are retained and labelled. Nothing is deleted.",
            "Zero records or excluded records do not show that the taxon is absent.",
        ],
    )


def _finite(lat: float | None, lon: float | None) -> bool:
    return lat is not None and lon is not None and math.isfinite(lat) and math.isfinite(lon)


def _zero(lat: float | None, lon: float | None) -> bool:
    return lat == 0 and lon == 0


def _explain(cls: str, codes: list[str]) -> str:
    if not codes:
        return "No quality problem detected by the rules in this method version."
    head = {
        "invalid": "Invalid for spatial use",
        "duplicate": "Duplicate record",
        "insufficient_for_spatial_check": "Insufficient information for a spatial check",
        "usable_with_caution": "Usable with caution",
        "usable": "Usable",
    }[cls]
    return f"{head}: " + "; ".join(MESSAGES[c] for c in codes)


