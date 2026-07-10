#!/usr/bin/env bash
# stop-failure.sh — StopFailure hook: record failure + output recovery suggestion.
# LazyCodex source: reference/lazycodex/plugins/omo/hooks/stop-failure.json
# Informational only — always exits 0.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

RUNS_DIR="$CWD/.lazyworkbuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then
    echo "[Lazyworkbuddy] No active runs found. Run /lazy-start-work to begin a new task."
    exit 0
fi

# Find active run
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
            # Write failure record to events.jsonl
            python3 -c "
import json, datetime, os
event = {
    'event': 'stop_failure',
    'reason': 'Session ended with active run still in progress',
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'
}
os.makedirs('${run_dir}', exist_ok=True)
with open('${run_dir}events.jsonl', 'a') as f:
    f.write(json.dumps(event, default=str) + '\n')
" 2>/dev/null

            PLAN=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('plan_name',''))" 2>/dev/null || echo "")
            if [ -n "$PLAN" ]; then
                echo "[Lazyworkbuddy] Run /lazy-start-work $PLAN to resume from last checkpoint."
            else
                echo "[Lazyworkbuddy] Run /lazy-start-work to resume from last checkpoint."
            fi
            exit 0
        fi
    fi
done

echo "[Lazyworkbuddy] Run /lazy-start-work to resume from last checkpoint."
exit 0
