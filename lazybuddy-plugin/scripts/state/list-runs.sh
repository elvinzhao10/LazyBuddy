#!/usr/bin/env bash
# list-runs.sh — List all runs sorted by updated_at descending.
# Usage: list-runs.sh
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
    echo "No runs found." >&2
    exit 0
fi

python3 - "$RUNS_DIR" <<'PY'
import glob
import json
import os
import sys

runs_dir = sys.argv[1]
runs = []
pattern = os.path.join(runs_dir, '*', 'state.json')
for f in sorted(glob.glob(pattern)):
    run_dir = os.path.dirname(f)
    if os.path.islink(run_dir) or os.path.islink(f):
        continue
    try:
        d = json.load(open(f))
        runs.append({
            'run_id': d.get('run_id', os.path.basename(run_dir)),
            'status': d.get('status', 'unknown'),
            'created_at': d.get('created_at', ''),
            'updated_at': d.get('updated_at', '')
        })
    except (json.JSONDecodeError, OSError, KeyError):
        continue

runs.sort(key=lambda r: r['updated_at'], reverse=True)

# Print header
print(f"{'RUN_ID':<30} {'STATUS':<14} {'CREATED':<22} {'UPDATED':<22}")
print('-' * 88)
for r in runs:
    print(f"{r['run_id']:<30} {r['status']:<14} {r['created_at']:<22} {r['updated_at']:<22}")
if not runs:
    print('(no runs)')
PY
