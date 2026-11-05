"""Reproducible benchmarks for VanaSignal.

Three experiments, all computed from the data supplied (nothing is hard-coded):

1. **Withheld-observation survey ranking.** For each seed, a random share of usable
   records is withheld. Each strategy ranks grid cells using *training records only*
   and selects the top K cells. We measure whether withheld records (and cells that
   hold withheld records but no training records, "novel cells") fall in the
   selected set, and how much the selection extends geographic coverage.
   Strategies: ``random``, ``highest_count`` (the naive baseline), ``vanasignal``
   (quality-aware priority) and ``vanasignal_no_quality`` (ablation without the
   quality-deficit term).

2. **Observation-quality detection.** Known faults are injected into a copy of the
   retrieved records and the audit is run on the result. Ground truth is the
   injection log, not an expert label. Faults the rules cannot see (a plausible
   1-degree coordinate shift) are included on purpose and show up as misses.

3. **Ranking stability.** Jaccard overlap of the top-10 selections across seeds, and
   Spearman correlation of priority scores across seeds, for each score-based strategy.

These measure internal consistency and detection behaviour on the retrieved data.
They do not measure ecological accuracy: occupancy is unknown, so no result here
should be read as a claim about species presence or absence.
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from .quality import audit_occurrences
from .spatial import EARTH_RADIUS_KM, PriorityConfig, assign_cells, compute_cell_metrics

RAW_COLUMNS = [
    "gbif_id", "occurrence_key", "species_key", "accepted_scientific_name", "lat", "lon",
    "coordinate_uncertainty_m", "event_date", "year", "basis_of_record", "occurrence_status",
    "recorded_by", "country_code", "dataset_key", "dataset_name", "publisher_key",
    "institution_code", "catalog_number", "license", "issues", "last_interpreted",
]
FAULT_TYPES = [
    "zero_coordinates",
    "latitude_out_of_range",
    "missing_coordinates",
    "duplicate_record",
    "lat_lon_swapped",
    "high_uncertainty",
    "plausible_shift_1deg",  # deliberately undetectable by rules
]
METHODS = ["random", "highest_count", "vanasignal", "vanasignal_no_quality"]


def load_raw_records(occurrences_csv: str) -> pd.DataFrame:
    """Read the raw record columns back from a run's occurrences.csv."""
    df = pd.read_csv(occurrences_csv, dtype={"gbif_id": str})
    keep = [c for c in RAW_COLUMNS if c in df.columns]
    out = df[keep].copy()
    out["issues"] = out["issues"].map(lambda s: [x for x in str(s).split(";") if x] if isinstance(s, str) else [])
    return out


def _coverage_fraction(centers: np.ndarray, points: np.ndarray, radius_km: float) -> float:
    if len(points) == 0 or len(centers) == 0:
        return 0.0
    tree = BallTree(np.radians(points), metric="haversine")
    counts = tree.query_radius(np.radians(centers), r=radius_km / EARTH_RADIUS_KM, count_only=True)
    return float(np.mean(counts > 0))


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def _summ(values: list[float]) -> dict[str, Any]:
    arr = np.array([v for v in values if v is not None and np.isfinite(v)], dtype=float)
    if arr.size == 0:
        return {"mean": None, "sd": None, "min": None, "max": None, "n": 0}
    return {
        "mean": round(float(arr.mean()), 4),
        "sd": round(float(arr.std(ddof=1)) if arr.size > 1 else 0.0, 4),
        "min": round(float(arr.min()), 4),
        "max": round(float(arr.max()), 4),
        "n": int(arr.size),
    }


def withheld_experiment(
    usable: pd.DataFrame,
    grid: pd.DataFrame,
    resolution: int,
    seeds: int,
    test_fraction: float,
    k_values: list[int],
    coverage_radius_km: float,
    priority: PriorityConfig = PriorityConfig(),
) -> dict[str, Any]:
    """Run the withheld-observation experiment. ``grid`` is a GeoDataFrame of candidate cells."""
    usable = usable.reset_index(drop=True).copy()
    usable["cell"] = assign_cells(usable, resolution)
    usable = usable[usable["cell"].notna() & usable["cell"].isin(set(grid["cell"]))].reset_index(drop=True)
    n = len(usable)
    if n < 10:
        raise ValueError(f"Withheld experiment needs at least 10 usable records in the grid; found {n}.")

    cells = grid["cell"].to_numpy()
    centers = grid[["center_lat", "center_lon"]].to_numpy(dtype=float)
    n_cells = len(cells)
    ablation_cfg = PriorityConfig(
        w_gap=priority.w_gap / (priority.w_gap + priority.w_isolation),
        w_isolation=priority.w_isolation / (priority.w_gap + priority.w_isolation),
        w_quality=0.0,
        isolation_cap_km=priority.isolation_cap_km,
        sparse_threshold=priority.sparse_threshold,
    )

    per_seed: list[dict[str, Any]] = []
    top_sets: dict[str, list[set]] = {m: [] for m in METHODS}
    score_vectors: dict[str, list[pd.Series]] = {m: [] for m in ["vanasignal", "vanasignal_no_quality"]}

    for seed in range(seeds):
        rng = np.random.default_rng(seed)
        perm = rng.permutation(n)
        n_test = max(1, int(round(test_fraction * n)))
        test = usable.iloc[perm[:n_test]]
        train = usable.iloc[perm[n_test:]]
        if train.empty:
            continue

        train_points = train[["lat", "lon"]].to_numpy(dtype=float)
        baseline_cov = _coverage_fraction(centers, train_points, coverage_radius_km)
        train_cells = set(train["cell"])
        novel = set(test["cell"]) - train_cells

        metrics_full = compute_cell_metrics(grid, train, priority).set_index("cell").reindex(cells)
        metrics_abl = compute_cell_metrics(grid, train, ablation_cfg).set_index("cell").reindex(cells)
        tiebreak = np.random.default_rng(10_000 + seed).random(n_cells)

        orders = {
            "random": np.random.default_rng(20_000 + seed).permutation(n_cells),
            "highest_count": np.lexsort((tiebreak, -metrics_full["raw_records"].to_numpy(dtype=float))),
            "vanasignal": np.lexsort((tiebreak, -metrics_full["priority_score"].to_numpy(dtype=float))),
            "vanasignal_no_quality": np.lexsort((tiebreak, -metrics_abl["priority_score"].to_numpy(dtype=float))),
        }
        score_vectors["vanasignal"].append(metrics_full["priority_score"].reset_index(drop=True))
        score_vectors["vanasignal_no_quality"].append(metrics_abl["priority_score"].reset_index(drop=True))

        row: dict[str, Any] = {"seed": seed, "train_records": int(len(train)), "test_records": int(len(test)), "novel_test_cells": len(novel)}
        for method in METHODS:
            order = orders[method]
            top_sets[method].append(set(cells[order[:10]]))
            for k in k_values:
                sel_idx = order[:k]
                chosen = set(cells[sel_idx])
                record_recall = float(test["cell"].isin(chosen).mean())
                novel_recall = (len(novel & chosen) / len(novel)) if novel else None
                added_points = centers[sel_idx]
                after_cov = _coverage_fraction(centers, np.vstack([train_points, added_points]), coverage_radius_km)
                row[f"{method}@{k}_record_recall"] = round(record_recall, 4)
                row[f"{method}@{k}_novel_cell_recall"] = round(novel_recall, 4) if novel_recall is not None else None
                row[f"{method}@{k}_coverage_gain_pp"] = round((after_cov - baseline_cov) * 100, 3)
        per_seed.append(row)

    if not per_seed:
        raise ValueError("No seed produced a valid train/test split.")

    methods_summary: dict[str, Any] = {}
    for method in METHODS:
        methods_summary[method] = {}
        for k in k_values:
            methods_summary[method][f"k{k}"] = {
                "record_recall": _summ([r[f"{method}@{k}_record_recall"] for r in per_seed]),
                "novel_cell_recall": _summ([r[f"{method}@{k}_novel_cell_recall"] for r in per_seed]),
                "coverage_gain_pp": _summ([r[f"{method}@{k}_coverage_gain_pp"] for r in per_seed]),
            }

    stability: dict[str, Any] = {}
    for method in METHODS:
        pairs = list(itertools.combinations(top_sets[method], 2))
        jac = [_jaccard(a, b) for a, b in pairs]
        stability[method] = {"top10_jaccard": _summ(jac)}
    for method in ["vanasignal", "vanasignal_no_quality"]:
        vecs = score_vectors[method]
        rhos = []
        for a, b in itertools.combinations(vecs, 2):
            rhos.append(float(pd.concat([a, b], axis=1).corr(method="spearman").iloc[0, 1]))
        stability[method]["priority_spearman"] = _summ(rhos)

    return {
        "usable_records": n,
        "candidate_cells": n_cells,
        "seeds_run": len(per_seed),
        "test_fraction": test_fraction,
        "k_values": k_values,
        "coverage_radius_km": coverage_radius_km,
        "methods": methods_summary,
        "ranking_stability": stability,
        "per_seed": per_seed,
        "interpretation": (
            "Recall measures overlap with withheld GBIF records on the same retrieved data. "
            "GBIF sampling effort is uneven, so a count-based baseline can score well by re-finding "
            "sampling hotspots. Novel-cell recall and coverage gain are the measures aimed at gaps. "
            "No result here estimates true occupancy."
        ),
    }


def quality_experiment(
    raw: pd.DataFrame,
    bbox: tuple[float, float, float, float],
    uncertainty_threshold_m: float,
    fault_rate: float,
    seed: int = 0,
    land: Any | None = None,
) -> dict[str, Any]:
    """Inject known faults into a copy of ``raw`` and measure audit detection."""
    rng = np.random.default_rng(seed)
    base = raw[RAW_COLUMNS].copy().reset_index(drop=True)
    base["lat"] = pd.to_numeric(base["lat"], errors="coerce")
    base["lon"] = pd.to_numeric(base["lon"], errors="coerce")
    base["injected_fault"] = None
    n = len(base)
    per_fault = max(1, int(round(fault_rate * n)))
    pool = np.arange(n)
    rng.shuffle(pool)
    cursor = 0
    dup_rows: list[pd.DataFrame] = []

    for fault in FAULT_TYPES:
        take = pool[cursor: cursor + per_fault]
        cursor += per_fault
        if len(take) == 0:
            continue
        if fault == "zero_coordinates":
            base.loc[take, ["lat", "lon"]] = 0.0
        elif fault == "latitude_out_of_range":
            base.loc[take, "lat"] = 91.0 + rng.random(len(take)) * 9.0
        elif fault == "missing_coordinates":
            base.loc[take, ["lat", "lon"]] = np.nan
        elif fault == "lat_lon_swapped":
            lat_old = base.loc[take, "lat"].to_numpy()
            lon_old = base.loc[take, "lon"].to_numpy()
            base.loc[take, "lat"] = lon_old
            base.loc[take, "lon"] = lat_old
        elif fault == "high_uncertainty":
            base.loc[take, "coordinate_uncertainty_m"] = uncertainty_threshold_m * 2
        elif fault == "plausible_shift_1deg":
            base.loc[take, "lat"] = base.loc[take, "lat"] + 1.0
        elif fault == "duplicate_record":
            copies = base.loc[take].copy()
            copies["gbif_id"] = copies["gbif_id"].astype(str) + "-dup"
            copies["injected_fault"] = "duplicate_record"
            dup_rows.append(copies)
            continue
        base.loc[take, "injected_fault"] = fault

    if dup_rows:
        base = pd.concat([base] + dup_rows, ignore_index=True)

    annotated, _ = audit_occurrences(base, bbox, uncertainty_threshold_m, land=land)
    truth = annotated["injected_fault"].notna().to_numpy()
    flagged = (annotated["quality_status"] != "clean").to_numpy()

    tp = int(np.sum(truth & flagged))
    fp = int(np.sum(~truth & flagged))
    fn = int(np.sum(truth & ~flagged))
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * precision * recall / (precision + recall)) if precision and recall else None

    by_fault: dict[str, Any] = {}
    for fault in FAULT_TYPES:
        mask = (annotated["injected_fault"] == fault).to_numpy()
        if mask.sum() == 0:
            continue
        by_fault[fault] = {
            "injected": int(mask.sum()),
            "flagged": int((mask & flagged).sum()),
            "detection_rate": round(float((mask & flagged).sum() / mask.sum()), 4),
            "rule_visible_by_design": fault != "plausible_shift_1deg",
        }

    clean_rows = ~truth
    return {
        "seed": seed,
        "fault_rate_per_type": fault_rate,
        "records_audited": int(len(annotated)),
        "injected_rows": int(truth.sum()),
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "true_positive": tp,
        "false_positive": fp,
        "false_negative": fn,
        "by_fault_type": by_fault,
        "flag_rate_on_uninjected_rows": round(float(flagged[clean_rows].mean()), 4) if clean_rows.any() else None,
        "interpretation": (
            "Ground truth is the injection log. Fault types marked rule_visible_by_design are detected by construction, "
            "so their rates validate the rules, not real-world accuracy. plausible_shift_1deg is undetectable by the rules "
            "and shows the limit of this audit."
        ),
    }
