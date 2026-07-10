#!/usr/bin/env bash
# create-repair-task.sh — Create a repair task based on failure classification.
# Usage: create-repair-task.sh <run_id> <failed_task_id> "<classification>"
set -euo pipefail

RUN_ID="${1:-}"
FAILED_TASK_ID="${2:-}"
CLASSIFICATION="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$FAILED_TASK_ID" ] || [ -z "$CLASSIFICATION" ]; then
    echo "Usage: create-repair-task.sh <run_id> <failed_task_id> <classification>" >&2
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

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")

case "$CLASSIFICATION" in
    retry|fallback|ask-user|human-needed) ;;
    *)
        echo "Error: unknown classification '$CLASSIFICATION'" >&2
        exit 1
        ;;
esac

python3 - "$STATE_FILE" "$TMP_FILE" "$NOW" "$FAILED_TASK_ID" "$CLASSIFICATION" <<'PYEOF'
import json
import sys
import uuid

state_file, tmp_file, now, failed_task_id, classification = sys.argv[1:]
state = json.load(open(state_file))

if classification in ('retry', 'fallback'):
    failed = next((task for task in state['tasks'] if task['id'] == failed_task_id), None)
    if not failed:
        raise SystemExit('Task not found')
    prefix = 'R' if classification == 'retry' else 'F'
    title = 'Retry: ' if classification == 'retry' else 'Fallback: '
    new_id = prefix + uuid.uuid4().hex[:5].upper()
    state['tasks'].append({
        'id': new_id,
        'title': title + failed.get('title', ''),
        'description': failed.get('description', ''),
        'owner': failed.get('owner', 'worker'),
        'status': 'queued',
        'depends_on': [],
        'repair_of': failed_task_id,
    })
    print(new_id)
else:
    state['status'] = 'blocked'
    state.setdefault('blocker', {})
    if classification == 'ask-user':
        state['blocker']['reason'] = 'awaiting human decision on ' + failed_task_id
    else:
        state['blocker']['reason'] = 'task ' + failed_task_id + ' requires human intervention'

state['updated_at'] = now
with open(tmp_file, 'w') as handle:
    json.dump(state, handle, indent=2)
PYEOF
mv "$TMP_FILE" "$STATE_FILE"

# Append repair_task_created event
python3 - "$NOW" "$RUN_ID" "$FAILED_TASK_ID" "$CLASSIFICATION" "$EVENTS_FILE" <<'PYEOF'
import json
import sys
now, run_id, failed_task_id, classification, events_file = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'repair_task_created', 'failed_task_id': failed_task_id, 'classification': classification}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF
