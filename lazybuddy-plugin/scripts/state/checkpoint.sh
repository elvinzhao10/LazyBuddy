#!/usr/bin/env bash
# checkpoint.sh — Snapshot current state.json and plan.md into a timestamped checkpoint.
# Usage: checkpoint.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: checkpoint.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
RUN_DIR="$STATE_RUN_DIR"
STATE_FILE="$RUN_DIR/state.json"
EVENTS_FILE="$RUN_DIR/events.jsonl"

state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

PLAN_REF=$(python3 - "$STATE_FILE" <<'PYEOF' 2>/dev/null || echo ""
import json
import sys
print(json.load(open(sys.argv[1])).get('plan_reference', ''))
PYEOF
)
PLAN_PATH=""
if [ -n "$PLAN_REF" ]; then
    state_resolve_plan_reference "$CWD" "$PLAN_REF" || exit 1
    PLAN_PATH="$STATE_PLAN_PATH"
    state_require_safe_run_file "$PLAN_PATH" "plan file" || exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TS_LABEL=$(date -u +"%Y%m%dT%H%M%SZ")
CKPTS_DIR="$RUN_DIR/checkpoints"
state_prepare_safe_run_directory "$CKPTS_DIR" "checkpoints directory" || exit 1
CKPT_DIR="$CKPTS_DIR/$TS_LABEL"
state_prepare_safe_run_directory "$CKPT_DIR" "checkpoint directory" || exit 1
CKPT_STATE_FILE="$CKPT_DIR/state.json"
CKPT_PLAN_FILE="$CKPT_DIR/plan.md"
state_require_safe_run_file "$CKPT_STATE_FILE" "checkpoint state.json" || exit 1
state_require_safe_run_file "$CKPT_PLAN_FILE" "checkpoint plan.md" || exit 1

# Snapshot state.json
cp "$STATE_FILE" "$CKPT_STATE_FILE"

if [ -n "$PLAN_PATH" ] && [ -f "$PLAN_PATH" ]; then
    cp "$PLAN_PATH" "$CKPT_PLAN_FILE"
fi

# Update last_checkpoint in state.json
TMP_FILE=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
python3 - "$STATE_FILE" "$TMP_FILE" "$NOW" <<'PYEOF'
import json
import sys
state_file, tmp_file, now = sys.argv[1:]
d = json.load(open(state_file))
d['last_checkpoint'] = now
d['updated_at'] = now
with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
mv "$TMP_FILE" "$STATE_FILE"

# Append checkpoint event
python3 - "$NOW" "$RUN_ID" "$CKPT_DIR" "$EVENTS_FILE" <<'PYEOF'
import json
import sys
now, run_id, checkpoint_dir, events_file = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'checkpoint_created', 'path': checkpoint_dir}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF

echo "$CKPT_DIR"
