#!/usr/bin/env bash
# post-tool-use-failure.sh — PostToolUseFailure hook: append failure event + suggest retry/fallback/blocker.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/post-tool-use-failure.json
# Always exits 0.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

# Extract error info
ERROR_MSG=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',''); print(e[:200])" 2>/dev/null || echo "")
ERROR_TYPE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error_type',''))" 2>/dev/null || echo "")

# Classify error and suggest recovery
if echo "$ERROR_MSG" | grep -qiE 'permission denied|EACCES|not permitted'; then
    SUGGESTION="ask-user: request elevated permissions or alternate path"
elif echo "$ERROR_MSG" | grep -qiE 'timeout|timed out|ETIMEDOUT'; then
    SUGGESTION="retry: operation may succeed with increased timeout or network recovery"
elif echo "$ERROR_MSG" | grep -qiE 'not found|ENOENT|no such file|404'; then
    SUGGESTION="fallback: resource not found — verify path/URL exists or use alternative"
elif echo "$ERROR_MSG" | grep -qiE 'out of memory|OOM|killed'; then
    SUGGESTION="blocker: resource exhausted — reduce scope or increase limits"
else
    SUGGESTION="review: generic failure — check error details and retry or escalate"
fi

# Find active run and append event
RUNS_DIR="$CWD/.lazybuddy/runs"
if [ -d "$RUNS_DIR" ]; then
    for run_dir in "$RUNS_DIR"/*/; do
        state_file="${run_dir}state.json"
        if [ -f "$state_file" ]; then
            STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
            if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
                python3 -c "
import json, datetime, os
event = {
    'tool': '$TOOL_NAME',
    'status': 'failure',
    'error': '''$ERROR_MSG''',
    'suggestion': '$SUGGESTION',
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
fi

exit 0
