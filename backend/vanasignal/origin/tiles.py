"""Satellite basemap proxy.

The provider URL template and any API key live ONLY in server configuration (VANASIGNAL_SATELLITE_TEMPLATE,
e.g. "https://provider.example/{z}/{x}/{y}.jpg?key=..."). The browser requests /api/tiles/satellite/{z}/{x}/{y};
the server fetches the tile, caches it on disk and returns the bytes. The browser therefore never contacts the
provider and never sees the key. Coordinates are validated; no user-supplied URL is ever fetched.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import httpx

MAX_ZOOM = 18
TILE_TIMEOUT = 10.0


def template() -> str | None:
    value = os.environ.get("VANASIGNAL_SATELLITE_TEMPLATE", "").strip()
    if not value or "{z}" not in value or "{x}" not in value or "{y}" not in value:
        return None
    return value


def valid_tile(z: int, x: int, y: int) -> bool:
    return 0 <= z <= MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z


def fetch_tile(cache_dir: Path, z: int, x: int, y: int, client: httpx.Client | None = None) -> tuple[bytes, str]:
    url_template = template()
    if url_template is None:
        raise LookupError("satellite_not_configured")
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(f"{z}/{x}/{y}/{url_template.split('?')[0]}".encode()).hexdigest()
    cache_file = cache_dir / f"{key}.bin"
    type_file = cache_dir / f"{key}.type"
    if cache_file.exists():
        return cache_file.read_bytes(), type_file.read_text() if type_file.exists() else "image/jpeg"
    url = url_template.format(z=z, x=x, y=y)
    own = client is None
    http = client or httpx.Client(timeout=TILE_TIMEOUT)
    try:
        resp = http.get(url)
    finally:
        if own:
            http.close()
    if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
        raise RuntimeError(f"provider returned HTTP {resp.status_code}")
    ctype = resp.headers["content-type"].split(";")[0]
    cache_file.write_bytes(resp.content)
    type_file.write_text(ctype)
    return resp.content, ctype
