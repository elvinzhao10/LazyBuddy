#!/usr/bin/env bash
# classify-failure.sh — Classify a task failure and record it.
# Usage: classify-failure.sh <run_id> <task_id> "<error_message>"
set -euo pipefail

RUN_ID="${1:-}"
TASK_ID="${2:-}"
ERROR_MSG="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$TASK_ID" ] || [ -z "$ERROR_MSG" ]; then
    echo "Usage: classify-failure.sh <run_id> <task_id> <error_message>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"

state_require_safe_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Classify: check error message against known patterns (case-insensitive)
ERROR_LOWER=$(python3 - "$ERROR_MSG" <<'PYEOF'
import sys
print(sys.argv[1].lower())
PYEOF
)
CLASSIFICATION="human-needed"

if python3 - "$ERROR_LOWER" <<'PYEOF'
import sys
msg = sys.argv[1]
if any(kw in msg for kw in ('permission denied','access denied','eacces','forbidden','unauthorized')):
    raise SystemExit(10)
if any(kw in msg for kw in ('timeout','timed out','connection refused','econnrefused','etimedout')):
    raise SystemExit(20)
if any(kw in msg for kw in ('not found','does not exist','enoent','no such file','missing')):
    raise SystemExit(30)
PYEOF
then
    :
else
    case $? in
        10) CLASSIFICATION="ask-user" ;;
        20) CLASSIFICATION="retry" ;;
        30) CLASSIFICATION="fallback" ;;
    esac
fi

# Set task status to failed
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$STATE_RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$TMP_FILE" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT
python3 - "$STATE_FILE" "$TMP_FILE" "$EVENTS_FILE" "$EVENTS_TMP" "$RUN_ID" "$TASK_ID" "$CLASSIFICATION" "$ERROR_MSG" "$NOW" <<'PYEOF'
import json
import os
import sys
state_file, tmp_file, events_file, events_tmp, run_id, task_id, classification, error_msg, now = sys.argv[1:]
d = json.load(open(state_file))
task = next((value for value in d.get('tasks', []) if value['id'] == task_id), None)
if task is None:
    raise SystemExit(f"Error: task '{task_id}' not found in run '{run_id}'")
task['status'] = 'failed'
task['classification'] = classification
task['error'] = error_msg
d['updated_at'] = now
with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'task_failed', 'task_id': task_id, 'classification': classification, 'error': error_msg}
with open(events_tmp, 'w') as output:
    if os.path.exists(events_file):
        with open(events_file) as source:
            output.write(source.read())
    output.write(json.dumps(event) + '\n')
PYEOF

state_commit_transaction "$STATE_RUN_DIR" classify_failure \
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$TMP_FILE")" \
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"

echo "$CLASSIFICATION"
