#!/usr/bin/env bash
# create-run.sh — Initialize a new run with directory structure and state.json.
# Usage: create-run.sh <run_id> "<objective>"
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
RUNS_DIR="$CWD/.lazybuddy/runs"
RUN_DIR="$RUNS_DIR/$RUN_ID"

mkdir -p "$RUN_DIR"/{evidence,checkpoints,verification,review,agent_outputs,artifacts,memory_updates}

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 -c "
import json, sys
state = {
    'schema_version': '2',
    'run_id': '$RUN_ID',
    'created_at': '$NOW',
    'updated_at': '$NOW',
    'objective': '''$OBJECTIVE''',
    'status': 'created',
    'plan_reference': '',
    'tasks': [],
    'progress': {'total_checkboxes': 0, 'completed_checkboxes': 0},
    'verification_gates': [],
    'review_status': 'not_started',
    'iteration': {'count': 0, 'max': 500, 'mode': 'normal'},
    'last_checkpoint': None,
    'budget': {'max_tokens': None, 'max_cost_usd': None},
    'session_ids': []
}
with open('$RUN_DIR/state.json', 'w') as f:
    json.dump(state, f, indent=2)
"

# Append run_created event
EVENTS_FILE="$RUN_DIR/events.jsonl"
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'run_created', 'objective': '''$OBJECTIVE'''}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"

echo "$RUN_DIR"
