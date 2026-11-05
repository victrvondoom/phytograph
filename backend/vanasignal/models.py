"""Public data contracts for VanaSignal.

These pydantic models validate every external entry point (HTTP API and MCP
tools). Analytical functions in the other modules operate on plain Python /
pandas objects and do not depend on this module or on any transport layer.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_BBOX_SPAN_DEG = 30.0


class ResolveSpeciesRequest(BaseModel):
    name: str = Field(min_length=3, max_length=200, description="Scientific name, e.g. 'Withania somnifera'.")


class SpeciesSuggestion(BaseModel):
    key: int
    scientific_name: str
    rank: str | None = None
    status: str | None = None
    kingdom: str | None = None


class ResolvedSpecies(BaseModel):
    query: str
    usage_key: int
    accepted_key: int
    scientific_name: str
    canonical_name: str | None = None
    rank: str | None = None
    status: str | None = None
    match_type: str
    confidence: int | None = None
    kingdom: str | None = None
    warnings: list[str] = Field(default_factory=list)
    source: Literal["gbif_species_match"] = "gbif_species_match"
    retrieved_at: str
    request_url: str
    suggestions: list[SpeciesSuggestion] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    species: str = Field(min_length=3, max_length=200)
    bbox: tuple[float, float, float, float] = Field(
        description="Study region as (min_lon, min_lat, max_lon, max_lat) in WGS84 degrees."
    )
    resolution: int = Field(default=5, ge=3, le=6, description="H3 grid resolution.")
    max_records: int = Field(default=3000, ge=10, le=20000)
    uncertainty_threshold_m: float = Field(
        default=5000.0, gt=0, le=100000, description="Coordinate uncertainty above which a record is questionable."
    )
    include_protected: bool = True

    @field_validator("bbox")
    @classmethod
    def _validate_bbox(cls, v: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        min_lon, min_lat, max_lon, max_lat = v
        if not (-180 <= min_lon < max_lon <= 180):
            raise ValueError("bbox longitudes must satisfy -180 <= min_lon < max_lon <= 180")
        if not (-90 <= min_lat < max_lat <= 90):
            raise ValueError("bbox latitudes must satisfy -90 <= min_lat < max_lat <= 90")
        if (max_lon - min_lon) > MAX_BBOX_SPAN_DEG or (max_lat - min_lat) > MAX_BBOX_SPAN_DEG:
            raise ValueError(f"bbox span must not exceed {MAX_BBOX_SPAN_DEG} degrees per axis")
        return v


class SimulationRequest(BaseModel):
    cell_ids: list[str] = Field(min_length=1, max_length=500)
    detection_probability: float = Field(default=0.3, gt=0, le=1, description="Per-visit probability of detecting the species if present.")
    visits: int = Field(default=3, ge=1, le=30)
    occupancy_scenarios: list[float] = Field(default=[0.05, 0.2, 0.5], min_length=1, max_length=10)

    @field_validator("occupancy_scenarios")
    @classmethod
    def _valid_occupancy(cls, v: list[float]) -> list[float]:
        if any(not (0 < x <= 1) for x in v):
            raise ValueError("occupancy scenarios must lie in (0, 1]")
        return v


class BenchmarkRequest(BaseModel):
    seeds: int = Field(default=20, ge=2, le=200)
    test_fraction: float = Field(default=0.3, gt=0, lt=1)
    k_values: list[int] = Field(default=[5, 10], min_length=1, max_length=5)
    coverage_radius_km: float = Field(default=50.0, gt=0, le=500)
    fault_rate: float = Field(default=0.1, gt=0, lt=0.5, description="Share of records corrupted per fault type in the quality experiment.")

    @model_validator(mode="after")
    def _k_sane(self) -> "BenchmarkRequest":
        if any(k < 1 for k in self.k_values):
            raise ValueError("k values must be positive")
        return self
