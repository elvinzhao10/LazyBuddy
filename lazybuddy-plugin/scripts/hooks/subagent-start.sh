#!/usr/bin/env bash
# subagent-start.sh — SubagentStart hook: record subagent lifecycle start in events.jsonl.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/subagent-start.json
# Always exits 0.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

AGENT_TYPE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent_type_name',''))" 2>/dev/null || echo "")
AGENT_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent_id',''))" 2>/dev/null || echo "")
TASK=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task', d.get('prompt',''))[:200])" 2>/dev/null || echo "")

if [ -z "$AGENT_TYPE" ]; then exit 0; fi

RUNS_DIR="$CWD/.lazybuddy/runs"
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
    'event': 'subagent_start',
    'agent_type': '$AGENT_TYPE',
    'agent_id': '$AGENT_ID',
    'task': '''$TASK''',
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
