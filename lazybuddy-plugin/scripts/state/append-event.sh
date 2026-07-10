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
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$NOW" "$RUN_ID" "$EVENT_TYPE" "$PAYLOAD" "$EVENTS_FILE" <<'PYEOF'
import json, sys, re
now, run_id, event_type, payload_str, events_file = sys.argv[1:]

base = {'ts': now, 'run_id': run_id, 'event': event_type}

if payload_str:
    try:
        payload = json.loads(payload_str)
        base.update(payload)
    except (json.JSONDecodeError, ValueError):
        pass

# Redact secrets before writing
raw = json.dumps(base)
redacted = re.sub(r'sk-[a-zA-Z0-9_-]{20,}', '***REDACTED_API_KEY***', raw)
redacted = re.sub(r'Bearer\s+[a-zA-Z0-9._\-]{10,}', 'Bearer ***REDACTED***', redacted)
redacted = re.sub(r'(?i)\"password\"\s*:\s*\"[^\"]+\"', '\"password\": \"***REDACTED***\"', redacted)
redacted = re.sub(r'-----BEGIN [A-Z ]+ PRIVATE KEY-----.+?-----END [A-Z ]+ PRIVATE KEY-----', '***REDACTED_PRIVATE_KEY***', redacted, flags=re.DOTALL)

with open(events_file, 'a') as f:
    f.write(redacted + '\n')
PYEOF
