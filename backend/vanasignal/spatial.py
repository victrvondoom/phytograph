"""Spatial grid, observation coverage, survey-priority scoring and protected overlay.

Priority model (documented in AGENTS.md):

    priority = w_gap * gap_score + w_isolation * isolation_score + w_quality * quality_deficit

* ``gap_score``       – 1 minus log-scaled quality-weighted record count in the cell.
                         Empty cells score 1.
* ``isolation_score`` – distance from the cell centre to the nearest usable record,
                         capped at ``isolation_cap_km`` and rescaled to [0, 1].
* ``quality_deficit`` – share of the cell's records that are questionable.

The score ranks where a field survey would add the most *information*. It is
not an ecological probability and does not estimate occupancy.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
from shapely.geometry import Polygon
from shapely.ops import unary_union
from sklearn.neighbors import BallTree

EARTH_RADIUS_KM = 6371.0088
EQUAL_AREA_CRS = "EPSG:6933"
WGS84 = "EPSG:4326"
DEFAULT_LAND_MASK = Path(__file__).resolve().parent.parent / "data" / "reference" / "ne_50m_land.geojson"


class GridTooLargeError(ValueError):
    pass


@dataclass(frozen=True)
class PriorityConfig:
    w_gap: float = 0.5
    w_isolation: float = 0.3
    w_quality: float = 0.2
    isolation_cap_km: float = 100.0
    sparse_threshold: int = 3

    def as_dict(self) -> dict:
        return asdict(self)


def load_land_mask(path: str | Path | None = None) -> gpd.GeoDataFrame | None:
    """Load the Natural Earth land polygons used to drop ocean-only cells."""
    target = Path(path) if path else DEFAULT_LAND_MASK
    if not target.exists():
        return None
    return gpd.read_file(target).to_crs(WGS84)


def land_union(path: str | Path | None = None):
    """Union of land polygons as one shapely geometry, or None when no mask is available."""
    land = load_land_mask(path)
    if land is None:
        return None
    return unary_union(land.geometry.values)


def build_grid(
    bbox: tuple[float, float, float, float],
    resolution: int,
    max_cells: int = 50000,
    land: gpd.GeoDataFrame | None = None,
) -> gpd.GeoDataFrame:
    """H3 cells whose centres fall inside ``bbox``; optionally limited to land."""
    min_lon, min_lat, max_lon, max_lat = bbox
    region = {
        "type": "Polygon",
        "coordinates": [[[min_lon, min_lat], [max_lon, min_lat], [max_lon, max_lat], [min_lon, max_lat], [min_lon, min_lat]]],
    }
    cells = sorted(h3.geo_to_cells(region, resolution))
    if not cells:
        raise GridTooLargeError("No H3 cells fall inside the requested region at this resolution.")
    if len(cells) > max_cells:
        raise GridTooLargeError(
            f"Region produces {len(cells)} H3 cells at resolution {resolution}; the limit is {max_cells}. "
            "Use a smaller region or a coarser resolution."
        )

    rows = []
    for cell in cells:
        boundary = h3.cell_to_boundary(cell)  # ((lat, lng), ...)
        poly = Polygon([(lng, lat) for lat, lng in boundary])
        center_lat, center_lon = h3.cell_to_latlng(cell)
        rows.append({"cell": cell, "center_lat": center_lat, "center_lon": center_lon, "geometry": poly})
    grid = gpd.GeoDataFrame(rows, geometry="geometry", crs=WGS84)

    grid["land_intersects"] = True
    if land is not None:
        land_union = unary_union(land.geometry.values)
        grid["land_intersects"] = grid.geometry.intersects(land_union).values
        grid = grid[grid["land_intersects"]].reset_index(drop=True)
        if grid.empty:
            raise GridTooLargeError("The region contains no land cells at this resolution.")
    return grid


def assign_cells(records: pd.DataFrame, resolution: int) -> pd.Series:
    """H3 cell for each record with finite coordinates (NaN otherwise)."""
    out = []
    for lat, lon in zip(records["lat"].to_numpy(dtype=float), records["lon"].to_numpy(dtype=float)):
        if np.isfinite(lat) and np.isfinite(lon):
            out.append(h3.latlng_to_cell(lat, lon, resolution))
        else:
            out.append(None)
    return pd.Series(out, index=records.index, dtype=object)


def _nearest_km(query_lat: np.ndarray, query_lon: np.ndarray, rec_lat: np.ndarray, rec_lon: np.ndarray) -> np.ndarray:
    if len(rec_lat) == 0:
        return np.full(len(query_lat), np.nan)
    tree = BallTree(np.radians(np.column_stack([rec_lat, rec_lon])), metric="haversine")
    dist, _ = tree.query(np.radians(np.column_stack([query_lat, query_lon])), k=1)
    return dist[:, 0] * EARTH_RADIUS_KM


def compute_cell_metrics(
    grid: gpd.GeoDataFrame,
    usable: pd.DataFrame,
    config: PriorityConfig = PriorityConfig(),
) -> gpd.GeoDataFrame:
    """Attach coverage and priority indicators to every grid cell.

    ``usable`` must contain ``cell`` (H3 index), ``lat``, ``lon``, ``quality_weight``
    and ``quality_status``. Only records with weight > 0 should be passed in.
    """
    g = grid.copy()
    if len(usable):
        per_cell = usable.groupby("cell").agg(
            raw_records=("cell", "size"),
            weighted_records=("quality_weight", "sum"),
            questionable_records=("quality_status", lambda s: int((s == "questionable").sum())),
        )
    else:
        per_cell = pd.DataFrame(columns=["raw_records", "weighted_records", "questionable_records"]).astype(float)
    g = g.merge(per_cell, left_on="cell", right_index=True, how="left")
    g["raw_records"] = g["raw_records"].fillna(0).astype(int)
    g["weighted_records"] = g["weighted_records"].fillna(0.0).round(4)
    g["questionable_records"] = g["questionable_records"].fillna(0).astype(int)
    g["questionable_share"] = np.where(g["raw_records"] > 0, g["questionable_records"] / g["raw_records"].clip(lower=1), 0.0)

    if len(usable):
        g["nearest_record_km"] = _nearest_km(
            g["center_lat"].to_numpy(), g["center_lon"].to_numpy(),
            usable["lat"].to_numpy(dtype=float), usable["lon"].to_numpy(dtype=float),
        )
    else:
        g["nearest_record_km"] = np.nan

    max_w = float(g["weighted_records"].max()) if len(g) else 0.0
    denom = np.log1p(max_w) if max_w > 0 else 1.0
    g["gap_score"] = (1 - np.log1p(g["weighted_records"]) / denom).clip(0, 1) if max_w > 0 else 1.0
    iso = g["nearest_record_km"].fillna(config.isolation_cap_km) / config.isolation_cap_km
    g["isolation_score"] = iso.clip(0, 1)
    g["quality_deficit"] = g["questionable_share"].clip(0, 1)
    g["priority_score"] = (
        config.w_gap * g["gap_score"]
        + config.w_isolation * g["isolation_score"]
        + config.w_quality * g["quality_deficit"]
    ).round(4)
    g["gap_score"] = g["gap_score"].round(4)
    g["isolation_score"] = g["isolation_score"].round(4)
    g["quality_deficit"] = g["quality_deficit"].round(4)
    g["nearest_record_km"] = g["nearest_record_km"].round(2)
    g["cell_status"] = np.select(
        [g["raw_records"] == 0, g["raw_records"] <= config.sparse_threshold],
        ["unsurveyed", "sparse"],
        default="covered",
    )
    return g


def protected_overlay(grid: gpd.GeoDataFrame, protected: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Fraction of each cell's area covered by protected-area polygons (context only)."""
    g = grid.copy()
    g["protected_overlap_share"] = 0.0
    g["protected_area_count"] = 0
    if protected is None or protected.empty:
        return g
    cells_eq = g.to_crs(EQUAL_AREA_CRS)
    pa_eq = protected.to_crs(EQUAL_AREA_CRS)
    pa_eq = pa_eq[pa_eq.geometry.notna() & ~pa_eq.geometry.is_empty]
    sindex = pa_eq.sindex
    shares, counts = [], []
    for geom in cells_eq.geometry.values:
        candidates = list(sindex.intersection(geom.bounds))
        if not candidates:
            shares.append(0.0)
            counts.append(0)
            continue
        hits = pa_eq.iloc[candidates]
        hits = hits[hits.intersects(geom)]
        if hits.empty:
            shares.append(0.0)
            counts.append(0)
            continue
        inter = unary_union(hits.geometry.intersection(geom).values)
        shares.append(float(min(inter.area / geom.area, 1.0)) if geom.area > 0 else 0.0)
        counts.append(int(len(hits)))
    g["protected_overlap_share"] = np.round(shares, 4)
    g["protected_area_count"] = counts
    return g


def greedy_candidates(grid: gpd.GeoDataFrame, n: int, min_separation_rings: int = 1) -> list[str]:
    """Top-n cells by priority, skipping cells within ``min_separation_rings`` of a chosen cell."""
    ranked = grid.sort_values(["priority_score", "cell"], ascending=[False, True])
    chosen: list[str] = []
    blocked: set[str] = set()
    for cell in ranked["cell"]:
        if cell in blocked:
            continue
        chosen.append(cell)
        if len(chosen) >= n:
            break
        blocked |= set(h3.grid_disk(cell, min_separation_rings))
    return chosen


def gini(values: Iterable[float]) -> float:
    """Gini coefficient of non-negative values (0 = even, 1 = concentrated)."""
    x = np.sort(np.asarray(list(values), dtype=float))
    if x.size == 0 or x.sum() == 0:
        return 0.0
    n = x.size
    idx = np.arange(1, n + 1)
    return float((2 * np.sum(idx * x) / (n * x.sum())) - (n + 1) / n)


def coverage_stats(grid: gpd.GeoDataFrame) -> dict:
    total = int(len(grid))
    occupied = int((grid["raw_records"] > 0).sum())
    return {
        "total_cells": total,
        "occupied_cells": occupied,
        "occupied_share": round(occupied / total, 4) if total else 0.0,
        "unsurveyed_cells": int((grid["cell_status"] == "unsurveyed").sum()),
        "sparse_cells": int((grid["cell_status"] == "sparse").sum()),
        "covered_cells": int((grid["cell_status"] == "covered").sum()),
        "median_nearest_record_km": round(float(grid["nearest_record_km"].median()), 2) if grid["nearest_record_km"].notna().any() else None,
        "record_concentration_gini": round(gini(grid["raw_records"]), 4),
        "cell_area_km2_approx": round(float(grid.to_crs(EQUAL_AREA_CRS).geometry.area.median() / 1e6), 2) if total else None,
    }
