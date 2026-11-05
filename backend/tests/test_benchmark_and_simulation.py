"""Benchmark determinism and rule behaviour, and the counterfactual simulator (synthetic inputs)."""

import numpy as np
import pandas as pd
import pytest

from vanasignal import benchmark as bm
from vanasignal.simulate import UnknownCellError, simulate_survey_plan
from vanasignal.spatial import PriorityConfig, assign_cells, build_grid, compute_cell_metrics, load_land_mask
from vanasignal.quality import audit_occurrences
from fixtures import REGION, synthetic_records


@pytest.fixture(scope="module")
def dataset():
    raw = pd.DataFrame(synthetic_records(n=400, seed=3))
    annotated, _ = audit_occurrences(raw, REGION, 5000.0)
    grid = build_grid(REGION, 5, land=load_land_mask())
    return raw, annotated, grid


def test_withheld_experiment_is_reproducible_and_structured(dataset):
    _, annotated, grid = dataset
    usable = annotated[annotated["quality_weight"] > 0]
    kwargs = dict(resolution=5, seeds=4, test_fraction=0.3, k_values=[5, 10], coverage_radius_km=50.0)
    a = bm.withheld_experiment(usable, grid, **kwargs)
    b = bm.withheld_experiment(usable, grid, **kwargs)
    assert a == b, "same data and seeds must yield identical output"
    assert set(a["methods"]) == set(bm.METHODS)
    for method in bm.METHODS:
        for k in ["k5", "k10"]:
            rr = a["methods"][method][k]["record_recall"]
            assert 0 <= rr["mean"] <= 1
    for method in bm.METHODS:
        j = a["ranking_stability"][method]["top10_jaccard"]
        assert 0 <= j["mean"] <= 1
    assert a["seeds_run"] == 4


def test_withheld_experiment_rejects_tiny_samples(dataset):
    _, annotated, grid = dataset
    tiny = annotated[annotated["quality_weight"] > 0].head(5)
    with pytest.raises(ValueError, match="at least 10"):
        bm.withheld_experiment(tiny, grid, 5, 2, 0.3, [5], 50.0)


def test_quality_experiment_detects_rule_visible_faults_and_misses_plausible_shift(dataset):
    raw, _, _ = dataset
    result = bm.quality_experiment(raw, REGION, 5000.0, fault_rate=0.05, seed=1)
    by = result["by_fault_type"]
    assert by["zero_coordinates"]["detection_rate"] == 1.0
    assert by["missing_coordinates"]["detection_rate"] == 1.0
    assert by["latitude_out_of_range"]["detection_rate"] == 1.0
    assert by["duplicate_record"]["detection_rate"] == 1.0
    # A 1-degree shift is invisible to the rules unless it pushes the point out of the region.
    assert by["plausible_shift_1deg"]["detection_rate"] < 0.5, "most plausible shifts must remain undetectable"
    assert result["recall"] is not None and result["recall"] < 1.0
    assert result["precision"] is not None and 0 < result["precision"] <= 1.0


def test_quality_experiment_is_seeded(dataset):
    raw, _, _ = dataset
    a = bm.quality_experiment(raw, REGION, 5000.0, 0.05, seed=7)
    b = bm.quality_experiment(raw, REGION, 5000.0, 0.05, seed=7)
    assert a == b


def test_simulator_expected_values_follow_stated_formula(dataset):
    _, annotated, grid = dataset
    usable = annotated[annotated["quality_weight"] > 0].copy()
    usable["cell"] = assign_cells(usable, 5)
    metrics = compute_cell_metrics(grid, usable[usable["cell"].isin(set(grid["cell"]))], PriorityConfig())
    unsurveyed = metrics[metrics["raw_records"] == 0]["cell"].tolist()[:4]
    result = simulate_survey_plan(metrics, unsurveyed, detection_probability=1.0, visits=1, occupancy_scenarios=[0.5, 1.0])
    s50, s100 = result["scenarios"]
    assert s100["p_detect_at_least_once_per_cell"] == 1.0
    assert s100["expected_unsurveyed_cells_closed"] == 4.0
    assert s50["expected_unsurveyed_cells_closed"] == 2.0
    assert result["kind"] == "counterfactual_scenario" and "not evidence of absence" in result["disclaimer"]


def test_simulator_rejects_unknown_cells(dataset):
    _, annotated, grid = dataset
    metrics = compute_cell_metrics(grid, annotated.iloc[:0].assign(cell=[]), PriorityConfig())
    with pytest.raises(UnknownCellError):
        simulate_survey_plan(metrics, ["not-a-cell"], 0.3, 3, [0.1])
