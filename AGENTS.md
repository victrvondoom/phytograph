# AGENTS.md: VanaSignal engineering record

VanaSignal identifies medicinal-plant occurrence-data gaps, audits occurrence quality,
analyses conservation-area coverage and ranks candidate locations for field surveys.
It is a research-support tool. It is not a species-identification app, does not estimate
occupancy, and does not judge threat status or harvest safety.

## Current implementation status (honest)

| Area | Status |
|---|---|
| GBIF species resolution (`/species/match`) | Implemented, cached, retried; unit-tested with a synthetic transport. **Not verified against live GBIF**: this build environment's egress proxy denies `api.gbif.org` (HTTP 403). |
| GBIF occurrence retrieval (paged, PRESENT, geometry-filtered) | Implemented; same caveat. |
| Occurrence-quality audit | Implemented and tested on hand-built cases. |
| Spatial grid (H3, land-filtered with Natural Earth 50m) | Implemented and tested. |
| Coverage, gap and survey-priority scoring | Implemented and tested. |
| Protected-area overlay | Implemented for a user-supplied WDPA extract (`VANASIGNAL_WDPA_PATH`). **No WDPA data is bundled or downloaded**; the layer reports "not loaded" otherwise. |
| Evidence and provenance bundle | Implemented: manifest with GBIF URLs, licences, file SHA-256, versions; content-addressed run ID. |
| Withheld-observation benchmark | Implemented and reproducible (seeded). **No real benchmark results are reported**: none could be generated without GBIF data. |
| Quality-detection benchmark | Implemented (injected faults with known labels). |
| Counterfactual survey simulator | Implemented; scenario expectations only. |
| FastAPI service | Implemented; 18 routes; GBIF-down returns HTTP 503 `gbif_unavailable`, never a fabricated result. |
| MCP server (8 tools) | Implemented on `mcp` v1 (`FastMCP`); tool registration tested. |
| Next.js dashboard (5 sections, MapLibre map) | Implemented; typecheck, production build and a Playwright run against a synthetic-fixture run pass. |
| Deployment | Not deployed. Container/deploy config is not included in this commit. |

**Main gap:** every result that depends on real occurrence data (benchmark numbers, real
candidate lists, the live map) still needs one run on a machine that can reach
`api.gbif.org`. Run the commands in README.md, then `benchmark`.

## Architecture

```
frontend (Next.js, TS, Tailwind, MapLibre)  ──HTTP/JSON──▶  backend/vanasignal/api.py (FastAPI)
                                                              │
mcp_server.py (8 MCP tools) ─────────────────────────────────▶│  thin adapters
                                                              ▼
 pipeline.py (orchestrator) ──▶ gbif.py ─▶ quality.py ─▶ spatial.py ─▶ protected.py
                             ──▶ benchmark.py   simulate.py   evidence (manifest/report in pipeline.py)
```

- Analytical modules have no dependency on FastAPI or MCP; the adapters import them.
- `RecordSource` abstracts the record origin. Only `GBIFSource` labels output `gbif`; tests use a
  `FixtureSource` that labels output `fixture`, so synthetic data cannot pass as GBIF.
- Runs are written to `backend/data/runs/<run_id>/` (not committed): `summary.json`,
  `manifest.json`, `occurrences.csv|geojson`, `grid.geojson`, `grid_metrics.csv`, `report.md`,
  optional `benchmark.json`.

## Decisions

1. **Record weights.** clean = 1.0; questionable = 0.5; excluded = 0. These are analytical
   choices, not calibrated probabilities.
2. **Exclusions:** missing, invalid or zero coordinates; outside the study region; duplicate
   (same rounded 5-dp coordinate and event date; the first gbif_id is kept).
3. **Questionable:** coordinate uncertainty above threshold (default 5 km); severe GBIF geospatial
   issue codes; fossil or living-specimen basis; **off-land** (outside Natural Earth land, when a
   mask is present). Coastal records can be legitimate, so off-land is flagged, not excluded.
4. **Priority** = 0.5·gap + 0.3·isolation + 0.2·quality_deficit (configurable, stored in each run).
   - gap = 1 − log1p(weighted count)/log1p(max); empty cells score 1.
   - isolation = distance from cell centre to nearest usable record, capped at 100 km.
   - quality_deficit = questionable share of the cell's records.
5. **Greedy candidate selection** keeps candidates at least 2 H3 rings apart.
6. **Protected overlap is context only.** It never enters the priority score.
7. **Absence records** are counted and reported separately, never treated as absence.
8. **No land mask, no sea-ranked cells:** cells are restricted to Natural Earth 50m land
   (public domain, vendored at `backend/data/reference/ne_50m_land.geojson`, SHA-256 in manifest).
9. **Simulator** uses explicit occupancy scenarios ψ; it reports expectations, not occupancy.

## Data contracts

- `AnalysisRequest`: species (3–200 chars), bbox `(min_lon, min_lat, max_lon, max_lat)` with
  ranges enforced and span ≤ 30°, resolution 3–6, max_records 10–20000, uncertainty 0–100000 m.
- Occurrence record (after `gbif.parse_occurrence`): gbif_id, occurrence_key, dataset_key,
  publisher_key, institution_code, catalog_number, lat, lon, coordinate_uncertainty_m,
  event_date, year, basis_of_record, occurrence_status, license, issues, last_interpreted.
- Audit output adds `quality_status`, `quality_weight`, `quality_reasons`, and `flag_*` booleans.
- Grid cell metrics: raw_records, weighted_records, questionable_share, nearest_record_km,
  gap_score, isolation_score, quality_deficit, priority_score, cell_status, protected_overlap_share.
- Error codes (HTTP): `species_not_resolved` 404 (with suggestions), `no_records` 404,
  `region_too_large` 422, `gbif_unavailable` 503, `gbif_error` 502, `unknown_cells` 422.

## API integrations

- GBIF REST v1, base `https://api.gbif.org/v1`. Endpoints: `/species/match` (verbose),
  `/occurrence/search` (taxonKey, geometry WKT counter-clockwise, hasCoordinate, occurrenceStatus,
  limit ≤ 300, offset ≤ 100000), counts via `limit=0`.
- Caching: every successful response is cached on disk by URL with `retrieved_at`. Cache entries do not
  expire; delete `backend/data/cache/gbif/` to refresh. Retries: 429/5xx with exponential backoff;
  403 and other policy errors are never retried.
- User-Agent: `VanaSignal/0.1 (...)`. No contact e-mail is embedded.
- Natural Earth land (static file, public domain). WDPA: operator-supplied only (licence restricts redistribution).
- Basemap: OpenStreetMap raster tiles (browser-side; attribution shown).

## Licensing

- Code: project licence to be chosen by the maintainers (not yet declared in this repository).
- GBIF occurrence records keep their **own** licence per record (`license` column; the manifest
  lists counts). Respect each record's licence and citation requirements when redistributing.
- Natural Earth data: public domain.
- WDPA (Protected Planet): licence terms apply; supply your own extract under those terms.
- OpenStreetMap tiles: ODbL, attribution displayed.

## Benchmark methodology

Run with `python -m vanasignal.cli benchmark --run <id>` or `POST /api/analyses/{id}/benchmark`.

1. **Withheld-observation (seeds × splits).** For each seed, a random 30% of usable records is
   withheld. Strategies rank cells using training records only:
   `random`, `highest_count` (baseline), `vanasignal`, `vanasignal_no_quality` (ablation with the
   quality term removed and the other weights rescaled).
   - Recall@K: share of withheld records in the top-K cells.
   - Novel-cell recall@K: share of cells that hold withheld records but no training records,
     that are in the top K.
   - Coverage gain (pp): change in share of grid-cell centres within 50 km of a record, after adding
     the top-K cell centres as hypothetical survey points.
   - Ranking stability: mean Jaccard overlap of top-10 sets across seed pairs; Spearman correlation
     of priority vectors for score-based methods.
   - Caveat: the ablation equals the full method when no record is questionable; it can only
     differ on data with quality problems.
2. **Quality detection.** Faults are injected into a copy of the records at a fixed rate per type:
   zero coordinates, latitude out of range, missing coordinates, duplicate record, swapped lat/lon,
   high uncertainty (rule-visible by design), and a plausible 1° latitude shift (not rule-visible).
   Precision, recall, F1, per-fault detection rate, and flag rate on uninjected rows.
   Ground truth is the injection log, not expert labels.
3. Seeds are fixed, so identical data and parameters give identical output (tested).

Interpretation: none of these metrics measure ecological accuracy or true occupancy.

## Testing

- `backend`: `pip install -e ".[dev]"` then `pytest`. 50 tests, offline. GBIF is replaced by
  `FakeGBIF` (a synthetic transport that serves GBIF-shaped JSON to the real client code) and
  records by `synthetic_records`. Both are labelled as test fixtures in `tests/fixtures.py`.
- Frontend: `npm run typecheck`, `npm run build`. UI behaviour was checked with a Playwright script
  (`docs/evidence/synthetic-fixture-ui/ui-check.js`) against a synthetic-fixture run. Results:
  banners, failure states, benchmark and simulator tables, report and exports render; no console
  errors; no horizontal overflow at 390 px.
- Lint: `pyflakes backend/vanasignal`.

## Known limitations

- No land-cover, climate or habitat covariates: coverage is geographic, not environmental.
- The priority weights are a documented judgement, not fitted to outcomes.
- The grid is limited to 50,000 cells per run; the synchronous API may time out for very large regions.
- Caches never expire automatically.
- Common-name resolution is not supported; users must give scientific names.
- The benchmark measures internal consistency and detection behaviour on retrieved data, not external validity.
