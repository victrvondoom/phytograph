"""SQLite persistence (standard library sqlite3; no ORM)."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    batch_id TEXT PRIMARY KEY,
    supplier_name TEXT NOT NULL,
    declared_botanical_name TEXT NOT NULL,
    plant_part TEXT NOT NULL,
    declared_country TEXT NOT NULL,
    declared_state TEXT,
    declared_district TEXT,
    latitude REAL,
    longitude REAL,
    collection_date TEXT,
    collection_type TEXT NOT NULL,
    supplier_batch_reference TEXT,
    document_references TEXT NOT NULL DEFAULT '[]',
    data_origin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
    audit_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES batches(batch_id),
    created_at TEXT NOT NULL,
    method_version TEXT NOT NULL,
    overall_status TEXT NOT NULL,
    origin_status TEXT NOT NULL,
    identity_status TEXT NOT NULL,
    report_json TEXT NOT NULL,
    body_sha256 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audits_by_batch ON audits(batch_id, created_at);

CREATE TABLE IF NOT EXISTS findings (
    finding_id TEXT PRIMARY KEY,
    audit_id TEXT NOT NULL REFERENCES audits(audit_id),
    batch_id TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    explanation TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    source_record_ids TEXT NOT NULL DEFAULT '[]',
    retrieved_at TEXT,
    method_version TEXT NOT NULL,
    limitations TEXT NOT NULL DEFAULT '[]',
    review_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS occurrence_cache (
    cache_key TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    body_json TEXT NOT NULL
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
