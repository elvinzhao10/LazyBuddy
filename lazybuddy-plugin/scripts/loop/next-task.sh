#!/usr/bin/env bash
# next-task.sh — Find the next queued task whose dependencies are all "done".
# Usage: next-task.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazybuddy/runs/$RUN_ID/state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo '{"error":"state.json not found"}' >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE="$STATE_FILE.tmp.$$"

RESULT=$(python3 -c "
import json

d = json.load(open('$STATE_FILE'))
tasks = d.get('tasks', [])
done_ids = {t['id'] for t in tasks if t.get('status') == 'done'}

for t in tasks:
    if t.get('status') != 'queued':
        continue
    deps = set(t.get('depends_on', []))
    if deps.issubset(done_ids):
        t['status'] = 'running'
        d['updated_at'] = '$NOW'
        with open('$TMP_FILE', 'w') as f:
            json.dump(d, f, indent=2)
        print(json.dumps(t))
        raise SystemExit(0)

raise SystemExit(1)
" 2>&1) || {
    # No task found — check if it's because all are done or blocked
    REASON=$(python3 -c "
import json
d = json.load(open('$STATE_FILE'))
tasks = d.get('tasks', [])
queued = [t for t in tasks if t.get('status') == 'queued']
running = [t for t in tasks if t.get('status') == 'running']
if queued:
    print('blocked')
elif running:
    print('running')
elif all(t.get('status') in ('done','failed','skipped') for t in tasks):
    print('all_done')
else:
    print('no_tasks')
")
    if [ "$REASON" = "all_done" ] || [ "$REASON" = "no_tasks" ]; then
        echo '{"status":"no_more_tasks"}' >&2
        exit 1
    else
        echo '{"status":"blocked","reason":"'$REASON'"}' >&2
        exit 1
    fi
}

mv "$TMP_FILE" "$STATE_FILE"
echo "$RESULT"
