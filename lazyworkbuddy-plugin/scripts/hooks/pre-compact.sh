#!/usr/bin/env bash
# pre-compact.sh — PreCompact hook: save checkpoint + mark state as compacted.
# LazyCodex source: reference/lazycodex/plugins/omo/hooks/pre-compact.json
# Best-effort — never blocks compaction. Always exits 0.
#
# P5-2 hardening: besides saving a checkpoint, this appends a context_compacted
# event to events.jsonl and stamps state.json with last_compaction. The
# orchestrator/stop-gate can then detect "state was compacted since last read"
# and force a fresh re-read instead of trusting stale in-context pointers.
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
        if [ "$STATUS" = "active" ] || [ "$STATUS" = "paused" ] || [ "$STATUS" = "executing" ] || [ "$STATUS" = "verifying" ] || [ "$STATUS" = "reviewing" ]; then
            TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
            ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            RUN_ID=$(basename "${run_dir%/}")
            CP_DIR="${run_dir}checkpoints/cp-${TIMESTAMP}"
            EVENTS_FILE="${run_dir}events.jsonl"

            python3 -c "
import json, os, shutil, datetime
os.makedirs('$CP_DIR', exist_ok=True)

src = '$state_file'
if os.path.exists(src):
    shutil.copy2(src, '$CP_DIR/state.json')

manifest = {
    'timestamp': '$TIMESTAMP',
    'reason': 'pre_compact',
    'iso': '$ISO'
}
with open('$CP_DIR/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)

# Stamp state.json with last_compaction so resume logic can detect stale pointers
try:
    with open('$state_file') as f:
        st = json.load(f)
    st['last_compaction'] = '$ISO'
    st['updated_at'] = '$ISO'
    with open('$state_file', 'w') as f:
        json.dump(st, f, indent=2)
except Exception:
    pass

# Append a context_compacted event so the orchestrator re-reads fresh state
event = {'ts': '$ISO', 'run_id': '$RUN_ID', 'event': 'context_compacted', 'checkpoint': '$CP_DIR'}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
" 2>/dev/null

            break
        fi
    fi
done

exit 0
