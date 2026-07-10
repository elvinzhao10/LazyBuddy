#!/usr/bin/env bash
# run-cycle.sh — Run ONE loop iteration.
# Usage: run-cycle.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
RUN_DIR="$CWD/.lazybuddy/runs/$RUN_ID"
STATE_FILE="$RUN_DIR/state.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$STATE_FILE" ]; then
    echo '{"status":"error","reason":"state.json not found"}' >&2
    exit 1
fi

# Try to get next task
TASK_JSON=$("$SCRIPT_DIR/next-task.sh" "$RUN_ID" 2>/dev/null) || {
    echo '{"status":"complete"}'
    exit 0
}

TASK_ID=$(python3 -c "import json,sys; print(json.loads('''$TASK_JSON''')['id'])")

# Update run status to executing if not already
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE="$STATE_FILE.tmp.$$"
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
if d.get('status') not in ('executing',):
    d['status'] = 'executing'
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
mv "$TMP_FILE" "$STATE_FILE"

# Increment iteration count
TMP_FILE="$STATE_FILE.tmp.$$"
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
it = d.setdefault('iteration', {})
it['count'] = it.get('count', 0) + 1
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
mv "$TMP_FILE" "$STATE_FILE"

# Checkpoint every 5 iterations
ITER_COUNT=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d['iteration']['count'])")
if [ $((ITER_COUNT % 5)) -eq 0 ]; then
    CHECKPOINT_SCRIPT="$CWD/lazybuddy-plugin/scripts/state/checkpoint.sh"
    if [ -x "$CHECKPOINT_SCRIPT" ]; then
        "$CHECKPOINT_SCRIPT" "$RUN_ID" >/dev/null
    fi
fi

python3 -c "
import json
print(json.dumps({'status':'continue','task':json.loads('''$TASK_JSON''')}))
"
