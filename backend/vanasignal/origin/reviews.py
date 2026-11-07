"""Human review and closure.

Automated statuses are never final. A named reviewer records a decision against a specific audit.
The batch review is CLOSED when the latest audit has a decision; otherwise it stays OPEN. The reviewer name
is typed by the user: this build has no user accounts, so it is an attribution label, not an authenticated identity.
"""

from __future__ import annotations

import sqlite3
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from .schemas import utc_now_iso

DECISIONS = ("accept_for_further_review", "reject", "request_more_evidence")
Decision = Literal["accept_for_further_review", "reject", "request_more_evidence"]

REVIEW_SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES batches(batch_id),
    audit_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    note TEXT NOT NULL,
    decided_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_by_batch ON reviews(batch_id, decided_at);
"""


class ReviewIn(BaseModel):
    audit_id: str = Field(min_length=5, max_length=120)
    decision: Decision
    reviewer: str = Field(min_length=2, max_length=80, description="Name of the person recording the decision.")
    note: str = Field(default="", max_length=1000)


class ReviewOut(ReviewIn):
    review_id: str
    batch_id: str
    decided_at: str


class ReviewState(BaseModel):
    batch_id: str
    state: Literal["OPEN", "CLOSED"]
    latest_audit_id: str | None
    latest_decision: ReviewOut | None
    history: list[ReviewOut]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(REVIEW_SCHEMA)


def record_review(conn: sqlite3.Connection, batch_id: str, body: ReviewIn) -> ReviewOut:
    latest = conn.execute("SELECT audit_id FROM audits WHERE batch_id = ? ORDER BY rowid DESC LIMIT 1", (batch_id,)).fetchone()
    if latest is None:
        raise LookupError("no_audit")
    if body.audit_id != latest["audit_id"]:
        raise ValueError("stale_audit")
    out = ReviewOut(review_id=f"REV-{uuid.uuid4().hex[:12]}", batch_id=batch_id, decided_at=utc_now_iso(), **body.model_dump())
    conn.execute(
        "INSERT INTO reviews (review_id, batch_id, audit_id, decision, reviewer, note, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (out.review_id, batch_id, out.audit_id, out.decision, out.reviewer, out.note, out.decided_at),
    )
    conn.commit()
    return out


def review_state(conn: sqlite3.Connection, batch_id: str) -> ReviewState:
    latest = conn.execute("SELECT audit_id FROM audits WHERE batch_id = ? ORDER BY rowid DESC LIMIT 1", (batch_id,)).fetchone()
    rows = conn.execute("SELECT review_id, batch_id, audit_id, decision, reviewer, note, decided_at FROM reviews WHERE batch_id = ? ORDER BY decided_at DESC", (batch_id,)).fetchall()
    history = [ReviewOut(**dict(r)) for r in rows]
    latest_id = latest["audit_id"] if latest else None
    decision = next((h for h in history if latest_id and h.audit_id == latest_id), None)
    return ReviewState(batch_id=batch_id, state="CLOSED" if decision else "OPEN", latest_audit_id=latest_id,
                       latest_decision=decision, history=history)
