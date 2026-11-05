"""Grid, coverage, priority and candidate selection (synthetic inputs)."""

import numpy as np
import pandas as pd
import pytest

from vanasignal.spatial import GridTooLargeError, PriorityConfig, build_grid, compute_cell_metrics, gini, greedy_candidates, load_land_mask, assign_cells, coverage_stats
from vanasignal.quality import audit_occurrences
from fixtures import REGION, synthetic_records


def test_grid_cells_lie_inside_region_and_are_land_filtered():
    land = load_land_mask()
    grid = build_grid(REGION, 5, land=land)
    assert len(grid) > 50
    assert grid["center_lon"].between(REGION[0], REGION[2]).all() and grid["center_lat"].between(REGION[1], REGION[3]).all()
    no_land = build_grid(REGION, 5, land=None)
    assert len(no_land) >= len(grid)


def test_open_ocean_region_is_rejected_by_land_mask():
    land = load_land_mask()
    with pytest.raises(GridTooLargeError, match="no land cells"):
        build_grid((60.0, -30.0, 61.0, -29.0), 5, land=land)


def test_grid_size_limit_is_enforced():
    with pytest.raises(GridTooLargeError, match="limit is 50"):
        build_grid(REGION, 6, max_cells=50, land=None)


def _usable(n=200, seed=0):
    rows = pd.DataFrame(synthetic_records(n=n, seed=seed))
    annotated, _ = audit_occurrences(rows, REGION, 5000.0)
    usable = annotated[annotated["quality_weight"] > 0].copy()
    return usable


def test_metrics_gap_score_is_one_for_empty_cells_and_priorities_bounded():
    grid = build_grid(REGION, 5, land=load_land_mask())
    usable = _usable()
    usable["cell"] = assign_cells(usable, 5)
    usable = usable[usable["cell"].isin(set(grid["cell"]))]
    m = compute_cell_metrics(grid, usable, PriorityConfig())
    empty = m[m["raw_records"] == 0]
    assert len(empty) > 0 and (empty["gap_score"] == 1.0).all()
    assert m["priority_score"].between(0, 1).all()
    assert m["raw_records"].sum() == len(usable)
    assert set(m["cell_status"]) <= {"unsurveyed", "sparse", "covered"}


def test_quality_deficit_raises_priority_for_questionable_cells():
    grid = build_grid(REGION, 5, land=None).head(5).reset_index(drop=True)
    c = grid.loc[0, "cell"]
    usable = pd.DataFrame([
        {"cell": c, "lat": grid.loc[0, "center_lat"], "lon": grid.loc[0, "center_lon"], "quality_weight": 0.5, "quality_status": "questionable"},
        {"cell": c, "lat": grid.loc[0, "center_lat"], "lon": grid.loc[0, "center_lon"], "quality_weight": 0.5, "quality_status": "questionable"},
    ])
    m = compute_cell_metrics(grid, usable, PriorityConfig())
    assert m.loc[0, "quality_deficit"] == 1.0
    assert np.isfinite(m.loc[0, "priority_score"])
    cfg_no_q = PriorityConfig(w_gap=0.5, w_isolation=0.3, w_quality=0.0)
    m2 = compute_cell_metrics(grid, usable, cfg_no_q)
    assert m2.loc[0, "priority_score"] < m.loc[0, "priority_score"]


def test_greedy_candidates_respect_spacing():
    grid = build_grid(REGION, 5, land=load_land_mask())
    m = compute_cell_metrics(grid, _usable().assign(cell=lambda d: assign_cells(d, 5)).query("cell in @grid.cell"), PriorityConfig())
    import h3
    chosen = greedy_candidates(m, 10, min_separation_rings=1)
    assert len(chosen) == 10 and len(set(chosen)) == 10
    for i, a in enumerate(chosen):
        for b in chosen[i + 1:]:
            assert b not in h3.grid_disk(a, 1)


def test_gini_known_values():
    assert gini([5, 5, 5, 5]) == pytest.approx(0.0)
    assert gini([0, 0, 0, 10]) == pytest.approx(0.75)
    assert gini([]) == 0.0


def test_coverage_stats_consistency():
    grid = build_grid(REGION, 5, land=load_land_mask())
    m = compute_cell_metrics(grid, pd.DataFrame(columns=["cell", "lat", "lon", "quality_weight", "quality_status"]), PriorityConfig())
    s = coverage_stats(m)
    assert s["occupied_cells"] == 0 and s["unsurveyed_cells"] == s["total_cells"]
    assert s["median_nearest_record_km"] is None
