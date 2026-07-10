#!/usr/bin/env bash
# session-start.sh — SessionStart hook: detect active run, load summary, warn if memory missing.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json
set -euo pipefail

INPUT=$(cat 2>/dev/null || echo "{}")
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd','.'))" 2>/dev/null || echo ".")

echo "(LazyBuddy v0.6): Session starting — checking project state..."

# Bootstrap the .lazybuddy/ directory tree so skills/agents that read
# plans/, context/, drafts/, or runs/ don't crash on a fresh workspace.
# create-run.sh creates runs/<run_id>/ on demand; this ensures the parents exist.
mkdir -p "$CWD/.lazybuddy"/{plans,context,drafts,runs}

# Check for project memory
if [ -f "$CWD/workbuddy.md" ]; then
    echo "(LazyBuddy): Project memory found (workbuddy.md)."
else
    echo "(LazyBuddy): ⚠ Project memory (workbuddy.md) missing. Run /lazy-init-deep to generate it."
fi

# Check for project rules
if [ -d "$CWD/.workbuddy/rules" ] && [ "$(ls -A "$CWD/.workbuddy/rules"/*.md 2>/dev/null)" ]; then
    echo "(LazyBuddy): Project rules loaded."
fi

# Check for active run
RUNS_DIR="$CWD/.lazybuddy/runs"
if [ -d "$RUNS_DIR" ]; then
    for run_dir in "$RUNS_DIR"/*/; do
        state_file="${run_dir}state.json"
        if [ -f "$state_file" ]; then
            STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
            if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
                PLAN=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('plan_name',''))" 2>/dev/null || echo "unknown")
                PROGRESS=$(python3 -c "import json; d=json.load(open('$state_file')); p=d.get('progress',{}); print(f\"{p.get('completed_checkboxes',p.get('completed',0))}/{p.get('total_checkboxes',p.get('total',0))}\")" 2>/dev/null || echo "?/?")
                echo "(LazyBuddy): Active run found: $PLAN (status: $STATUS, progress: $PROGRESS)"
                echo "(LazyBuddy): Run /lazy-start-work to continue."
            fi
            break
        fi
    done
fi

exit 0
