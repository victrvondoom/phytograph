# VanaSignal

Biodiversity intelligence for medicinal-plant occurrence data (EthnoHack 2026, Track 3).
VanaSignal finds occurrence-data gaps, audits record quality, checks protected-area coverage and
ranks candidate survey locations. Each result comes with its indicators, warnings and provenance.
See [AGENTS.md](AGENTS.md) for the architecture, decisions, data contracts, licensing and the current
implementation status.

**Important:** the GBIF API was not reachable from the build environment, so no live analysis or
benchmark result is included in this repository. Run the steps below on a machine with internet access.

## Quick start

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                       # offline test suite
uvicorn vanasignal.api:app --port 8000
```

Live analysis from the command line (calls GBIF; responses are cached in `backend/data/cache/gbif`):

```bash
cd backend
python -m vanasignal.cli analyse --species "Withania somnifera" --bbox 74.8 8.1 77.5 12.8
python -m vanasignal.cli benchmark --run <run_id> --seeds 20
```

Frontend:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev    # http://localhost:3000
```

## Optional configuration (environment variables)

| Variable | Purpose |
|---|---|
| `VANASIGNAL_DATA_DIR` | Where caches and runs are written (default `backend/data`). |
| `VANASIGNAL_WDPA_PATH` | Local WDPA extract (GeoPackage/Shapefile/GeoJSON) you are licensed to use. |
| `VANASIGNAL_LAND_MASK` | Alternative land polygons; defaults to the vendored Natural Earth 50m file. |
| `VANASIGNAL_CORS_ORIGINS` | Comma-separated dashboard origins (default `http://localhost:3000`). |

## MCP server

```bash
cd backend && python -m vanasignal.mcp_server
```

Tools: `resolve_species`, `fetch_occurrences`, `audit_occurrence_quality`, `detect_sampling_gaps`,
`analyze_protected_overlap`, `rank_survey_locations`, `simulate_survey_plan`, `generate_evidence_report`.

## Evidence and reproducibility

Every run writes `manifest.json` (GBIF request URLs, retrieval timestamps, licence counts, SHA-256
of outputs, package versions) and `report.md`. The run ID is a hash of the request, the accepted
taxon key and the record set, so identical inputs against the same GBIF snapshot give the same ID.

`docs/evidence/synthetic-fixture-ui/` contains UI screenshots from a **synthetic** run. They show
rendering and failure handling only and are not occurrence data.

## Scope limits

Not a species-identification tool. It does not estimate occupancy, threat status or harvest safety.
Protected-area overlap is context only. Read the limitations in AGENTS.md before interpreting any output.
