#!/usr/bin/env bash
# create-run.sh — Initialize a new run with directory structure and state.json.
# Usage: create-run.sh <run_id> "<objective>"
set -euo pipefail

RUN_ID="${1:-}"
OBJECTIVE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$OBJECTIVE" ]; then
    echo "Error: objective is required" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_prepare_runs_dir "$CWD" || exit 1
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
RUN_DIR="$STATE_RUN_DIR"

mkdir -p "$RUN_DIR"/{evidence,verification,review,agent_outputs,artifacts,memory_updates}
state_prepare_safe_run_directory "$RUN_DIR/checkpoints" "checkpoints directory" || exit 1
STATE_FILE="$RUN_DIR/state.json"
EVENTS_FILE="$RUN_DIR/events.jsonl"
state_require_safe_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATE_TMP=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$STATE_TMP" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT

python3 - "$RUN_ID" "$NOW" "$OBJECTIVE" "$STATE_TMP" "$EVENTS_TMP" <<'PYEOF'
import json, sys
run_id, now, objective, state_file, events_file = sys.argv[1:]
state = {
    'schema_version': '2',
    'run_id': run_id,
    'created_at': now,
    'updated_at': now,
    'objective': objective,
    'status': 'created',
    'plan_reference': '',
    'tasks': [],
    'progress': {'total_checkboxes': 0, 'completed_checkboxes': 0},
    'verification_gates': [],
    'review_status': 'not_started',
    'iteration': {'count': 0, 'max': 500, 'mode': 'normal'},
    'last_checkpoint': None,
    'budget': {'max_tokens': None, 'max_cost_usd': None},
    'session_ids': [],
    'runtime_fingerprints': []
}
with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'run_created', 'objective': objective}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF

state_commit_transaction "$RUN_DIR" create_run \
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$STATE_TMP")" \
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"

echo "$RUN_DIR"
