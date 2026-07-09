#!/usr/bin/env bash
# pre-compact.sh — PreCompact hook: save current run checkpoint before context compaction.
# LazyCodex source: reference/lazycodex/plugins/omo/hooks/pre-compact.json
# Best-effort — never blocks compaction. Always exits 0.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
if [ -z "$CWD" ]; then CWD="$PWD"; fi

RUNS_DIR="$CWD/.lazyworkbuddy/runs"
if [ ! -d "$RUNS_DIR" ]; then exit 0; fi

# Find active run
for run_dir in "$RUNS_DIR"/*/; do
    state_file="${run_dir}state.json"
    if [ -f "$state_file" ]; then
        STATUS=$(python3 -c "import json; d=json.load(open('$state_file')); print(d.get('status',''))" 2>/dev/null || echo "")
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ]; then
            TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
            CP_DIR="${run_dir}checkpoints/cp-${TIMESTAMP}"

            python3 -c "
import json, os, shutil, datetime
os.makedirs('$CP_DIR', exist_ok=True)

src = '$state_file'
if os.path.exists(src):
    shutil.copy2(src, '$CP_DIR/state.json')

manifest = {
    'timestamp': '$TIMESTAMP',
    'reason': 'pre_compact',
    'iso': datetime.datetime.utcnow().isoformat() + 'Z'
}
with open('$CP_DIR/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)
" 2>/dev/null

            break
        fi
    fi
done

exit 0
