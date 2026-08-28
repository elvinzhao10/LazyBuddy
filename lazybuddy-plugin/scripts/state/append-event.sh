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
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
state_require_safe_run_file "$CANONICAL_EVENTS_FILE" "canonical-events.jsonl" || exit 1

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 "$SCRIPT_DIR/state-transaction.py" append-event "$STATE_RUN_DIR" "$RUN_ID" "$EVENT_TYPE" "$PAYLOAD" "$NOW"
