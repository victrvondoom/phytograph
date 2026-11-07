# AGENTS.md: VanaSignal engineering record

## Product objective and scope

**VanaSignal: Botanical Origin Evidence Gate.** A buyer-side workspace that checks whether public
biodiversity and geographic evidence supports a medicinal-plant supplier batch's claims: botanical
identity, declared location, and the consistency of the batch record. It produces an auditable evidence
dossier. It is an evidence-review tool, not a regulatory or certification engine.

It does NOT certify legal harvesting, medicinal efficacy, sustainable harvesting or population abundance.

Scope for Phase 1: Western Ghats medicinal sourcing, with Tamil Nadu and Kerala as the operational geography
(approximate bounding box in `origin/record_quality.py`), one complete batch audit workflow. No generic
biodiversity platform, MCP integration, land-cover analysis, or AI agents yet.

## Architecture and module responsibilities

```
React + Vite UI (frontend/)  --/api proxy-->  FastAPI (backend/vanasignal/api.py)
                                                  |
                                   origin/routes.py   (transport only)
                                                  |
                                   origin/audit.py  CENTRAL ORCHESTRATOR (deterministic)
        batch snapshot -> taxonomy.py -> occurrences.py -> record_quality.py
                       -> consistency.py -> registry.py (findings) -> dossier.py (finalize, integrity)
                                                  |
                       batches.py + db.py  (SQLite persistence, validation)
                       gbif.py (cached, retrying GBIF connector; provenance)
```

| Module | Responsibility |
|---|---|
| `origin/schemas.py` | Shared pydantic contracts (BatchCreate/Read, TaxonomyResolution, OccurrenceRecord, OccurrenceSearchResult, OccurrenceQualityFinding/Report, OriginConsistencyResult, EvidenceFinding, AuditReport). |
| `origin/db.py`, `origin/batches.py` | SQLite schema; batch intake, duplicate control, completeness. |
| `origin/taxonomy.py` | GBIF Species API resolution with explicit ambiguity rules. |
| `origin/occurrences.py` | GBIF Occurrence API retrieval in a geodesic search circle; paging; cache labelling. |
| `origin/record_quality.py` | Deterministic per-record class and reason codes. |
| `origin/consistency.py` | Origin status from identity, coordinates and usable records. |
| `origin/registry.py` | Traceable findings with sources, limitations and review state; persisted audits. |
| `origin/dossier.py` | Finalises the overall status, SHA-256 integrity hash, Markdown dossier. |
| `origin/audit.py` | Orchestrates one audit and records the timeline. |
| `origin/routes.py` | HTTP endpoints. |
| `origin/seed.py` | Labelled SYNTHETIC demonstration batches (idempotent). |
| `gbif.py`, `quality.py`, `spatial.py`, `benchmark.py`, `pipeline.py` | Earlier gap-analysis prototype; retained, still tested. |

The frontend renders backend results and never computes scientific conclusions.

## Scientific integrity requirements (binding)

- Never invent occurrence records. Never fabricate citations.
- Zero returned records or an unrun search is never presented as absence.
- A nearby public observation never proves a batch's origin. Outputs say so.
- Never label a batch legal, legitimate or sustainable from geography or documents.
- Occurrence counts are never presented as population abundance.
- Documentation completeness is never presented as a quality or sustainability score.
- Every data item carries its mode: `live` (api.gbif.org), `cached` (local copy with its ORIGINAL retrieval
  time, always labelled), `non_gbif_test_endpoint` (any test/fixture server, labelled NOT GBIF), `synthetic`
  (demonstration batch), `manual` (entered by a user).
- Taxonomy is never auto-selected when plausible matches remain unresolved; a user must confirm a candidate
  returned by GBIF.
- Questionable records are kept and labelled. Nothing is deleted.
- Browser makes no third-party requests. Land outline is served by the backend (Natural Earth, public domain).

## Origin status definitions

| Status | Meaning (public evidence available now) |
|---|---|
| `CORROBORATED` | At least 3 usable records lie within 25 km of the declared point. Supports the declared area only. |
| `LOCATION_CONFLICT` | At least 3 usable records lie in the 100 km search area, but none lies within 25 km of the declared point. A conflict at this scale in public data, not proof that the batch is false. |
| `INSUFFICIENT_PUBLIC_RECORDS` | Fewer than 3 usable records, zero records returned, or partial local support (1–2 near). |
| `IDENTITY_UNRESOLVED` | No single accepted taxon established (ambiguous, unresolved, higher rank). |
| `NOT_CHECKED` | Not run: no declared coordinates, or a GBIF service failed. |

Only records classed `usable` count toward these statuses. `usable_with_caution` is reported but not counted.

## Occurrence quality classes

Precedence: `invalid` > `duplicate` > `insufficient_for_spatial_check` > `usable_with_caution` > `usable`.

- invalid: out-of-range coordinates, or the (0,0) placeholder.
- duplicate: repeated GBIF occurrence ID, or same 5-dp coordinates and event date under a different ID.
- insufficient: no coordinates.
- caution: uncertainty above threshold (default 5000 m), unknown uncertainty, missing date, outside the
  demonstration region, repeated coordinates (≥3 distinct IDs at the same point), missing dataset
  attribution, a severe GBIF geospatial issue, or a fossil/living basis of record.

Design decision made during testing: repeated-coordinate counts use distinct IDs, so a duplicate row does not
flag its original record. The planted-error expectations were written before the classifier was run, and
that defect was found by the test.

## Robots, architecture studio and the honest scope of "agents"

The UI shows one conductor and seven specialist robots (Intake, Taxonomy, Collector, Quality, Consistency,
Registry, Dossier). Each robot is a 3D view of one deterministic backend module. Its colour is read from the stored
audit timeline and results (`frontend/src/lib/robots.ts`). The robots do not compute science and do not call
language models. The architecture studio (`/architecture`) renders the module graph from `GET /api/architecture`,
which is generated from `origin/architecture.py`. A test asserts that no node uses an LLM.

The human reviewer is the only non-robot node. A named person records a decision against a specific audit,
and the batch closes only then (`origin/reviews.py`). A new audit reopens the review.

## Security model

- Security headers on every API response (CSP, nosniff, frame-deny, no-referrer). The static host must send the same CSP in production.
- 1 MB request body limit.
- Optional bearer token (`VANASIGNAL_API_TOKEN`) on all state-changing endpoints (401 otherwise).
- CSV exports neutralise formula injection (`origin/security.py`).
- Satellite imagery is proxied by the server (`/api/tiles/satellite/{z}/{x}/{y}`). The provider template and key
  live only in server configuration. Coordinates are validated and no user-supplied URL is fetched.
- The browser makes no third-party requests (verified: zero external requests in the browser run).
- The reviewer name is a typed attribution label. This build has no user accounts, so it is not an authenticated identity.

## Coding conventions

- Python 3.11+, type-annotated, pydantic v2 for every boundary, pyflakes-clean.
- Analytical modules take plain objects and do not import FastAPI or MCP.
- Frontend: React + Vite + TypeScript (strict), Tailwind v4. shadcn/ui was not added: the UI uses small
  in-house components to avoid a generator dependency. MapLibre GL JS 6 via named imports.
- Errors: explicit codes (`gbif_unavailable` 503, `gbif_error` 502, `duplicate_batch_id` 409,
  `batch_not_found` 404, `audit_not_found` 404, `invalid_candidate` 422, validation 422).

## Testing and execution commands

```bash
# Backend (offline suite)
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest                       # 85 passed, 2 skipped (live GBIF tests skip with the recorded reason)
python -m pyflakes vanasignal tests

# Frontend
cd frontend && npm install && npm run build   # tsc -b + vite build

# Run the application (two terminals)
cd backend && uvicorn vanasignal.api:app --port 8000
cd frontend && npm run dev                     # http://localhost:5173 (proxies /api to :8000)
cd backend && python -m vanasignal.origin.seed # labelled synthetic sample batches
```

Test kinds, kept separate:
- **Connector unit tests**: `tests/connector_fixtures.py` + `tests/fixtures/gbif/`. These are hand-authored
  GBIF-shaped fixtures, NOT recorded responses (see the README in that folder).
- **Planted-error benchmark**: `tests/fixtures/gbif/occurrence_planted_errors.json` with
  `expected_quality_outcomes.json`, written before running the classifier.
- **Live integration**: `tests/test_live_gbif_integration.py`. Skips when api.gbif.org is unreachable. A skip
  is not a pass.
- **Browser flow**: a Playwright script run against the production build. It is kept in the status
  document's evidence section, not in CI.

## Current implementation status

See `docs/IMPLEMENTATION_STATUS.md` for the milestone log and verified results.

## Known limitations

- **Satellite imagery is not verified against a real provider.** It was tested only with a stub that serves
  generated colour tiles. Configure `VANASIGNAL_SATELLITE_TEMPLATE` on the server to use a provider you are licensed for.
- **"Robots" are not autonomous agents.** They are visualisations of deterministic modules. Adding LLM-based agents
  would change the defensibility of the origin statuses and needs a separate design decision.
- The 3D stage runs on WebGL; a text list of robot states is shown when WebGL is unavailable.
- The static host must set the CSP header (the API sets it on its own responses only).

- **Live GBIF has not been exercised.** api.gbif.org returns HTTP 403 from the build environment's egress
  proxy. The occurrence and taxonomy paths are verified only against hand-authored fixtures, and against a
  local fixture server that replays them. Results from the local server are labelled NOT GBIF.
- No real cached-GBIF demonstration exists, because no real GBIF response was ever retrieved.
- The Tamil Nadu and Kerala region is an approximate bounding box, not an administrative boundary.
- Declared localities are not geocoded; only declared coordinates are compared.
- No documents are stored or verified; references only.
- Common names are not resolved; a scientific name is required.
- Cache entries never expire automatically (delete `backend/data/cache/gbif/` to refresh).
- The synchronous audit may take up to roughly 40 s on a live timeout path (timeout 12 s, 2 retries).
- Single-user SQLite; no authentication.
- Frontend bundle is about 1.4 MB because MapLibre is not code-split yet.

## Next-phase priorities

1. Run `analyse`-equivalent audits on a machine with internet access, record real GBIF responses into the
   connector fixtures, and run the live integration test. This is the single gating item.
2. Add authentication and role separation before any multi-user use.
3. Code-split the map bundle; add a Playwright regression suite into CI.
4. Geocode declared localities with a documented gazetteer, and evaluate the origin status sensitivity to
   the 25 km / 100 km / 3-record parameters.
5. ESA WorldCover habitat-context layer, only after the core workflow is verified live.
6. MCP exposure of the origin tools, after the above.
