"""Preserve evidence bytes with explicit unsupported legacy-reference records."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by dashboard-bridge.py.
from __future__ import annotations

import json

from dashboard_files import Files, Json, LIMIT, encoded
from state_transaction import TransactionError, Write, sha256_bytes


def preserve(files: Files, state: dict[str, Json], prefix: str) -> list[Write]:
    references = []
    for task in state.get("tasks", []):
        references.extend(task.get("evidence", []))
    for submission in state.get("evidence_submissions", []):
        references.append(submission.get("evidence"))
    events = files.read("canonical-events.jsonl")
    for line in events.splitlines():
        event = json.loads(line)
        if event.get("event") == "attempt_result":
            references.extend(event.get("event_payload", {}).get("evidence", []))
    writes = [files.immutable(prefix + "/canonical-events.jsonl", events)]
    if len(references) > 1000:
        raise TransactionError("too many evidence references for one transaction")
    inventory = []
    total = 0
    for index, reference in enumerate(references):
        path = reference.get("path") if isinstance(reference, dict) else reference
        if not isinstance(path, str):
            inventory.append({"reference": reference, "status": "unsupported"})
            continue
        try:
            content = files.evidence(path)
        except (TransactionError, OSError) as error:
            inventory.append({"reference": reference, "status": "corrupt", "reason": str(error)})
            continue
        archived = prefix + f"/artifacts/{index}"
        total += len(content)
        if total > LIMIT:
            raise TransactionError("historical evidence exceeds transaction budget")
        writes.append(files.immutable(archived, content))
        inventory.append({"reference": reference, "status": "preserved", "path": archived, "sha256": sha256_bytes(content)})
    writes.append(files.immutable(prefix + "/evidence.json", encoded(inventory)))
    return writes
