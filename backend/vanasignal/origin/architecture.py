"""Single source of truth for the architecture studio. Describes the deterministic modules and their data flow.

Every node is deterministic code: no node calls a language model. The "robots" in the UI are visual views of
these nodes' recorded outcomes, not autonomous decision-makers.
"""

from __future__ import annotations

NODES = [
    {"id": "conductor", "name": "Audit conductor", "module": "origin/audit.py", "role": "Central orchestrator. Runs every robot in order and records the timeline.",
     "inputs": ["batch_id"], "outputs": ["AuditReport"], "deterministic": True, "uses_llm": False, "column": 1},
    {"id": "intake", "name": "Batch intake robot", "module": "origin/batches.py", "role": "Reads the batch from SQLite and measures documentation completeness.",
     "inputs": ["batch record"], "outputs": ["completeness"], "deterministic": True, "uses_llm": False, "column": 2},
    {"id": "taxonomy", "name": "Taxonomy robot", "module": "origin/taxonomy.py", "role": "Resolves the declared name via the GBIF Species API. Ambiguity is never auto-selected.",
     "inputs": ["declared name"], "outputs": ["TaxonomyResolution"], "deterministic": True, "uses_llm": False, "column": 2},
    {"id": "collector", "name": "Occurrence collector robot", "module": "origin/occurrences.py", "role": "Retrieves GBIF occurrence records in a search circle; keeps provenance and cache labels.",
     "inputs": ["taxon key", "declared point"], "outputs": ["OccurrenceSearchResult"], "deterministic": True, "uses_llm": False, "column": 2},
    {"id": "quality", "name": "Quality auditor robot", "module": "origin/record_quality.py", "role": "Classifies every record with explicit reason codes. Deletes nothing.",
     "inputs": ["records"], "outputs": ["OccurrenceQualityReport"], "deterministic": True, "uses_llm": False, "column": 3},
    {"id": "consistency", "name": "Origin consistency robot", "module": "origin/consistency.py", "role": "Maps identity, coordinates and usable records to one evidence status.",
     "inputs": ["taxonomy", "quality"], "outputs": ["OriginConsistencyResult"], "deterministic": True, "uses_llm": False, "column": 3},
    {"id": "registry", "name": "Evidence registry robot", "module": "origin/registry.py", "role": "Writes each finding with source, retrieval time, limitations and review state to SQLite.",
     "inputs": ["all results"], "outputs": ["EvidenceFinding[]", "stored audit"], "deterministic": True, "uses_llm": False, "column": 4},
    {"id": "dossier", "name": "Dossier robot", "module": "origin/dossier.py", "role": "Finalises the status, adds an integrity hash, and renders JSON, Markdown and CSV exports.",
     "inputs": ["AuditReport"], "outputs": ["dossier files"], "deterministic": True, "uses_llm": False, "column": 5},
    {"id": "reviewer", "name": "Human review (closure)", "module": "origin/reviews.py", "role": "A named person records a decision against a specific audit. The batch closes only then.",
     "inputs": ["audit id", "decision"], "outputs": ["ReviewState"], "deterministic": False, "uses_llm": False, "column": 5},
]

EDGES = [
    ["conductor", "intake"], ["conductor", "taxonomy"], ["taxonomy", "collector"], ["collector", "quality"],
    ["intake", "consistency"], ["quality", "consistency"], ["taxonomy", "consistency"],
    ["consistency", "registry"], ["registry", "dossier"], ["dossier", "reviewer"],
]

SECURITY_CONTROLS = [
    {"control": "Security headers", "status": "enforced", "detail": "CSP, nosniff, frame-deny, no-referrer on every response."},
    {"control": "Payload limit", "status": "enforced", "detail": "Requests above 1 MB are rejected before processing."},
    {"control": "Write token", "status": "config", "detail": "Set VANASIGNAL_API_TOKEN to require a bearer token on every change."},
    {"control": "No third-party browser requests", "status": "enforced", "detail": "The browser calls this origin only. Satellite tiles are proxied by the server."},
    {"control": "Server-held satellite key", "status": "config", "detail": "VANASIGNAL_SATELLITE_TEMPLATE lives only on the server."},
    {"control": "CSV formula neutralisation", "status": "enforced", "detail": "Cells beginning with = + - @ are prefixed before export."},
    {"control": "Human closure", "status": "enforced", "detail": "A named decision is required before a batch closes. The reviewer name is a label, not an authenticated identity."},
]
