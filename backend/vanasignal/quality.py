"""Occurrence-quality audit.

Each record receives explicit, named flags. Records are then assigned one of:

* ``excluded``     – unusable for spatial analysis (missing/invalid/zero coordinates,
                     outside the study region, or duplicate). Weight 0.
* ``questionable`` – usable but weaker evidence (high coordinate uncertainty, a severe
                     GBIF geospatial issue, or a non-field basis of record). Weight 0.5.
* ``clean``        – no problem flag that affects location. Weight 1.0.

Weights are a stated analytical choice (see AGENTS.md); they are not calibrated
probabilities of correctness.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import shapely

# GBIF issue codes that indicate the location itself is unreliable.
SEVERE_GBIF_ISSUES = {
    "ZERO_COORDINATE",
    "COORDINATE_OUT_OF_RANGE",
    "COORDINATE_INVALID",
    "COUNTRY_COORDINATE_MISMATCH",
    "GEODETIC_DATUM_INVALID",
    "COORDINATE_REPROJECTION_FAILED",
    "COORDINATE_REPROJECTION_SUSPICIOUS",
    "PRESUMED_SWAPPED_COORDINATE",
    "PRESUMED_NEGATED_LATITUDE",
    "PRESUMED_NEGATED_LONGITUDE",
}
NON_FIELD_BASIS = {"FOSSIL_SPECIMEN", "LIVING_SPECIMEN"}
WEIGHT_CLEAN = 1.0
WEIGHT_QUESTIONABLE = 0.5
WEIGHT_EXCLUDED = 0.0

REQUIRED_COLUMNS = ["gbif_id", "lat", "lon"]


def _issue_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    return []


def audit_occurrences(
    df: pd.DataFrame,
    bbox: tuple[float, float, float, float],
    uncertainty_threshold_m: float = 5000.0,
    land: Any | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Flag every record and summarise the audit.

    ``land`` is an optional shapely geometry (union of land polygons). When given,
    records with valid coordinates that fall outside it are flagged ``off_land``
    and treated as questionable: a plant record placed at sea usually indicates a
    georeferencing error, but coastal records can be legitimate.

    Returns the annotated DataFrame (one row per input record, same order) and a
    JSON-serialisable summary. Input columns follow ``gbif.parse_occurrence``.
    """
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        raise ValueError(f"occurrence table is missing columns: {missing_cols}")

    out = df.copy().reset_index(drop=True)
    lat = pd.to_numeric(out["lat"], errors="coerce")
    lon = pd.to_numeric(out["lon"], errors="coerce")
    unc = pd.to_numeric(out.get("coordinate_uncertainty_m", pd.Series(np.nan, index=out.index)), errors="coerce")
    issues = out.get("issues", pd.Series([[]] * len(out), index=out.index)).map(_issue_list)
    basis = out.get("basis_of_record", pd.Series([None] * len(out), index=out.index))
    min_lon, min_lat, max_lon, max_lat = bbox

    flags = pd.DataFrame(index=out.index)
    flags["flag_missing_coordinates"] = lat.isna() | lon.isna()
    has_coords = ~flags["flag_missing_coordinates"]
    flags["flag_invalid_coordinates"] = has_coords & ((lat.abs() > 90) | (lon.abs() > 180) | ~np.isfinite(lat) | ~np.isfinite(lon))
    flags["flag_zero_coordinates"] = has_coords & (lat == 0) & (lon == 0)
    coords_valid = has_coords & ~flags["flag_invalid_coordinates"]
    flags["flag_outside_study_region"] = coords_valid & ~(
        (lon >= min_lon) & (lon <= max_lon) & (lat >= min_lat) & (lat <= max_lat)
    )

    # Duplicates: identical rounded coordinate + event date, among records that
    # have usable coordinates. The first occurrence (by gbif_id) is kept.
    dup_candidates = coords_valid & ~flags["flag_outside_study_region"] & ~flags["flag_zero_coordinates"]
    date_key = out["event_date"].fillna("").astype(str) if "event_date" in out.columns else pd.Series("", index=out.index)
    key_frame = pd.DataFrame(
        {
            "lat5": lat.round(5),
            "lon5": lon.round(5),
            "date": date_key,
        },
        index=out.index,
    )
    sortable = out.assign(_sort_id=out["gbif_id"].astype(str)).sort_values("_sort_id", kind="stable")
    dup_flag = pd.Series(False, index=out.index)
    if dup_candidates.any():
        ordered_keys = key_frame.loc[sortable.index]
        ordered_mask = dup_candidates.loc[sortable.index]
        sub = ordered_keys[ordered_mask]
        dup_positions = sub.duplicated(keep="first")
        dup_flag.loc[dup_positions[dup_positions].index] = True
    exact_id_dup = out.duplicated(subset=["gbif_id"], keep="first")
    dup_flag = dup_flag | exact_id_dup
    flags["flag_duplicate"] = dup_flag

    flags["flag_high_uncertainty"] = unc > uncertainty_threshold_m
    flags["flag_unknown_uncertainty"] = unc.isna()
    flags["flag_severe_gbif_issue"] = issues.map(lambda xs: bool(SEVERE_GBIF_ISSUES.intersection(xs)))
    flags["flag_minor_gbif_issue"] = issues.map(lambda xs: bool(xs) and not bool(SEVERE_GBIF_ISSUES.intersection(xs)))
    flags["flag_non_field_basis"] = basis.isin(NON_FIELD_BASIS)
    flags["flag_off_land"] = False
    if land is not None:
        on_land = np.ones(len(out), dtype=bool)
        check = (coords_valid & ~flags["flag_outside_study_region"]).to_numpy()
        if check.any():
            on_land[check] = shapely.intersects_xy(land, lon.to_numpy()[check], lat.to_numpy()[check])
        flags["flag_off_land"] = check & ~on_land
    year = pd.to_numeric(out.get("year", pd.Series(np.nan, index=out.index)), errors="coerce")
    flags["flag_missing_date"] = year.isna() & (date_key == "")

    excluded_cols = [
        "flag_missing_coordinates",
        "flag_invalid_coordinates",
        "flag_zero_coordinates",
        "flag_outside_study_region",
        "flag_duplicate",
    ]
    questionable_cols = ["flag_high_uncertainty", "flag_severe_gbif_issue", "flag_non_field_basis", "flag_off_land"]
    excluded = flags[excluded_cols].any(axis=1)
    questionable = ~excluded & flags[questionable_cols].any(axis=1)

    status = pd.Series("clean", index=out.index)
    status[questionable] = "questionable"
    status[excluded] = "excluded"
    weight = pd.Series(WEIGHT_CLEAN, index=out.index)
    weight[questionable] = WEIGHT_QUESTIONABLE
    weight[excluded] = WEIGHT_EXCLUDED

    flag_matrix = flags.to_numpy(dtype=bool)
    flag_names = [c.removeprefix("flag_") for c in flags.columns]
    reasons = [
        ";".join(name for name, hit in zip(flag_names, row) if hit)
        for row in flag_matrix
    ]

    out["quality_status"] = status.values
    out["quality_weight"] = weight.values
    out["quality_reasons"] = reasons
    out = pd.concat([out, flags.reset_index(drop=True)], axis=1)
    out["lat_clean"] = lat.where(coords_valid & ~excluded, np.nan).values
    out["lon_clean"] = lon.where(coords_valid & ~excluded, np.nan).values

    summary = summarise_audit(out, flags, unc, issues, uncertainty_threshold_m)
    return out, summary


def summarise_audit(
    annotated: pd.DataFrame,
    flags: pd.DataFrame,
    unc: pd.Series,
    issues: pd.Series,
    uncertainty_threshold_m: float,
) -> dict[str, Any]:
    n = int(len(annotated))
    status_counts = annotated["quality_status"].value_counts().to_dict()
    flag_counts = {c.removeprefix("flag_"): int(flags[c].sum()) for c in flags.columns}
    issue_counter: dict[str, int] = {}
    for xs in issues:
        for code in xs:
            issue_counter[code] = issue_counter.get(code, 0) + 1
    top_issues = sorted(issue_counter.items(), key=lambda kv: kv[1], reverse=True)[:15]

    datasets = annotated["dataset_key"].dropna().nunique() if "dataset_key" in annotated.columns else 0
    licenses = (
        annotated["license"].fillna("UNSPECIFIED").value_counts().to_dict()
        if "license" in annotated.columns
        else {}
    )
    years = pd.to_numeric(annotated.get("year", pd.Series(dtype=float)), errors="coerce").dropna()
    usable = annotated[annotated["quality_weight"] > 0]

    return {
        "records_total": n,
        "records_usable": int(len(usable)),
        "records_usable_weighted": round(float(usable["quality_weight"].sum()), 2),
        "status_counts": {k: int(v) for k, v in status_counts.items()},
        "flag_counts": flag_counts,
        "missing_coordinate_share": round(flag_counts["missing_coordinates"] / n, 4) if n else 0.0,
        "duplicate_share": round(flag_counts["duplicate"] / n, 4) if n else 0.0,
        "questionable_share": round(status_counts.get("questionable", 0) / n, 4) if n else 0.0,
        "coordinate_uncertainty_threshold_m": uncertainty_threshold_m,
        "uncertainty_median_m": float(unc.median()) if unc.notna().any() else None,
        "top_gbif_issues": [{"issue": k, "count": v} for k, v in top_issues],
        "distinct_datasets": int(datasets),
        "license_counts": {str(k): int(v) for k, v in licenses.items()},
        "year_range": [int(years.min()), int(years.max())] if len(years) else None,
        "warnings": _audit_warnings(n, flag_counts, usable),
    }


def _audit_warnings(n: int, flag_counts: dict[str, int], usable: pd.DataFrame) -> list[str]:
    warnings: list[str] = []
    if n == 0:
        return ["No records were retrieved. An absence of records is not evidence of species absence."]
    if flag_counts.get("missing_coordinates", 0) / n > 0.2:
        warnings.append("More than 20% of retrieved records lack coordinates; they cannot inform spatial coverage.")
    if flag_counts.get("duplicate", 0) / n > 0.1:
        warnings.append("More than 10% of records are duplicate-coordinate/date pairs; verify dataset overlap.")
    if len(usable) < 30:
        warnings.append("Fewer than 30 usable records: coverage statistics and benchmark results are unstable.")
    if flag_counts.get("off_land", 0) / n > 0.05:
        warnings.append("More than 5% of records fall outside the land mask; check georeferencing before interpreting coverage.")
    if flag_counts.get("non_field_basis", 0) > 0:
        warnings.append("Some records are fossil or living-specimen basis; they indicate where material exists, not wild field occurrence.")
    return warnings
