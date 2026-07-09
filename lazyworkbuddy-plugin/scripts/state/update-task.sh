#!/usr/bin/env bash
# update-task.sh — Update a task's status and optional fields atomically.
# Usage: update-task.sh <run_id> <task_id> <new_status> [key=value ...]
set -euo pipefail

RUN_ID="${1:-}"
TASK_ID="${2:-}"
NEW_STATUS="${3:-}"
shift 3 2>/dev/null || true

if [ -z "$RUN_ID" ] || [ -z "$TASK_ID" ] || [ -z "$NEW_STATUS" ]; then
    echo "Usage: update-task.sh <run_id> <task_id> <new_status> [key=value ...]" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/state.json"
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Validate task exists
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
tasks = d.get('tasks', [])
if not any(t['id'] == '$TASK_ID' for t in tasks):
    raise SystemExit(1)
" || { echo "Error: task '$TASK_ID' not found in run '$RUN_ID'" >&2; exit 1; }

# Atomic write: update in memory, write to tmp, rename
TMP_FILE="$STATE_FILE.tmp.$$"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 -c "
import json, sys

d = json.load(open('$STATE_FILE'))
d['updated_at'] = '$NOW'

for task in d.get('tasks', []):
    if task['id'] == '$TASK_ID':
        task['status'] = '$NEW_STATUS'
        # Apply additional key=value pairs
        for arg in sys.argv[1:]:
            if '=' in arg:
                k, v = arg.split('=', 1)
                try:
                    v = json.loads(v)
                except (json.JSONDecodeError, ValueError):
                    pass
                task[k] = v
        break

with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
" "$@"

mv "$TMP_FILE" "$STATE_FILE"

# Append event
EVENTS_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/events.jsonl"
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'task_updated', 'task_id': '$TASK_ID', 'status': '$NEW_STATUS'}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"
