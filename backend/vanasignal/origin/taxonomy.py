"""Live botanical identity resolution through the GBIF Species API (/species/match).

Decision rules (never auto-select when plausible matches remain unresolved):

* NONE match, or a match above species rank              -> UNRESOLVED
* EXACT, ACCEPTED, species-level, no competing accepted   -> RESOLVED (automatic)
* EXACT, SYNONYM with accepted usage key, no competitors  -> SYNONYM_RESOLVED (automatic, accepted taxon)
* FUZZY/DOUBTFUL, or alternatives with other accepted keys -> AMBIGUOUS (user must confirm one candidate)

A user confirmation is accepted only if the chosen key is one of GBIF's candidate keys.
"""

from __future__ import annotations

from typing import Any

from ..gbif import LIVE_MODE, GBIFClient, GBIFError
from .schemas import TaxonCandidate, TaxonomyResolution

SPECIES_LEVEL = {"SPECIES", "SUBSPECIES", "VARIETY"}


class TaxonomyConfirmationError(ValueError):
    pass


def _candidate(d: dict[str, Any], match_type: str | None = None) -> TaxonCandidate | None:
    usage = d.get("usageKey")
    if usage is None:
        return None
    return TaxonCandidate(
        usage_key=int(usage),
        accepted_key=int(d["acceptedUsageKey"]) if d.get("acceptedUsageKey") is not None else None,
        scientific_name=d.get("scientificName") or d.get("canonicalName") or "",
        canonical_name=d.get("canonicalName"),
        rank=d.get("rank"),
        taxonomic_status=d.get("status"),
        match_type=match_type,
        confidence=d.get("confidence"),
        kingdom=d.get("kingdom"),
    )


def resolve_taxon(client: GBIFClient, submitted_name: str, *, allow_stale: bool = True, confirm_key: int | None = None) -> TaxonomyResolution:
    name = submitted_name.strip()
    try:
        body, prov = client.get_json("/species/match", {"name": name, "verbose": "true"}, allow_stale=allow_stale)
    except GBIFError:
        raise  # surfaced by the route as 503/502; never converted into a fake 'unresolved'

    source_url = prov["url"]
    retrieved_at = prov["retrieved_at"]
    data_mode = "cached" if prov.get("from_cache") else LIVE_MODE
    match_type = body.get("matchType", "NONE")
    top = _candidate(body, match_type) if body.get("usageKey") is not None else None
    alternatives = [c for c in (_candidate(a) for a in body.get("alternatives") or []) if c is not None]
    candidates = ([top] if top else []) + alternatives

    common = dict(submitted_name=name, source_url=source_url, retrieved_at=retrieved_at, data_mode=data_mode, candidates=candidates)

    if top is None or match_type == "NONE":
        return TaxonomyResolution(
            **common,
            resolution_status="UNRESOLVED",
            explanation=f"GBIF did not match '{name}' to any taxon. No occurrence search is run until a valid name is supplied.",
        )

    if top.rank not in SPECIES_LEVEL:
        return TaxonomyResolution(
            **common,
            resolution_status="UNRESOLVED",
            resolved_name=top.scientific_name,
            usage_key=top.usage_key,
            match_type=match_type,
            taxonomic_status=top.taxonomic_status,
            explanation=f"'{name}' matched at rank {top.rank}. A species-level name is required for occurrence evidence.",
        )

    accepted_keys = {c.accepted_key or c.usage_key for c in candidates if c.rank in SPECIES_LEVEL and (c.taxonomic_status in ("ACCEPTED", "SYNONYM", None) or c is top)}
    competing = accepted_keys - {top.accepted_key or top.usage_key}
    status = top.taxonomic_status
    accepted_key = top.accepted_key or top.usage_key

    if confirm_key is not None:
        keys = {c.usage_key for c in candidates} | {c.accepted_key for c in candidates if c.accepted_key}
        if confirm_key not in keys:
            raise TaxonomyConfirmationError(f"Key {confirm_key} is not among the GBIF candidates for '{name}'.")
        chosen = next((c for c in candidates if confirm_key in (c.usage_key, c.accepted_key)), None)
        chosen_accepted = (chosen.accepted_key or chosen.usage_key) if chosen else confirm_key
        return TaxonomyResolution(
            **common,
            resolution_status="RESOLVED" if (chosen and chosen.taxonomic_status == "ACCEPTED") else "SYNONYM_RESOLVED",
            resolved_name=chosen.scientific_name if chosen else None,
            accepted_name=chosen.scientific_name if chosen and chosen.taxonomic_status == "ACCEPTED" else None,
            taxon_key=chosen_accepted,
            usage_key=chosen.usage_key if chosen else confirm_key,
            taxonomic_status=chosen.taxonomic_status if chosen else None,
            match_type=chosen.match_type if chosen else None,
            confidence=chosen.confidence if chosen else None,
            selection="user_confirmed",
            explanation=f"User confirmed GBIF candidate key {confirm_key} for '{name}'.",
        )

    if match_type == "EXACT" and not competing and status in ("ACCEPTED", "SYNONYM", None):
        if status == "SYNONYM" and top.accepted_key is None:
            return TaxonomyResolution(**common, resolution_status="AMBIGUOUS", resolved_name=top.scientific_name,
                                      explanation="GBIF reports a synonym without an accepted taxon key; confirm the accepted taxon manually.")
        is_syn = status == "SYNONYM"
        return TaxonomyResolution(
            **common,
            resolution_status="SYNONYM_RESOLVED" if is_syn else "RESOLVED",
            resolved_name=top.scientific_name,
            accepted_name=None if is_syn else top.scientific_name,
            taxon_key=accepted_key,
            usage_key=top.usage_key,
            taxonomic_status=status,
            match_type=match_type,
            confidence=top.confidence,
            selection="automatic",
            explanation=(
                f"Exact GBIF match; submitted name is a synonym of accepted taxon key {accepted_key}."
                if is_syn else f"Exact GBIF match to an accepted species-level taxon (key {accepted_key})."
            ),
        )

    reasons = []
    if match_type != "EXACT":
        reasons.append(f"GBIF match type is {match_type}")
    if status not in ("ACCEPTED", "SYNONYM"):
        reasons.append(f"taxonomic status is {status}")
    if competing:
        reasons.append(f"{len(competing)} other accepted taxon key(s) appear among candidates")
    return TaxonomyResolution(
        **common,
        resolution_status="AMBIGUOUS",
        resolved_name=top.scientific_name,
        taxonomic_status=status,
        match_type=match_type,
        confidence=top.confidence,
        explanation="Ambiguous identity: " + "; ".join(reasons) + ". Select one candidate to continue; VanaSignal does not choose for you.",
    )
