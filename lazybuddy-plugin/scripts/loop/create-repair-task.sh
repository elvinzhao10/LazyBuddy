#!/usr/bin/env bash
# create-repair-task.sh — Create a repair task based on failure classification.
# Usage: create-repair-task.sh <run_id> <failed_task_id> "<classification>"
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazybuddy/runs/$RUN_ID/state.json"
EVENTS_FILE="$CWD/.lazybuddy/runs/$RUN_ID/events.jsonl"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE="$STATE_FILE.tmp.$$"

case "$CLASSIFICATION" in
    retry)
        python3 -c "
import json, uuid
d = json.load(open('$STATE_FILE'))
failed = next((t for t in d['tasks'] if t['id'] == '$FAILED_TASK_ID'), None)
if not failed:
    raise SystemExit('Task not found')
new_id = 'R' + uuid.uuid4().hex[:5].upper()
new_task = {
    'id': new_id,
    'title': 'Retry: ' + failed.get('title',''),
    'description': failed.get('description',''),
    'owner': failed.get('owner','worker'),
    'status': 'queued',
    'depends_on': [],
    'repair_of': '$FAILED_TASK_ID'
}
d['tasks'].append(new_task)
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
print(new_id)
"
        mv "$TMP_FILE" "$STATE_FILE"
        ;;
    fallback)
        python3 -c "
import json, uuid
d = json.load(open('$STATE_FILE'))
failed = next((t for t in d['tasks'] if t['id'] == '$FAILED_TASK_ID'), None)
if not failed:
    raise SystemExit('Task not found')
new_id = 'F' + uuid.uuid4().hex[:5].upper()
new_task = {
    'id': new_id,
    'title': 'Fallback: ' + failed.get('title',''),
    'description': failed.get('description',''),
    'owner': failed.get('owner','worker'),
    'status': 'queued',
    'depends_on': [],
    'repair_of': '$FAILED_TASK_ID'
}
d['tasks'].append(new_task)
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
print(new_id)
"
        mv "$TMP_FILE" "$STATE_FILE"
        ;;
    ask-user)
        python3 -c "
import json
d = json.load(open('$STATE_FILE'))
d['status'] = 'blocked'
d.setdefault('blocker', {})
d['blocker']['reason'] = 'awaiting human decision on $FAILED_TASK_ID'
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
        mv "$TMP_FILE" "$STATE_FILE"
        ;;
    human-needed)
        python3 -c "
import json
d = json.load(open('$STATE_FILE'))
d['status'] = 'blocked'
d.setdefault('blocker', {})
d['blocker']['reason'] = 'task $FAILED_TASK_ID requires human intervention'
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
        mv "$TMP_FILE" "$STATE_FILE"
        ;;
    *)
        echo "Error: unknown classification '$CLASSIFICATION'" >&2
        exit 1
        ;;
esac

# Append repair_task_created event
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'repair_task_created', 'failed_task_id': '$FAILED_TASK_ID', 'classification': '$CLASSIFICATION'}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"
