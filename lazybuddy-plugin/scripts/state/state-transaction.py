#!/usr/bin/env python3
"""CLI boundary for LazyBuddy run transactions."""

from __future__ import annotations

import json
import re
import sys
import uuid
from pathlib import Path
from typing import Dict, List, NamedTuple, Union

from state_transaction import TransactionError, Write, commit, commit_locked, locked, recover, recover_locked

EVENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")
EVENT_TYPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
JsonValue = Union[None, bool, int, float, str, List["JsonValue"], Dict[str, "JsonValue"]]
EventPayload = Dict[str, JsonValue]


class EventRequest(NamedTuple):
    run_dir: Path
    run_id: str
    event_type: str
    payload_text: str
    now: str


def redacted(value: EventPayload) -> EventPayload:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    encoded = re.sub(r"sk-[a-zA-Z0-9_-]{20,}", "***REDACTED_API_KEY***", encoded)
    encoded = re.sub(r"Bearer\s+[a-zA-Z0-9._\-]{10,}", "Bearer ***REDACTED***", encoded)
    encoded = re.sub(r'(?i)"password"\s*:\s*"[^"]+"', '"password":"***REDACTED***"', encoded)
    encoded = re.sub(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----.+?-----END [A-Z ]+ PRIVATE KEY-----", "***REDACTED_PRIVATE_KEY***", encoded, flags=re.DOTALL)
    return json.loads(encoded)


def ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    values = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise TransactionError(f"malformed event ledger: {error.msg}") from error
        if not isinstance(value, dict):
            raise TransactionError("event ledger record must be an object")
        values.append(value)
    return values


def encoded_ledger(values: list[dict]) -> bytes:
    return "".join(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n" for value in values).encode()


def append_event(request: EventRequest) -> None:
    run_dir, run_id, event_type, payload_text, now = request
    if EVENT_TYPE.fullmatch(event_type) is None:
        raise TransactionError("invalid event_type")
    try:
        payload = json.loads(payload_text) if payload_text else {}
    except json.JSONDecodeError as error:
        raise TransactionError(f"malformed event payload: {error.msg}") from error
    if not isinstance(payload, dict):
        raise TransactionError("event payload must be an object")
    if {"ts", "run_id", "event", "schema_version", "event_payload"}.intersection(payload):
        raise TransactionError("event payload overrides canonical identity")
    event_id = payload.pop("event_id", None)
    if event_id is None:
        event_id = f"event:{run_id}:{uuid.uuid4().hex}"
    if not isinstance(event_id, str) or EVENT_ID.fullmatch(event_id) is None:
        raise TransactionError("invalid event_id")
    safe_payload = redacted(payload)
    canonical = {
        "schema_version": 1,
        "event_id": event_id,
        "ts": now,
        "run_id": run_id,
        "event": event_type,
        "event_payload": safe_payload,
    }
    with locked(run_dir):
        recover_locked(run_dir)
        canonical_path = run_dir / "canonical-events.jsonl"
        events_path = run_dir / "events.jsonl"
        canonical_values = ledger(canonical_path)
        event_values = ledger(events_path)
        existing = next((value for value in canonical_values if value.get("event_id") == event_id), None)
        if existing is not None:
            comparable = dict(existing)
            comparable["ts"] = now
            if comparable != canonical:
                raise TransactionError("event_id conflicts with canonical event")
            canonical = existing
        else:
            canonical_values.append(canonical)
        mirrored = {"ts": canonical["ts"], "run_id": run_id, "event": event_type, "event_id": event_id, **safe_payload}
        mirror = next((value for value in event_values if value.get("event_id") == event_id), None)
        if mirror is not None and mirror != mirrored:
            raise TransactionError("event_id conflicts with mirrored event")
        if mirror is None:
            event_values.append(mirrored)
        if existing is None or mirror is None:
            commit_locked(run_dir, "append_event", (
                Write("canonical-events.jsonl", encoded_ledger(canonical_values)),
                Write("events.jsonl", encoded_ledger(event_values)),
            ))


def parse_write(value: str) -> Write:
    parts = value.split("|", 2)
    if len(parts) != 3:
        raise TransactionError("write must be relative-path|before-sha256|source-path")
    relative, expected, source = parts
    return Write(relative, Path(source).read_bytes(), expected)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        raise TransactionError("usage: state-transaction.py recover|commit|append-event RUN_DIR ...")
    command = argv[1]
    run_dir = Path(argv[2])
    if run_dir.is_symlink() or not run_dir.is_dir():
        raise TransactionError("run directory is unsafe or missing")
    if command == "recover" and len(argv) == 3:
        print(recover(run_dir))
        return 0
    if command == "commit" and len(argv) >= 5:
        operation = argv[3]
        writes = tuple(parse_write(value) for value in argv[4:])
        print(commit(run_dir, operation, writes))
        return 0
    if command == "append-event" and len(argv) == 7:
        append_event(EventRequest(run_dir, argv[3], argv[4], argv[5], argv[6]))
        return 0
    raise TransactionError("invalid transaction command")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except TransactionError as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
