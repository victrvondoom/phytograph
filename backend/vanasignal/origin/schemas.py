"""Shared typed contracts for the Origin Gate API, persistence and dossier output.

Every module exchanges these models. The frontend renders them and never recomputes
scientific conclusions.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# live = official api.gbif.org; cached = local copy with its original retrieval time;
# non_gbif_test_endpoint = responses from a configured test/fixture server (never official evidence).
DataMode = Literal["live", "cached", "non_gbif_test_endpoint"]

PlantPart = Literal["root", "rhizome", "leaf", "flower", "fruit", "seed", "bark", "whole_plant", "resin", "other", "unknown"]
CollectionType = Literal["wild-harvested", "cultivated", "unknown"]
DataOrigin = Literal["manual", "synthetic"]
BatchIdStr = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$", description="2–64 chars: letters, digits, '.', '_', '-'.")]

REQUIRED_FIELDS = ["batch_id", "supplier_name", "declared_botanical_name", "plant_part", "declared_country", "collection_type"]
OPTIONAL_FIELDS = ["declared_state", "declared_district", "latitude", "longitude", "collection_date", "supplier_batch_reference", "document_references"]


class BatchFields(BaseModel):
    """Batch fields shared by create, update and read. Absent optional values are explicit nulls."""

    supplier_name: str = Field(min_length=2, max_length=200)
    declared_botanical_name: str = Field(min_length=3, max_length=200, description="As declared by the supplier; resolved separately.")
    plant_part: PlantPart
    declared_country: str = Field(min_length=2, max_length=100)
    declared_state: str | None = Field(default=None, max_length=100)
    declared_district: str | None = Field(default=None, max_length=150)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    collection_date: date | None = None
    collection_type: CollectionType
    supplier_batch_reference: str | None = Field(default=None, max_length=120)
    document_references: list[str] = Field(default_factory=list, max_length=50)
    data_origin: DataOrigin = Field(default="manual", description="manual = entered by a user; synthetic = demonstration sample.")

    @field_validator("supplier_name", "declared_botanical_name", "declared_country")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("declared_state", "declared_district", "supplier_batch_reference")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("document_references")
    @classmethod
    def _clean_documents(cls, v: list[str]) -> list[str]:
        cleaned = [d.strip() for d in v if d and d.strip()]
        if any(len(d) > 200 for d in cleaned):
            raise ValueError("document references must be 200 characters or fewer")
        return cleaned

    @model_validator(mode="after")
    def _coordinates_and_date(self) -> "BatchFields":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together, or both left empty (unknown)")
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("(0, 0) is not a valid collection location; leave coordinates empty if unknown")
        if self.collection_date is not None and self.collection_date > date.today():
            raise ValueError("collection date cannot be in the future")
        return self


class BatchCreate(BatchFields):
    batch_id: BatchIdStr


class BatchUpdate(BatchFields):
    """Full replacement of editable fields; batch_id is immutable."""


class FieldCompleteness(BaseModel):
    required_missing: list[str]
    optional_missing: list[str]
    completeness_share: float = Field(ge=0, le=1, description="Share of all required and optional fields filled. Documentation completeness only; not a quality or sustainability score.")


class AuditSummary(BaseModel):
    audit_id: str
    created_at: str
    origin_status: str
    identity_status: str
    overall_status: str


class BatchRead(BatchCreate):
    created_at: str
    updated_at: str
    completeness: FieldCompleteness
    latest_audit: AuditSummary | None = None


# ----------------------------------------------------------------- taxonomy
class TaxonCandidate(BaseModel):
    usage_key: int
    accepted_key: int | None = None
    scientific_name: str
    canonical_name: str | None = None
    rank: str | None = None
    taxonomic_status: str | None = None
    match_type: str | None = None
    confidence: int | None = None
    kingdom: str | None = None


class TaxonomyResolution(BaseModel):
    submitted_name: str
    resolution_status: Literal["RESOLVED", "SYNONYM_RESOLVED", "AMBIGUOUS", "UNRESOLVED"]
    explanation: str
    resolved_name: str | None = None
    accepted_name: str | None = None
    taxon_key: int | None = Field(default=None, description="GBIF accepted taxon key; null unless a single accepted taxon is established.")
    usage_key: int | None = None
    taxonomic_status: str | None = None
    match_type: str | None = None
    confidence: int | None = None
    selection: Literal["automatic", "user_confirmed", "none"] = "none"
    candidates: list[TaxonCandidate] = Field(default_factory=list)
    source_name: Literal["GBIF Species API"] = "GBIF Species API"
    source_url: str
    retrieved_at: str
    data_mode: DataMode


# --------------------------------------------------------------- occurrences
class OccurrenceRecord(BaseModel):
    gbif_id: str
    occurrence_key: int | None = None
    scientific_name: str | None = None
    accepted_scientific_name: str | None = None
    taxon_key: int | None = None
    lat: float | None = None
    lon: float | None = None
    coordinate_uncertainty_m: float | None = None
    event_date: str | None = None
    year: int | None = None
    basis_of_record: str | None = None
    occurrence_status: str | None = None
    dataset_key: str | None = None
    dataset_name: str | None = None
    publisher_key: str | None = None
    institution_code: str | None = None
    catalog_number: str | None = None
    license: str | None = None
    country_code: str | None = None
    issues: list[str] = Field(default_factory=list)
    source_url: str | None = Field(default=None, description="GBIF page URL this record was read from.")
    retrieved_at: str | None = None
    data_mode: DataMode | None = None


class OccurrenceSearchResult(BaseModel):
    taxon_key: int
    center_lat: float
    center_lon: float
    radius_km: float
    search_area_wkt_sha256: str
    gbif_total_count: int
    returned_count: int
    truncated: bool
    records: list[OccurrenceRecord]
    source_name: Literal["GBIF Occurrence API"] = "GBIF Occurrence API"
    source_urls: list[str]
    retrieved_at: str
    data_mode: DataMode
    cached_note: str | None = None
    absence_note: str = "Zero returned records is not evidence that the taxon is absent from the area."


# ------------------------------------------------------------ quality audit
RecordClass = Literal["usable", "usable_with_caution", "insufficient_for_spatial_check", "invalid", "duplicate"]


class QualityReason(BaseModel):
    code: str
    message: str


class OccurrenceQualityFinding(BaseModel):
    gbif_id: str
    record_class: RecordClass
    reasons: list[QualityReason]
    explanation: str
    distance_km_to_declared: float | None = None
    dataset_key: str | None = None
    source_url: str | None = None


class OccurrenceQualityReport(BaseModel):
    method_version: str
    records_total: int
    counts: dict[str, int]
    reason_counts: dict[str, int]
    findings: list[OccurrenceQualityFinding]
    parameters: dict[str, Any]
    limitations: list[str]


class OccurrenceQualityRequest(BaseModel):
    records: list[OccurrenceRecord] = Field(max_length=5000)
    declared_latitude: float | None = Field(default=None, ge=-90, le=90)
    declared_longitude: float | None = Field(default=None, ge=-180, le=180)
    uncertainty_threshold_m: float = Field(default=5000.0, gt=0, le=100000)
    repeated_coordinate_threshold: int = Field(default=3, ge=2, le=50)


# ------------------------------------------------------ origin consistency
OriginStatus = Literal["CORROBORATED", "INSUFFICIENT_PUBLIC_RECORDS", "LOCATION_CONFLICT", "IDENTITY_UNRESOLVED", "NOT_CHECKED"]


class OriginConsistencyResult(BaseModel):
    status: OriginStatus
    explanation: str
    evidence: dict[str, Any]
    limitations: list[str]
    automated: bool = True


class EvidenceFinding(BaseModel):
    finding_id: str
    batch_id: str
    audit_id: str
    category: str
    status: str
    explanation: str
    source_name: str
    source_url: str | None = None
    source_record_ids: list[str] = Field(default_factory=list)
    retrieved_at: str | None = None
    method_version: str
    limitations: list[str]
    review_state: Literal["automated", "awaiting_human_review"]


class AuditStep(BaseModel):
    name: str
    status: Literal["ok", "skipped", "failed"]
    started_at: str
    finished_at: str
    detail: str


class AuditReport(BaseModel):
    audit_id: str
    batch_id: str
    created_at: str
    method_version: str
    batch_snapshot: dict[str, Any]
    batch_completeness: FieldCompleteness
    taxonomy: TaxonomyResolution | None
    occurrence_search: OccurrenceSearchResult | None
    occurrence_error: dict[str, Any] | None
    quality: OccurrenceQualityReport | None
    origin: OriginConsistencyResult
    overall_status: str
    findings: list[EvidenceFinding]
    timeline: list[AuditStep]
    unresolved_questions: list[str]
    scientific_limitations: list[str]
    sources: list[dict[str, Any]]
    integrity: dict[str, str] = Field(default_factory=dict)


def utc_now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
