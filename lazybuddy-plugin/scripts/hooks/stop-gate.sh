#!/usr/bin/env bash
# stop-gate.sh — Stop hook: prevent premature completion when active run has unchecked work.
set -euo pipefail

# Read JSON payload from stdin
INPUT=$(cat)

# --- Context pressure detection ---
# If the transcript contains context pressure markers, pass through gracefully.
CONTEXT_PRESSURE_MARKERS=("context compacted" "context_length_exceeded" "skill descriptions were shortened" "context_too_large" "codex ran out of room in the model's context window")
for marker in "${CONTEXT_PRESSURE_MARKERS[@]}"; do
    if echo "$INPUT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null | grep -qi "$marker"; then
        exit 0
    fi
done

# --- Stop hook active guard ---
# If stop_hook_active is true, don't re-block (prevents infinite loops).
STOP_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active',''))" 2>/dev/null || echo "")
if [ "$STOP_ACTIVE" = "True" ] || [ "$STOP_ACTIVE" = "true" ]; then
    exit 0
fi

# --- Determine workspace root ---
# Prefer CODEBUDDY_PLUGIN_ROOT-relative or fall back to cwd from payload
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then
    CWD="$PWD"
fi

# --- Find active run ---
# Look for .lazybuddy/runs/ directories with active state
RUNS_DIR="$CWD/.lazybuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then
    exit 0  # No runs directory — nothing to block
fi

ACTIVE_RUN=""
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ] || [ "$STATUS" = "executing" ] || [ "$STATUS" = "verifying" ] || [ "$STATUS" = "reviewing" ] || [ "$STATUS" = "blocked" ] || [ "$STATUS" = "created" ] || [ "$STATUS" = "planning" ]; then
            ACTIVE_RUN="$run_dir"
            ACTIVE_STATE="$state_file"
            break
        fi
    fi
done

if [ -z "$ACTIVE_RUN" ]; then
    exit 0  # No active run — allow stop
fi

# --- Parse plan for unchecked checkboxes ---
PLAN_REF=$(python3 -c "import json; d=json.load(open('$ACTIVE_STATE')); print(d.get('plan_reference',''))" 2>/dev/null || echo "")
if [ -z "$PLAN_REF" ]; then
    exit 0  # No plan reference — allow stop
fi

# Resolve plan path relative to CWD
if [[ "$PLAN_REF" == /* ]]; then
    PLAN_PATH="$PLAN_REF"
else
    PLAN_PATH="$CWD/$PLAN_REF"
fi

if [ ! -f "$PLAN_PATH" ]; then
    exit 0  # Plan file missing — allow stop
fi

# Count top-level work outside fenced examples in supported plan sections.
UNCHECKED=$(python3 - "$PLAN_PATH" <<'PY' 2>/dev/null
import re
import sys
with open(sys.argv[1]) as handle:
    lines = handle.readlines()
headings_to_count = {'TODOs', 'Todos', 'Final Verification Wave'}
in_section = False
fence = None
unchecked = []
for line in lines:
    stripped = line.strip()
    marker = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
    if marker:
        token = marker.group(1)
        if fence is None:
            fence = token
        elif token[0] == fence[0] and len(token) >= len(fence) and stripped == token:
            fence = None
        continue
    if fence is not None:
        continue
    if stripped.startswith('## '):
        in_section = stripped[3:].strip() in headings_to_count
        continue
    if not in_section:
        continue
    checkbox = re.match(r'^-\s+\[ \]\s+(.+)$', line.rstrip())
    if checkbox:
        unchecked.append(checkbox.group(1))
if unchecked:
    title = unchecked[0]
    print(f"{len(unchecked)} {title[:77] + '...' if len(title) > 80 else title}")
else:
    print('0')
PY
) || UNCHECKED=0

if [ "$UNCHECKED" = "0" ]; then
    exit 0  # All checkboxes done — allow stop
fi

REMAINING=$(echo "$UNCHECKED" | awk '{print $1}')
NEXT_TASK=$(echo "$UNCHECKED" | cut -d' ' -f2-)

PLAN_NAME=$(basename "$PLAN_PATH" .md)

# --- Block stop with continuation directive ---
# Correct WorkBuddy contract (per docs/cli/hooks): {"continue":false,"reason":"..."} + exit 0
# prevents the stop and surfaces the reason to the Agent, continuing the conversation.
# NOTE: {"decision":"block"} is DEPRECATED and does NOT block with exit 0.
python3 -c "
import json, sys
remaining, plan_name, next_task = sys.argv[1], sys.argv[2], sys.argv[3]
reason = (
    f'LazyBuddy has {remaining} unfinished task(s) in plan \`{plan_name}\`. Next: {next_task}\n\n'
    f'Run /lazy-start-work {plan_name} to continue. Stay in this session — the Stop hook will re-inject the orchestrator on the next turn.'
)
print(json.dumps({'continue': False, 'reason': reason}))
" "$REMAINING" "$PLAN_NAME" "$NEXT_TASK"
exit 0
