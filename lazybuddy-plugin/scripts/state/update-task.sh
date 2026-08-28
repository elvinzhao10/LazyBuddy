#!/usr/bin/env bash
# update-task.sh — Update a task's status and optional fields atomically.
# Usage: update-task.sh <run_id> <task_id> <new_status> [key=value ...]
set -euo pipefail

RUN_ID="${1:-}"
TASK_ID="${2:-}"
NEW_STATUS="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$TASK_ID" ] || [ -z "$NEW_STATUS" ]; then
    echo "Usage: update-task.sh <run_id> <task_id> <new_status> [key=value ...]" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"
state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$STATE_RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$TMP_FILE" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$STATE_FILE" "$TMP_FILE" "$EVENTS_FILE" "$EVENTS_TMP" "$NOW" "$RUN_ID" "$TASK_ID" "$NEW_STATUS" "${@:4}" <<'PYEOF'
import json
import os
import sys

state_file, tmp_file, events_file, events_tmp, now, run_id, task_id, new_status, *extra_fields = sys.argv[1:]

d = json.load(open(state_file))
d['updated_at'] = now
tasks = d.get('tasks', [])
task = next((value for value in tasks if value['id'] == task_id), None)
if task is None:
    raise SystemExit(f"Error: task '{task_id}' not found in run '{run_id}'")
if new_status == 'done':
    statuses = {value['id']: value.get('status') for value in tasks}
    incomplete = [dependency for dependency in task.get('depends_on', []) if statuses.get(dependency) != 'done']
    if incomplete:
        raise SystemExit(f"Error: dependency {', '.join(incomplete)} must be done before task '{task_id}'")
task['status'] = new_status
for arg in extra_fields:
    if '=' in arg:
        key, value = arg.split('=', 1)
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            pass
        task[key] = value

with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'task_updated', 'task_id': task_id, 'status': new_status}
with open(events_tmp, 'w') as output:
    if os.path.exists(events_file):
        with open(events_file) as source:
            output.write(source.read())
    output.write(json.dumps(event) + '\n')
PYEOF

state_commit_transaction "$STATE_RUN_DIR" update_task \
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$TMP_FILE")" \
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"
