# Connector fixtures (NOT recorded from the live API)

These JSON files were **hand-authored** to follow the field names and envelope shapes of the
GBIF Species API (`/species/match`) and Occurrence API (`/occurrence/search`) as documented at
https://techdocs.gbif.org/en/openapi/. They were NOT captured from the live API: the build
environment could not reach api.gbif.org (HTTP 403 from the egress proxy).

- Taxon keys (900000xxx) and record identifiers (1001–1019) are test constants, not GBIF identifiers.
- The planted errors and their expected classes are listed in `expected_quality_outcomes.json`
  and were written before the classifier was run.
- Replace these with recorded responses once a live run is possible; the live integration
  test (`tests/test_live_gbif_integration.py`) is the check for schema drift.
