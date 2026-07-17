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

# Validate task exists
python3 - "$STATE_FILE" "$TASK_ID" <<'PYEOF'
import json
import sys
state_file, task_id = sys.argv[1:]
d = json.load(open(state_file))
tasks = d.get('tasks', [])
if not any(t['id'] == task_id for t in tasks):
    raise SystemExit(1)
PYEOF
if [ "$?" -ne 0 ]; then
    echo "Error: task '$TASK_ID' not found in run '$RUN_ID'" >&2
    exit 1
fi

# Atomic write: update in memory, write to tmp, rename
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$STATE_FILE" "$TMP_FILE" "$NOW" "$TASK_ID" "$NEW_STATUS" "${@:4}" <<'PYEOF'
import json, sys
state_file, tmp_file, now, task_id, new_status, *extra_fields = sys.argv[1:]

d = json.load(open(state_file))
d['updated_at'] = now

for task in d.get('tasks', []):
    if task['id'] == task_id:
        task['status'] = new_status
        for arg in extra_fields:
            if '=' in arg:
                k, v = arg.split('=', 1)
                try:
                    v = json.loads(v)
                except (json.JSONDecodeError, ValueError):
                    pass
                task[k] = v
        break

with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

mv "$TMP_FILE" "$STATE_FILE"

# Append event
python3 - "$NOW" "$RUN_ID" "$TASK_ID" "$NEW_STATUS" "$EVENTS_FILE" <<'PYEOF'
import json
import sys
now, run_id, task_id, new_status, events_file = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'task_updated', 'task_id': task_id, 'status': new_status}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF
