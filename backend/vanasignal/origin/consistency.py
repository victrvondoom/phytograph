"""Origin consistency: compares declared identity and location with public occurrence evidence.

Statuses describe ONLY the public evidence available now:

* IDENTITY_UNRESOLVED        – no single accepted taxon can be established (a user may confirm one).
* NOT_CHECKED                – the check could not be run: no coordinates, or taxonomy/occurrence retrieval failed.
* INSUFFICIENT_PUBLIC_RECORDS – too few usable public records, zero returned, or only partial local support.
* LOCATION_CONFLICT          – enough usable public records lie in the search area, but none lies within the
                               near radius of the declared point. This is a conflict at this scale in public data,
                               not proof that the batch is false.
* CORROBORATED               – enough usable public records lie within the near radius of the declared point.
                               Still not proof that this supplier batch originated there.
"""

from __future__ import annotations

from typing import Any

from .schemas import OccurrenceQualityReport, OccurrenceSearchResult, OriginConsistencyResult, TaxonomyResolution

NEAR_RADIUS_KM = 25.0
MIN_SUPPORT_RECORDS = 3

COMMON_LIMITATIONS = [
    "A public observation near the declared location does not establish that a specific supplier batch originated there.",
    "An occurrence elsewhere does not automatically establish that the declared location is false.",
    "A public observation is not proof of a harvestable population or of sustainable harvesting.",
    "Only records with usable quality class are counted; cautionary and excluded records are reported but not counted.",
]


def evaluate_origin(
    *,
    declared_latitude: float | None,
    declared_longitude: float | None,
    taxonomy: TaxonomyResolution | None,
    search: OccurrenceSearchResult | None,
    quality: OccurrenceQualityReport | None,
    service_error: str | None = None,
    near_radius_km: float = NEAR_RADIUS_KM,
    min_support: int = MIN_SUPPORT_RECORDS,
) -> OriginConsistencyResult:
    limits = list(COMMON_LIMITATIONS)

    if taxonomy is None:
        return OriginConsistencyResult(
            status="NOT_CHECKED",
            explanation="The botanical identity could not be checked because the GBIF Species API was unavailable. " + (service_error or ""),
            evidence={"service_error": service_error},
            limitations=limits,
        )
    if taxonomy.resolution_status not in ("RESOLVED", "SYNONYM_RESOLVED") or taxonomy.taxon_key is None:
        return OriginConsistencyResult(
            status="IDENTITY_UNRESOLVED",
            explanation=f"Identity status is {taxonomy.resolution_status}: {taxonomy.explanation} Occurrence evidence was not compared.",
            evidence={"resolution_status": taxonomy.resolution_status, "candidates": len(taxonomy.candidates)},
            limitations=limits,
        )
    if declared_latitude is None or declared_longitude is None:
        return OriginConsistencyResult(
            status="NOT_CHECKED",
            explanation="The batch has no declared coordinates, so public occurrences cannot be compared with a submitted location.",
            evidence={"declared_point": None},
            limitations=limits,
        )
    if search is None or quality is None:
        return OriginConsistencyResult(
            status="NOT_CHECKED",
            explanation="Occurrence evidence was not retrieved, so the comparison was not run. " + (service_error or ""),
            evidence={"service_error": service_error},
            limitations=limits,
        )

    usable = [f for f in quality.findings if f.record_class == "usable"]
    usable_near = [f for f in usable if f.distance_km_to_declared is not None and f.distance_km_to_declared <= near_radius_km]
    nearest = min((f.distance_km_to_declared for f in usable if f.distance_km_to_declared is not None), default=None)
    evidence: dict[str, Any] = {
        "taxon_key": taxonomy.taxon_key,
        "gbif_total_count": search.gbif_total_count,
        "returned_count": search.returned_count,
        "search_radius_km": search.radius_km,
        "near_radius_km": near_radius_km,
        "min_support_records": min_support,
        "usable_records_in_search_area": len(usable),
        "usable_records_within_near_radius": len(usable_near),
        "nearest_usable_record_km": nearest,
        "class_counts": quality.counts,
        "data_mode": search.data_mode,
    }
    if search.cached_note:
        evidence["cached_note"] = search.cached_note
    limits.append(search.absence_note)

    if search.gbif_total_count == 0 or search.returned_count == 0:
        return OriginConsistencyResult(
            status="INSUFFICIENT_PUBLIC_RECORDS",
            explanation="GBIF returned zero georeferenced present records in the search area. This is not evidence of absence.",
            evidence=evidence, limitations=limits,
        )
    if len(usable) < min_support:
        return OriginConsistencyResult(
            status="INSUFFICIENT_PUBLIC_RECORDS",
            explanation=f"Only {len(usable)} usable public record(s) in the search area; at least {min_support} are needed for a comparison.",
            evidence=evidence, limitations=limits,
        )
    if len(usable_near) >= min_support:
        return OriginConsistencyResult(
            status="CORROBORATED",
            explanation=f"{len(usable_near)} usable public record(s) lie within {near_radius_km:g} km of the declared point, for taxon key {taxonomy.taxon_key}. This corroborates the declared area only; it does not prove the batch origin.",
            evidence=evidence, limitations=limits,
        )
    if len(usable_near) == 0:
        return OriginConsistencyResult(
            status="LOCATION_CONFLICT",
            explanation=f"{len(usable)} usable public record(s) lie within the {search.radius_km:g} km search area, but none lies within {near_radius_km:g} km of the declared point (nearest {nearest:.1f} km). This is a conflict at this scale in public data, not proof that the batch is false.",
            evidence=evidence, limitations=limits,
        )
    return OriginConsistencyResult(
        status="INSUFFICIENT_PUBLIC_RECORDS",
        explanation=f"Partial local support: {len(usable_near)} usable record(s) within {near_radius_km:g} km, below the {min_support} needed to corroborate the declared point.",
        evidence=evidence, limitations=limits,
    )
