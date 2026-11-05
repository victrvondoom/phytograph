"""Insert the labelled SYNTHETIC demonstration batches. Idempotent: existing batch IDs are skipped.

These describe invented shipments. Every row carries data_origin='synthetic', which the UI shows as a
demonstration sample and the dossier states in its limitations.

    python -m vanasignal.origin.seed
"""

from __future__ import annotations

import argparse
from datetime import date

from pydantic import ValidationError

from ..config import get_settings
from .batches import BatchRepository, DuplicateBatchError
from .db import connect
from .schemas import BatchCreate

SAMPLES = [
    dict(batch_id="SYN-KL-001", supplier_name="Synthetic Supplier A (demo)", declared_botanical_name="Decalepis hamiltonii",
         plant_part="root", declared_country="India", declared_state="Kerala", declared_district="Wayanad (approximate)",
         latitude=11.6, longitude=76.0, collection_date=date(2025, 11, 12), collection_type="wild-harvested",
         supplier_batch_reference="SYN-REF-7781", document_references=["SYN-PERMIT-001"], data_origin="synthetic"),
    dict(batch_id="SYN-TN-002", supplier_name="Synthetic Supplier B (demo)", declared_botanical_name="Gymnema sylvestre",
         plant_part="leaf", declared_country="India", declared_state="Tamil Nadu", declared_district="Nilgiris (approximate)",
         latitude=11.4, longitude=76.7, collection_date=None, collection_type="unknown",
         supplier_batch_reference=None, document_references=[], data_origin="synthetic"),
    dict(batch_id="SYN-RJ-003", supplier_name="Synthetic Supplier C (demo)", declared_botanical_name="Withania somnifera",
         plant_part="root", declared_country="India", declared_state="Rajasthan", declared_district=None,
         latitude=26.9, longitude=75.8, collection_date=date(2025, 9, 1), collection_type="cultivated",
         supplier_batch_reference="SYN-REF-7790", document_references=[], data_origin="synthetic"),
]


def seed(db_path: str) -> dict[str, list[str]]:
    conn = connect(db_path)
    repo = BatchRepository(conn)
    result: dict[str, list[str]] = {"created": [], "skipped": []}
    for raw in SAMPLES:
        try:
            body = BatchCreate(**raw)
            repo.create(body)
            result["created"].append(body.batch_id)
        except DuplicateBatchError:
            result["skipped"].append(raw["batch_id"])
        except ValidationError as exc:  # samples must always be valid; fail loudly if not
            raise SystemExit(f"Sample {raw['batch_id']} is invalid: {exc}") from exc
    conn.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed labelled synthetic demonstration batches.")
    parser.add_argument("--db", default=str(get_settings().db_path))
    args = parser.parse_args()
    print(seed(args.db))


if __name__ == "__main__":
    main()
