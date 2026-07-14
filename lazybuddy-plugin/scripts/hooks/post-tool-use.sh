#!/usr/bin/env bash
# post-tool-use.sh — PostToolUse hook: append tool-use summary to active run's events.jsonl.
# Redacts secrets, records changed files and artifact paths. Always exits 0.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

RUNS_DIR="$CWD/.lazybuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then exit 0; fi

# Find active run
ACTIVE_RUN=""
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
            ACTIVE_RUN="$run_dir"
            break
        fi
    fi
done

if [ -z "$ACTIVE_RUN" ]; then exit 0; fi

RUN_ID=$(basename "$ACTIVE_RUN")
EVENTS_FILE="$ACTIVE_RUN/events.jsonl"

# Build event line with python3
python3 -c "
import json, datetime, os, sys

event = {'tool': '$TOOL_NAME', 'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'}

# Extract changed file paths from Write/Edit tool_input
try:
    d = json.loads(sys.stdin.buffer.read().decode())
    ti = d.get('tool_input', {})
except:
    ti = {}

if '$TOOL_NAME' in ('Write', 'Edit'):
    fp = ti.get('file_path', '')
    if fp:
        event['files'] = [fp]
        # G-016: flag writes outside .lazybuddy/ as boundary warnings.
        # The orchestrator may only write .lazybuddy/ state; product-code
        # writes must come from the implementer. PreToolUse cannot block this
        # (it cannot tell which agent is calling), so we make it AUDITABLE here:
        # the reviewer/gate-reviewer checks events.jsonl for boundary_warnings.
        norm = fp.replace(chr(92), '/')
        if '.lazybuddy/' not in norm and '/.workbuddy/' not in norm and not norm.endswith('workbuddy.md') and not norm.endswith('AGENTS.md'):
            event['boundary_warning'] = 'write outside .lazybuddy/ - verify caller is implementer not orchestrator (G-016)'
elif '$TOOL_NAME' == 'Bash':
    # Redact secrets in bash commands
    cmd = ti.get('command', ti.get('description', ''))
    for secret in ['sk-', 'Bearer ', 'ghp_', 'gho_', 'ghs_', 'ghr_', 'ghu_', '--api-key', '--token']:
        cmd = cmd.replace(secret, '[REDACTED]')
    event['description'] = cmd[:200]

os.makedirs('$ACTIVE_RUN', exist_ok=True)
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event, default=str) + '\n')
" <<< "$INPUT" 2>/dev/null || true

exit 0
