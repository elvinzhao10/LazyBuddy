#!/usr/bin/env bash
# append-event.sh — Append a redacted event line to events.jsonl.
# Usage: append-event.sh <run_id> <event_type> [json_payload]
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
EVENTS_FILE="$CWD/.lazybuddy/runs/$RUN_ID/events.jsonl"
mkdir -p "$(dirname "$EVENTS_FILE")"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 -c "
import json, sys, re

base = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': '$EVENT_TYPE'}

# Merge payload if provided
payload_str = sys.argv[1] if len(sys.argv) > 1 else ''
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

with open('$EVENTS_FILE', 'a') as f:
    f.write(redacted + '\n')
" "$PAYLOAD"
