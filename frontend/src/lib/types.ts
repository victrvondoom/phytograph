// Mirrors backend/vanasignal/origin/schemas.py. The UI renders these; it never recomputes conclusions.

export type PlantPart = "root" | "rhizome" | "leaf" | "flower" | "fruit" | "seed" | "bark" | "whole_plant" | "resin" | "other" | "unknown";
export type CollectionType = "wild-harvested" | "cultivated" | "unknown";
export type DataOrigin = "manual" | "synthetic";
/** live = api.gbif.org; cached = local copy with original retrieval time; non_gbif_test_endpoint = test/fixture server. */
export type DataMode = "live" | "cached" | "non_gbif_test_endpoint";

export interface BatchFields {
  supplier_name: string;
  declared_botanical_name: string;
  plant_part: PlantPart;
  declared_country: string;
  declared_state: string | null;
  declared_district: string | null;
  latitude: number | null;
  longitude: number | null;
  collection_date: string | null;
  collection_type: CollectionType;
  supplier_batch_reference: string | null;
  document_references: string[];
  data_origin: DataOrigin;
}

export interface BatchCreate extends BatchFields {
  batch_id: string;
}

export interface AuditSummary {
  audit_id: string;
  created_at: string;
  origin_status: OriginStatus;
  identity_status: string;
  overall_status: string;
}

export interface BatchRead extends BatchCreate {
  created_at: string;
  updated_at: string;
  completeness: { required_missing: string[]; optional_missing: string[]; completeness_share: number };
  latest_audit: AuditSummary | null;
}

export type OriginStatus = "CORROBORATED" | "INSUFFICIENT_PUBLIC_RECORDS" | "LOCATION_CONFLICT" | "IDENTITY_UNRESOLVED" | "NOT_CHECKED";
export type RecordClass = "usable" | "usable_with_caution" | "insufficient_for_spatial_check" | "invalid" | "duplicate";

export interface TaxonCandidate {
  usage_key: number;
  accepted_key: number | null;
  scientific_name: string;
  canonical_name: string | null;
  rank: string | null;
  taxonomic_status: string | null;
  match_type: string | null;
  confidence: number | null;
  kingdom: string | null;
}

export interface TaxonomyResolution {
  submitted_name: string;
  resolution_status: "RESOLVED" | "SYNONYM_RESOLVED" | "AMBIGUOUS" | "UNRESOLVED";
  explanation: string;
  resolved_name: string | null;
  accepted_name: string | null;
  taxon_key: number | null;
  usage_key: number | null;
  taxonomic_status: string | null;
  match_type: string | null;
  confidence: number | null;
  selection: "automatic" | "user_confirmed" | "none";
  candidates: TaxonCandidate[];
  source_name: string;
  source_url: string;
  retrieved_at: string;
  data_mode: DataMode;
}

export interface OccurrenceRecord {
  gbif_id: string;
  occurrence_key: number | null;
  scientific_name: string | null;
  accepted_scientific_name: string | null;
  taxon_key: number | null;
  lat: number | null;
  lon: number | null;
  coordinate_uncertainty_m: number | null;
  event_date: string | null;
  year: number | null;
  basis_of_record: string | null;
  occurrence_status: string | null;
  dataset_key: string | null;
  dataset_name: string | null;
  publisher_key: string | null;
  institution_code: string | null;
  catalog_number: string | null;
  license: string | null;
  country_code: string | null;
  issues: string[];
  source_url: string | null;
  retrieved_at: string | null;
  data_mode: DataMode | null;
}

export interface OccurrenceSearchResult {
  taxon_key: number;
  center_lat: number;
  center_lon: number;
  radius_km: number;
  search_area_wkt_sha256: string;
  gbif_total_count: number;
  returned_count: number;
  truncated: boolean;
  records: OccurrenceRecord[];
  source_name: string;
  source_urls: string[];
  retrieved_at: string;
  data_mode: DataMode;
  cached_note: string | null;
  absence_note: string;
}

export interface QualityReason {
  code: string;
  message: string;
}

export interface OccurrenceQualityFinding {
  gbif_id: string;
  record_class: RecordClass;
  reasons: QualityReason[];
  explanation: string;
  distance_km_to_declared: number | null;
  dataset_key: string | null;
  source_url: string | null;
}

export interface OccurrenceQualityReport {
  method_version: string;
  records_total: number;
  counts: Record<RecordClass, number>;
  reason_counts: Record<string, number>;
  findings: OccurrenceQualityFinding[];
  parameters: Record<string, unknown>;
  limitations: string[];
}

export interface OriginConsistencyResult {
  status: OriginStatus;
  explanation: string;
  evidence: Record<string, unknown>;
  limitations: string[];
  automated: boolean;
}

export interface EvidenceFinding {
  finding_id: string;
  batch_id: string;
  audit_id: string;
  category: string;
  status: string;
  explanation: string;
  source_name: string;
  source_url: string | null;
  source_record_ids: string[];
  retrieved_at: string | null;
  method_version: string;
  limitations: string[];
  review_state: "automated" | "awaiting_human_review";
}

export interface AuditStep {
  name: string;
  status: "ok" | "skipped" | "failed";
  started_at: string;
  finished_at: string;
  detail: string;
}

export interface AuditReport {
  audit_id: string;
  batch_id: string;
  created_at: string;
  method_version: string;
  batch_snapshot: Record<string, unknown>;
  batch_completeness: { required_missing: string[]; optional_missing: string[]; completeness_share: number };
  taxonomy: TaxonomyResolution | null;
  occurrence_search: OccurrenceSearchResult | null;
  occurrence_error: { code: string; message: string } | null;
  quality: OccurrenceQualityReport | null;
  origin: OriginConsistencyResult;
  overall_status: string;
  findings: EvidenceFinding[];
  timeline: AuditStep[];
  unresolved_questions: string[];
  scientific_limitations: string[];
  sources: Record<string, unknown>[];
  integrity: { body_sha256?: string; algorithm?: string; canonical?: string };
}

export interface AuditListItem {
  audit_id: string;
  created_at: string;
  overall_status: string;
  origin_status: string;
  identity_status: string;
  method_version: string;
}

export interface AppStatus {
  service: string;
  version: string;
  gbif_api_base: string;
  gbif_is_official: boolean;
  satellite_configured: boolean;
  write_token_required: boolean;
  record_modes: string[];
}

export interface ReviewOut {
  review_id: string;
  batch_id: string;
  audit_id: string;
  decision: "accept_for_further_review" | "reject" | "request_more_evidence";
  reviewer: string;
  note: string;
  decided_at: string;
}

export interface ReviewState {
  batch_id: string;
  state: "OPEN" | "CLOSED";
  latest_audit_id: string | null;
  latest_decision: ReviewOut | null;
  history: ReviewOut[];
}

export interface ArchNode {
  id: string;
  name: string;
  module: string;
  role: string;
  inputs: string[];
  outputs: string[];
  deterministic: boolean;
  uses_llm: boolean;
  column: number;
}

export interface ArchitectureGraph {
  nodes: ArchNode[];
  edges: [string, string][];
  security_controls: { control: string; status: "enforced" | "config"; detail: string }[];
  statement: string;
}
