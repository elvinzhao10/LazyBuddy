#!/usr/bin/env bash
# append-event.sh — Append a redacted event line to events.jsonl.
# Usage: append-event.sh <run_id> <event_type> [json_payload]
set -euo pipefail

RUN_ID="${1:-}"
EVENT_TYPE="${2:-}"
PAYLOAD="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$EVENT_TYPE" ]; then
    echo "Error: event_type is required" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"
CANONICAL_EVENTS_FILE="$STATE_RUN_DIR/canonical-events.jsonl"
EVENT_LOCK="$STATE_RUN_DIR/.events.lock"
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
state_require_safe_run_file "$CANONICAL_EVENTS_FILE" "canonical-events.jsonl" || exit 1
state_require_safe_run_file "$EVENT_LOCK" "event lock" || exit 1

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$NOW" "$RUN_ID" "$EVENT_TYPE" "$PAYLOAD" "$CANONICAL_EVENTS_FILE" "$EVENTS_FILE" "$EVENT_LOCK" <<'PYEOF'
import fcntl
import json
import os
import re
import sys
import uuid

now, run_id, event_type, payload_str, canonical_file, events_file, lock_file = sys.argv[1:]
id_pattern = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$')
event_pattern = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
if event_pattern.fullmatch(event_type) is None:
    raise SystemExit("Error: invalid event_type")

try:
    payload = json.loads(payload_str) if payload_str else {}
except json.JSONDecodeError as error:
    raise SystemExit(f"Error: malformed event payload: {error.msg}") from error
if not isinstance(payload, dict):
    raise SystemExit("Error: event payload must be an object")
reserved = {'ts', 'run_id', 'event', 'schema_version', 'event_payload'}
if reserved.intersection(payload):
    raise SystemExit("Error: event payload overrides canonical identity")

event_id = payload.pop('event_id', None)
if event_id is None:
    event_id = f"event:{run_id}:{uuid.uuid4().hex}"
if not isinstance(event_id, str) or id_pattern.fullmatch(event_id) is None:
    raise SystemExit("Error: invalid event_id")

encoded_payload = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
redacted_payload = re.sub(r'sk-[a-zA-Z0-9_-]{20,}', '***REDACTED_API_KEY***', encoded_payload)
redacted_payload = re.sub(r'Bearer\s+[a-zA-Z0-9._\-]{10,}', 'Bearer ***REDACTED***', redacted_payload)
redacted_payload = re.sub(r'(?i)\"password\"\s*:\s*\"[^\"]+\"', '\"password\":\"***REDACTED***\"', redacted_payload)
redacted_payload = re.sub(r'-----BEGIN [A-Z ]+ PRIVATE KEY-----.+?-----END [A-Z ]+ PRIVATE KEY-----', '***REDACTED_PRIVATE_KEY***', redacted_payload, flags=re.DOTALL)
safe_payload = json.loads(redacted_payload)

canonical = {
    'schema_version': 1,
    'event_id': event_id,
    'ts': now,
    'run_id': run_id,
    'event': event_type,
    'event_payload': safe_payload,
}

def records(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return []
    with os.fdopen(descriptor, encoding='utf-8') as handle:
        values = []
        for line in handle:
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise SystemExit(f"Error: malformed event ledger: {error.msg}") from error
            if not isinstance(value, dict):
                raise SystemExit("Error: event ledger record must be an object")
            values.append(value)
        return values

def append_record(path, value):
    descriptor = os.open(
        path,
        os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n')
        handle.flush()
        os.fsync(handle.fileno())

lock_descriptor = os.open(
    lock_file,
    os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
    0o600,
)
with os.fdopen(lock_descriptor, 'w', encoding='utf-8') as lock_handle:
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
    existing = next(
        (value for value in records(canonical_file) if value.get('event_id') == event_id),
        None,
    )
    if existing is None:
        append_record(canonical_file, canonical)
    else:
        comparable = dict(existing)
        comparable['ts'] = now
        if comparable != canonical:
            raise SystemExit("Error: event_id conflicts with canonical event")
        canonical = existing

    mirrored = {
        'ts': canonical['ts'],
        'run_id': run_id,
        'event': event_type,
        'event_id': event_id,
        **safe_payload,
    }
    if not any(value.get('event_id') == event_id for value in records(events_file)):
        append_record(events_file, mirrored)
PYEOF
