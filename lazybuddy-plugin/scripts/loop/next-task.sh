#!/usr/bin/env bash
# next-task.sh — Find the next queued task whose dependencies are all "done".
# Usage: next-task.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"

state_require_safe_run_file "$STATE_FILE" "state.json" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo '{"error":"state.json not found"}' >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")

RESULT=$(python3 - "$STATE_FILE" "$NOW" "$TMP_FILE" 2>&1 <<'PY'
import json
import sys

state_file, now, tmp_file = sys.argv[1:]
d = json.load(open(state_file))
tasks = d.get('tasks', [])
done_ids = {t['id'] for t in tasks if t.get('status') == 'done'}

for t in tasks:
    if t.get('status') != 'queued':
        continue
    deps = set(t.get('depends_on', []))
    if deps.issubset(done_ids):
        t['status'] = 'running'
        d['updated_at'] = now
        with open(tmp_file, 'w') as f:
            json.dump(d, f, indent=2)
        print(json.dumps(t))
        raise SystemExit(0)

raise SystemExit(1)
PY
) || {
    rm -f "$TMP_FILE"
    # No task found — check if it's because all are done or blocked
    REASON=$(python3 - "$STATE_FILE" <<'PY'
import json
import sys

d = json.load(open(sys.argv[1]))
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
PY
)
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
