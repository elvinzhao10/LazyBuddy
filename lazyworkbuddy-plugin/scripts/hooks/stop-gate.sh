#!/usr/bin/env bash
# stop-gate.sh — Stop hook: prevent premature completion when active run has unchecked work.
# LazyCodex source: reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts
# Traces to: reference/lazycodex/plugins/omo/components/start-work-continuation/src/boulder-reader.ts
set -euo pipefail

# Read JSON payload from stdin
INPUT=$(cat)

# --- Context pressure detection ---
# If the transcript contains context pressure markers, pass through gracefully.
# LazyCodex source: start-work-continuation/src/codex-hook.ts lines 52-60
CONTEXT_PRESSURE_MARKERS=("context compacted" "context_length_exceeded" "skill descriptions were shortened" "context_too_large" "codex ran out of room in the model's context window")
for marker in "${CONTEXT_PRESSURE_MARKERS[@]}"; do
    if echo "$INPUT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null | grep -qi "$marker"; then
        exit 0
    fi
done

# --- Stop hook active guard ---
# If stop_hook_active is true, don't re-block (prevents infinite loops).
# LazyCodex source: start-work-continuation/src/codex-hook.ts line 8
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
# Look for .lazyworkbuddy/runs/ directories with active state
RUNS_DIR="$CWD/.lazyworkbuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then
    exit 0  # No runs directory — nothing to block
fi

ACTIVE_RUN=""
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
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

# Count unchecked checkboxes in ## TODOs and ## Final Verification Wave sections
# LazyCodex source: boulder-reader.ts lines 76-104 (parsePlanChecklist)
UNCHECKED=$(python3 -c "
import sys
with open('$PLAN_PATH') as f:
    lines = f.readlines()

headings_to_count = {'TODOs', 'Final Verification Wave'}
in_section = not any(l.strip().startswith('## ') and l.strip()[3:] in headings_to_count for l in lines)
remaining = 0
next_task = None

for line in lines:
    stripped = line.strip()
    if stripped.startswith('## '):
        heading = stripped[3:]
        in_section = heading in headings_to_count
        continue
    if not in_section:
        continue
    if stripped.startswith('- [ ] '):
        remaining += 1
        if next_task is None:
            next_task = stripped[6:]
            if len(next_task) > 80:
                next_task = next_task[:77] + '...'

if remaining > 0:
    print(f'{remaining} {next_task}')
else:
    print('0')
" 2>/dev/null || echo "0")

if [ "$UNCHECKED" = "0" ]; then
    exit 0  # All checkboxes done — allow stop
fi

REMAINING=$(echo "$UNCHECKED" | awk '{print $1}')
NEXT_TASK=$(echo "$UNCHECKED" | cut -d' ' -f2-)

PLAN_NAME=$(basename "$PLAN_PATH" .md)

# --- Block stop with continuation directive ---
# LazyCodex source: start-work-continuation/src/codex-hook.ts lines 12-15
cat << EOF
{"decision":"block","reason":"Lazyworkbuddy has ${REMAINING} unfinished task(s) in plan \`${PLAN_NAME}\`. Next: ${NEXT_TASK}\n\nRun /start-work ${PLAN_NAME} to continue. Stay in this session — the Stop hook will re-inject the orchestrator on the next turn."}
EOF
exit 0
