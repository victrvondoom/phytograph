# VanaSignal: implementation status (Botanical Origin Evidence Gate, Phase 1)

## Milestones

| # | Milestone | Status |
|---|---|---|
| M1 | Repository inspection, AGENTS.md, baseline tests | Done. Baseline: 50 legacy backend tests passing, pyflakes clean, legacy frontend typechecked. |
| M2 | SQLite persistence and batch intake | Done. Validation, duplicate IDs (409), completeness, update, labelled synthetic seed. |
| M3 | GBIF taxonomy integration | Implemented and tested with fixtures. **Live: NOT verified** (api.gbif.org blocked). |
| M4 | GBIF occurrence integration and caching | Implemented and tested with fixtures. Cache labelled with original retrieval time. **Live: NOT verified.** |
| M5 | Quality audit and origin consistency | Done and tested against planted errors. |
| M6 | Frontend vertical slice | Done: inbox, intake form, audit workspace (map + evidence), dossier. Browser-tested. |
| M7 | Evidence registry, export, tests | Done: findings with provenance, JSON and Markdown export, integrity hash, 85 tests. |

## Definition-of-done check (Phase 1)

| # | Criterion | Result |
|---|---|---|
| 1 | Application starts | **Met.** Backend (uvicorn) and frontend (vite preview) started and served. |
| 2 | User creates a medicinal-botanical batch | **Met.** Through the UI form and the API. |
| 3 | Backend resolves a botanical name using GBIF | **NOT MET (live).** Code path works against fixtures and a fixture server. Live GBIF returns 403 from the egress proxy. |
| 4 | Backend retrieves real occurrence records | **NOT MET (live).** No real GBIF record exists in this environment. |
| 5 | Records displayed on the interactive map | **Met with non-live data only.** Verified with fixture records, labelled NOT GBIF. |
| 6 | System identifies implemented data-quality problems | **Met.** Planted-error benchmark matches its expected outcomes exactly. |
| 7 | Reasoned origin-evidence status | **Met with non-live data only.** |
| 8 | Each finding preserves source and limitations | **Met.** Tested for all required fields. |
| 9 | Open a batch audit and download its report | **Met with non-live data only.** JSON and Markdown exports, integrity verified. |
| 10 | Automated tests pass | **Met.** 85 passed, 2 skipped (live GBIF; reason recorded). |
| 11 | Frontend production build succeeds | **Met.** `tsc -b` and `vite build` both pass. |
| 12 | No critical console errors or broken primary workflows | **Met.** One expected 409 is logged when the duplicate-ID test deliberately triggers it. |

**Phase 1 is NOT complete under the strict definition.** Criteria 3 and 4 depend on live GBIF. Criteria 5, 7
and 9 are demonstrated only with labelled non-live data.

## External-integration blocker (verified)

- `GET https://api.gbif.org/v1/species/match` → `CONNECT tunnel failed, response 403` from the egress proxy.
  The status log shows `connect_rejected` for `api.gbif.org:443`. This is an egress policy denial, and the
  proxy guidance says not to route around it.
- Consequence: no live GBIF response exists here. Nothing in this repository claims live integration succeeded.

## Verification evidence (this session)

- `pytest` (backend): 85 passed, 2 skipped (live GBIF). Run time about 28 s.
- `tsc -b` and `vite build` (frontend): pass.
- Planted-error benchmark: 19 records; usable 4, caution 10, insufficient 1, invalid 2, duplicate 2. Matches the expected counts.
- Browser workflow (Playwright, production build, via `/api` proxy): inbox, intake validation messages, duplicate-ID rejection, audit with map and records, record drill-down, class filter, ambiguous identity, dossier downloads, integrity verified. Zero external requests. One expected 409 console entry.
- Outage behaviour: with the connector down, a previously cached audit returns `CACHED` with its original
  retrieval time. An uncached name returns `NOT_CHECKED` with the error shown.
- Evidence screenshots from the run are in `docs/legacy/evidence/` (earlier prototype, not this product) and in the browser run output directory (not committed).

## Corrections made during development (disclosed)

- The batch-intake validator first rejected inputs for an unrelated reason in my own smoke test; re-tested with valid base data.
- A fixture with a count of 22 and 19 records was corrected to 19 so it does not fake truncation.
- The repeated-coordinate rule was changed to count distinct identifiers after the planted-error test failed. The expectations were not changed.
- Map crash: invalid coordinates were plotted and corrupted the camera bounds. Now only drawable coordinates are plotted; invalid rows stay in the table.
- Map readiness used a ref, so data arriving before the map loaded was never drawn. Changed to state.
- Non-GBIF data was labelled `live`. Added the explicit `non_gbif_test_endpoint` mode across the API and UI.
