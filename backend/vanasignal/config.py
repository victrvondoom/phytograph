"""Runtime configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("VANASIGNAL_DATA_DIR", BACKEND_DIR / "data")))
    wdpa_path: str | None = field(default_factory=lambda: os.environ.get("VANASIGNAL_WDPA_PATH") or None)
    land_mask_path: str | None = field(default_factory=lambda: os.environ.get("VANASIGNAL_LAND_MASK") or None)
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("VANASIGNAL_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip())
    )

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache" / "gbif"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"


def get_settings() -> Settings:
    return Settings()
