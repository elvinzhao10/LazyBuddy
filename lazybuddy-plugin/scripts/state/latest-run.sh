#!/usr/bin/env bash
# latest-run.sh — Output run_id of the most recently updated active (non-terminal) run.
# Usage: latest-run.sh
set -euo pipefail

CWD="${CWD:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"
RUNS_DIR="$CWD/.lazybuddy/runs"

if [ -L "$CWD/.lazybuddy" ] || [ -L "$RUNS_DIR" ]; then
    echo "Error: LazyBuddy state directories must not be symlinks" >&2
    exit 1
fi
if [ ! -d "$RUNS_DIR" ]; then
    echo "No active runs." >&2
    exit 1
fi

TERMINAL_STATES='["complete","failed","cancelled"]'

LATEST=$(python3 - "$RUNS_DIR" "$TERMINAL_STATES" <<'PY'
import glob
import json
import os
import sys

runs_dir, terminal_states = sys.argv[1:]
terminal_states = set(json.loads(terminal_states))

best_ts = ''
best_id = ''
pattern = os.path.join(runs_dir, '*', 'state.json')
for f in sorted(glob.glob(pattern)):
    run_dir = os.path.dirname(f)
    if os.path.islink(run_dir) or os.path.islink(f):
        continue
    try:
        d = json.load(open(f))
    except (json.JSONDecodeError, OSError):
        continue
    status = d.get('status', '')
    if status in terminal_states:
        continue
    updated = d.get('updated_at', '')
    if updated > best_ts:
        best_ts = updated
        best_id = d.get('run_id', os.path.basename(run_dir))
if best_id:
    print(best_id)
else:
    exit(1)
PY
) || {
    echo "No active runs found." >&2
    exit 1
}

echo "$LATEST"
