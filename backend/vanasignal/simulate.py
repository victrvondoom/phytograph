"""Counterfactual survey-plan simulator.

Answers: *if these cells were surveyed, what could change?* It does not estimate
occupancy. Because the true occupancy of a cell is unknown, the simulator runs a
grid of explicit occupancy scenarios (psi) and reports expected outcomes under each.

Per surveyed cell, with per-visit detection probability p and V visits:

    P(at least one detection | psi) = psi * (1 - (1 - p) ** V)

Expected records are psi * V * p. Results are expectations under the stated
assumptions and are not observations.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


class UnknownCellError(ValueError):
    def __init__(self, missing: list[str]):
        super().__init__(f"Cell ids not present in this analysis: {missing[:5]}")
        self.missing = missing


def simulate_survey_plan(
    grid_metrics: pd.DataFrame,
    cell_ids: list[str],
    detection_probability: float,
    visits: int,
    occupancy_scenarios: list[float],
) -> dict[str, Any]:
    known = set(grid_metrics["cell"])
    missing = [c for c in cell_ids if c not in known]
    if missing:
        raise UnknownCellError(missing)

    selected = grid_metrics[grid_metrics["cell"].isin(cell_ids)]
    unique_cells = int(selected["cell"].nunique())
    unsurveyed_selected = int((selected["raw_records"] == 0).sum())
    total_cells = int(len(grid_metrics))
    unsurveyed_total = int((grid_metrics["raw_records"] == 0).sum())
    p_survey = 1 - (1 - detection_probability) ** visits

    scenarios = []
    for psi in occupancy_scenarios:
        p_cell = psi * p_survey
        expected_new_detection_cells = unique_cells * p_cell
        expected_unsurveyed_closed = unsurveyed_selected * p_cell
        expected_records = unique_cells * psi * visits * detection_probability
        remaining = unsurveyed_total - expected_unsurveyed_closed
        scenarios.append({
            "occupancy_assumption_psi": psi,
            "p_detect_at_least_once_per_cell": round(p_cell, 4),
            "expected_cells_with_new_detection": round(expected_new_detection_cells, 2),
            "expected_unsurveyed_cells_closed": round(expected_unsurveyed_closed, 2),
            "expected_new_records": round(expected_records, 2),
            "expected_unsurveyed_share_before": round(unsurveyed_total / total_cells, 4),
            "expected_unsurveyed_share_after": round(max(remaining, 0) / total_cells, 4),
        })

    return {
        "kind": "counterfactual_scenario",
        "selected_cells": unique_cells,
        "selected_unsurveyed_cells": unsurveyed_selected,
        "visits_total": unique_cells * visits,
        "assumptions": {
            "detection_probability_per_visit": detection_probability,
            "visits_per_cell": visits,
            "p_detect_survey": round(p_survey, 4),
            "independence": "Detections are assumed independent across cells and visits.",
        },
        "scenarios": scenarios,
        "disclaimer": (
            "Expectations under assumed occupancy. A survey that finds no individuals is not evidence of absence, "
            "and this simulator does not estimate true occupancy or population size."
        ),
    }
