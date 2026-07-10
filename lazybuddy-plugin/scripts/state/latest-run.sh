#!/usr/bin/env bash
# latest-run.sh — Output run_id of the most recently updated active (non-terminal) run.
# Usage: latest-run.sh
set -euo pipefail

CWD="${CWD:-.}"
RUNS_DIR="$CWD/.lazybuddy/runs"

if [ ! -d "$RUNS_DIR" ]; then
    echo "No active runs." >&2
    exit 1
fi

TERMINAL_STATES='["complete","failed","cancelled"]'

LATEST=$(python3 -c "
import json, os, glob

best_ts = ''
best_id = ''
pattern = os.path.join('$RUNS_DIR', '*', 'state.json')
for f in sorted(glob.glob(pattern)):
    try:
        d = json.load(open(f))
    except (json.JSONDecodeError, OSError):
        continue
    status = d.get('status', '')
    if status in $TERMINAL_STATES:
        continue
    updated = d.get('updated_at', '')
    if updated > best_ts:
        best_ts = updated
        best_id = d.get('run_id', os.path.basename(os.path.dirname(f)))
if best_id:
    print(best_id)
else:
    exit(1)
" 2>/dev/null) || {
    echo "No active runs found." >&2
    exit 1
}

echo "$LATEST"
