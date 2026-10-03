#!/usr/bin/env bash
# session-start.sh — SessionStart hook: detect active run, load summary, warn if memory missing.
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/bounded-input.bash"
hook_read_input || exit 0
CWD=$(cat "$HOOK_INPUT_FILE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd','.'))" 2>/dev/null || echo ".")
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "(LazyBuddy v1.3.5): Session starting — checking project state..."

if [ ! -d "$PLUGIN_ROOT" ] || [ ! -x "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh" ]; then
    echo "SESSIONSTART_READINESS=failed reason=plugin-root-unavailable" >&2
    exit 1
fi

# Bootstrap the .lazybuddy/ directory tree so skills/agents that read
# plans/, context/, drafts/, or runs/ don't crash on a fresh workspace.
# create-run.sh creates runs/<run_id>/ on demand; this ensures the parents exist.
mkdir -p "$CWD/.lazybuddy"/{plans,context,drafts,runs}

if load_check=$(bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh" 2>&1); then
    echo "$load_check"
    if grep -q '^PACKAGE_READINESS=full$' <<<"$load_check"; then
        echo "SESSIONSTART_READINESS=full"
    elif grep -q '^PACKAGE_READINESS=degraded$' <<<"$load_check"; then
        echo "SESSIONSTART_READINESS=degraded"
    else
        echo "SESSIONSTART_READINESS=failed reason=missing-package-readiness-result" >&2
        exit 1
    fi
else
    echo "(LazyBuddy): $load_check" >&2
    echo "SESSIONSTART_READINESS=failed reason=package-readiness-failed" >&2
    exit 1
fi

# Check for project memory
if [ -f "$CWD/workbuddy.md" ]; then
    echo "(LazyBuddy): Project memory found (workbuddy.md)."
else
    echo "(LazyBuddy): ⚠ Project memory (workbuddy.md) missing. Run /lazybuddy:lazy-init-deep or ask to initialize project memory."
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
            STATUS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('status',''))" "$state_file" 2>/dev/null || echo "")
            if [[ "$STATUS" =~ ^(active|paused|created|planning|executing|blocked|verifying|reviewing)$ ]]; then
                PLAN=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('plan_name',''))" "$state_file" 2>/dev/null || echo "unknown")
                PROGRESS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); p=d.get('progress',{}); print(f\"{p.get('completed_checkboxes',p.get('completed',0))}/{p.get('total_checkboxes',p.get('total',0))}\")" "$state_file" 2>/dev/null || echo "?/?")
                echo "(LazyBuddy): Active run found: $PLAN (status: $STATUS, progress: $PROGRESS)"
                echo "(LazyBuddy): Run /lazybuddy:lazy-start-work or ask to continue the planned work."
                break
            fi
        fi
    done
fi

exit 0
