// Types mirror the JSON written by the VanaSignal backend (backend/vanasignal).

export type Bbox = [number, number, number, number];

export interface Suggestion {
  key: number;
  scientific_name: string;
  rank?: string | null;
  status?: string | null;
  kingdom?: string | null;
}

export interface ResolvedSpecies {
  query: string;
  usage_key: number;
  accepted_key: number;
  scientific_name: string;
  canonical_name: string | null;
  rank: string | null;
  status: string | null;
  match_type: string;
  confidence: number | null;
  kingdom: string | null;
  warnings: string[];
  retrieved_at: string;
  request_url: string;
  suggestions: Suggestion[];
}

export interface AuditSummary {
  records_total: number;
  records_usable: number;
  records_usable_weighted: number;
  status_counts: Record<string, number>;
  flag_counts: Record<string, number>;
  missing_coordinate_share: number;
  duplicate_share: number;
  questionable_share: number;
  coordinate_uncertainty_threshold_m: number;
  uncertainty_median_m: number | null;
  top_gbif_issues: { issue: string; count: number }[];
  distinct_datasets: number;
  license_counts: Record<string, number>;
  year_range: [number, number] | null;
  warnings: string[];
}

export interface Coverage {
  total_cells: number;
  occupied_cells: number;
  occupied_share: number;
  unsurveyed_cells: number;
  sparse_cells: number;
  covered_cells: number;
  median_nearest_record_km: number | null;
  record_concentration_gini: number;
  cell_area_km2_approx: number | null;
}

export interface Candidate {
  rank: number;
  cell: string;
  center_lat: number;
  center_lon: number;
  priority_score: number;
  raw_records: number;
  weighted_records: number;
  cell_status: string;
  protected_overlap_share: number;
  explanation: {
    text: string;
    indicators: { gap_score: number; isolation_score: number; quality_deficit: number; priority_score: number };
    warnings: string[];
  };
}

export interface Summary {
  run_id: string;
  created_at: string;
  data_source: string;
  data_source_kind: string;
  request: {
    species: string;
    bbox: Bbox;
    resolution: number;
    max_records: number;
    uncertainty_threshold_m: number;
    include_protected: boolean;
  };
  resolved_species: ResolvedSpecies;
  gbif_total_count: number | null;
  absence_and_coordinate_counts: {
    absent_records_with_coordinates_in_region?: number;
    present_records_without_coordinates_species_wide?: number;
    error?: string;
    note?: string;
  };
  quality_audit: AuditSummary;
  coverage: Coverage;
  protected_areas: { loaded: boolean; reason?: string; note?: string; polygons_in_region?: number; source_file?: string };
  priority_config: { w_gap: number; w_isolation: number; w_quality: number; isolation_cap_km: number; sparse_threshold: number };
  candidates: Candidate[];
  warnings: string[];
  files: string[];
}

export interface RunListItem {
  run_id: string;
  species: string;
  created_at: string;
  records_usable: number;
  data_source_kind: string | null;
  bbox: Bbox;
}

export interface Health {
  status: string;
  gbif: { reachable: boolean; latency_ms?: number; error?: string };
  land_mask_configured: boolean;
  protected_areas_configured: boolean;
  runs_stored: number;
}

export interface Region {
  id: string;
  label: string;
  bbox: Bbox;
}

export interface SimulationResult {
  kind: string;
  selected_cells: number;
  selected_unsurveyed_cells: number;
  visits_total: number;
  assumptions: { detection_probability_per_visit: number; visits_per_cell: number; p_detect_survey: number; independence: string };
  scenarios: {
    occupancy_assumption_psi: number;
    p_detect_at_least_once_per_cell: number;
    expected_cells_with_new_detection: number;
    expected_unsurveyed_cells_closed: number;
    expected_new_records: number;
    expected_unsurveyed_share_before: number;
    expected_unsurveyed_share_after: number;
  }[];
  disclaimer: string;
}

export interface Dist {
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

export interface BenchmarkResult {
  run_id: string;
  data_source_kind: string | null;
  parameters: Record<string, unknown>;
  withheld_observation: {
    usable_records: number;
    candidate_cells: number;
    seeds_run: number;
    test_fraction: number;
    k_values: number[];
    coverage_radius_km: number;
    methods: Record<string, Record<string, { record_recall: Dist; novel_cell_recall: Dist; coverage_gain_pp: Dist }>>;
    ranking_stability: Record<string, { top10_jaccard: Dist; priority_spearman?: Dist }>;
    interpretation: string;
  };
  quality_detection: {
    injected_rows: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    flag_rate_on_uninjected_rows: number | null;
    by_fault_type: Record<string, { injected: number; flagged: number; detection_rate: number; rule_visible_by_design: boolean }>;
    interpretation: string;
  };
  limitations: string[];
}

export interface OccurrenceFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    gbif_id: string;
    quality_status: string;
    quality_reasons: string;
    event_date: string | null;
    dataset_name: string | null;
    license: string | null;
    coordinate_uncertainty_m: number | null;
  };
}
