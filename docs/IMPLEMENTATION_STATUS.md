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


## Phase 2 (2026-11-07): studio, robots, security, closure, satellite

| Item | Status |
|---|---|
| 3D robot stage (three.js 0.187.0): conductor + 7 worker robots driven by stored audit outcomes | Done, browser-verified (WebGL canvas renders) |
| Architecture studio: module graph, selectable robots, security controls | Done, browser-verified |
| Human review closure: decision bound to a specific audit; batch closes; new audit reopens | Done, tested and browser-verified |
| Security: headers, 1 MB limit, bearer-token writes, formula-safe CSV | Done, tested |
| Satellite basemap via server proxy (key server-side, validated coordinates, disk cache) | Done; verified against a STUB provider only |
| Redesigned UI on one dark design system (rail, status bar, tabs, record drill-down) | Done, browser-verified |
| Live GBIF | Still NOT verified (api.gbif.org blocked by egress proxy) |

Verification this session: backend 96 passed / 2 skipped (live GBIF). Frontend typecheck and build pass.
Browser flow (Playwright, production build): zero console errors, zero page errors, zero external requests.
Screenshots: `docs/evidence/phase2-ui/`, labelled as fixture data with a stub satellite.

Corrections made during this phase:
- A FastAPI body parameter was silently treated as a query parameter because its model was imported inside a function. Moved to module level.
- The 3D stage created a new material per robot per frame (a GPU leak). Fixed by reusing the material.
- The workspace logged an expected 404 for every unaudited batch. The UI now checks the empty history first.
- The first satellite and tile wiring was tested only against the stub; no claim is made about a real provider.
