"""Protected-area overlay from a user-supplied WDPA extract.

The World Database on Protected Areas (Protected Planet) is licensed with terms
that require registration and restrict redistribution, so VanaSignal does not
download or bundle it. Set ``VANASIGNAL_WDPA_PATH`` to a local GeoPackage,
Shapefile or GeoJSON extract that you are permitted to use. Without it the
protected-area layer is reported as *not loaded* rather than estimated.

Protected-area overlap is reported as context only. It is never evidence that a
location is safe for harvesting or that a population is secure.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import geopandas as gpd

from .spatial import WGS84

KEEP_COLUMNS = ["NAME", "NAME_ENG", "DESIG_ENG", "IUCN_CAT", "STATUS_YR", "WDPAID", "name", "desig", "iucn_cat", "wdpaid"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_protected_areas(path: str | None, bbox: tuple[float, float, float, float]) -> tuple[gpd.GeoDataFrame | None, dict]:
    if not path:
        return None, {
            "loaded": False,
            "reason": "No protected-area extract configured. Set VANASIGNAL_WDPA_PATH to a locally licensed WDPA extract.",
        }
    source = Path(path)
    if not source.exists():
        return None, {"loaded": False, "reason": f"Configured protected-area file does not exist: {source}"}

    min_lon, min_lat, max_lon, max_lat = bbox
    gdf = gpd.read_file(source, bbox=(min_lon, min_lat, max_lon, max_lat))
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84)
    gdf = gdf.to_crs(WGS84)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    keep = [c for c in KEEP_COLUMNS if c in gdf.columns]
    gdf = gdf[keep + ["geometry"]].reset_index(drop=True)
    return gdf, {
        "loaded": True,
        "source_file": source.name,
        "source_sha256": _sha256(source),
        "polygons_in_region": int(len(gdf)),
        "note": "Overlap is context only; it does not establish harvest safety or population status.",
    }
