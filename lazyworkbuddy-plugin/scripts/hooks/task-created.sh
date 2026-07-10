#!/usr/bin/env bash
# task-created.sh — TaskCreated hook: mirror task creation into active run's events.jsonl.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/task-created.json
# Always exits 0.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

TASK_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null || echo "")
TASK_SUBJECT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_subject', d.get('subject','')))" 2>/dev/null || echo "")

if [ -z "$TASK_ID" ]; then exit 0; fi

RUNS_DIR="$CWD/.lazyworkbuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then exit 0; fi

# Find active run
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
            python3 -c "
import json, datetime, os
event = {
    'event': 'task_created',
    'task_id': '$TASK_ID',
    'subject': '''$TASK_SUBJECT''',
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'
}
os.makedirs('${run_dir}', exist_ok=True)
with open('${run_dir}events.jsonl', 'a') as f:
    f.write(json.dumps(event, default=str) + '\n')
" 2>/dev/null
            break
        fi
    fi
done

exit 0
