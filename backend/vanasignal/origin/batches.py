"""Batch intake: persistence, duplicate control and completeness reporting."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from .schemas import OPTIONAL_FIELDS, REQUIRED_FIELDS, AuditSummary, BatchCreate, BatchRead, BatchUpdate, FieldCompleteness, utc_now_iso


class DuplicateBatchError(ValueError):
    pass


class BatchNotFoundError(LookupError):
    pass


def _filled(batch: dict[str, Any], field: str) -> bool:
    value = batch.get(field)
    if field == "document_references":
        return bool(value)
    if field == "collection_type":
        return value not in (None, "")  # 'unknown' is an explicit value and counts as recorded
    return value is not None and value != ""


def completeness_for(batch: dict[str, Any]) -> FieldCompleteness:
    required_missing = [f for f in REQUIRED_FIELDS if f != "batch_id" and not _filled(batch, f)]
    optional_missing = [f for f in OPTIONAL_FIELDS if not _filled(batch, f)]
    total = len(REQUIRED_FIELDS) - 1 + len(OPTIONAL_FIELDS)
    filled = total - len(required_missing) - len(optional_missing)
    return FieldCompleteness(
        required_missing=required_missing,
        optional_missing=optional_missing,
        completeness_share=round(filled / total, 4),
    )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["document_references"] = json.loads(d.get("document_references") or "[]")
    return d


def _params(body: BatchCreate | BatchUpdate) -> dict[str, Any]:
    data = body.model_dump(mode="json")
    data["document_references"] = json.dumps(data["document_references"])
    return data


class BatchRepository:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def _latest_audit(self, batch_id: str) -> AuditSummary | None:
        row = self.conn.execute(
            "SELECT audit_id, created_at, origin_status, identity_status, overall_status FROM audits "
            "WHERE batch_id = ? ORDER BY rowid DESC LIMIT 1",
            (batch_id,),
        ).fetchone()
        return AuditSummary(**dict(row)) if row else None

    def _to_read(self, row: sqlite3.Row) -> BatchRead:
        d = _row_to_dict(row)
        return BatchRead(
            **{k: d[k] for k in BatchCreate.model_fields},
            created_at=d["created_at"],
            updated_at=d["updated_at"],
            completeness=completeness_for(d),
            latest_audit=self._latest_audit(d["batch_id"]),
        )

    def create(self, body: BatchCreate) -> BatchRead:
        exists = self.conn.execute("SELECT 1 FROM batches WHERE batch_id = ?", (body.batch_id,)).fetchone()
        if exists:
            raise DuplicateBatchError(f"A batch with id '{body.batch_id}' already exists.")
        now = utc_now_iso()
        p = _params(body)
        p.update(created_at=now, updated_at=now)
        cols = ", ".join(p.keys())
        marks = ", ".join(f":{k}" for k in p)
        self.conn.execute(f"INSERT INTO batches ({cols}) VALUES ({marks})", p)
        self.conn.commit()
        return self.get(body.batch_id)

    def update(self, batch_id: str, body: BatchUpdate) -> BatchRead:
        if not self.conn.execute("SELECT 1 FROM batches WHERE batch_id = ?", (batch_id,)).fetchone():
            raise BatchNotFoundError(batch_id)
        p = _params(body)
        p.update(batch_id=batch_id, updated_at=utc_now_iso())
        sets = ", ".join(f"{k} = :{k}" for k in p if k != "batch_id")
        self.conn.execute(f"UPDATE batches SET {sets} WHERE batch_id = :batch_id", p)
        self.conn.commit()
        return self.get(batch_id)

    def get(self, batch_id: str) -> BatchRead:
        row = self.conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        if row is None:
            raise BatchNotFoundError(batch_id)
        return self._to_read(row)

    def list(self) -> list[BatchRead]:
        rows = self.conn.execute("SELECT * FROM batches ORDER BY created_at DESC, batch_id").fetchall()
        return [self._to_read(r) for r in rows]

    def raw(self, batch_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        if row is None:
            raise BatchNotFoundError(batch_id)
        return _row_to_dict(row)
