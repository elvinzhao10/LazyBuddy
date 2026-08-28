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
state_recover_transaction "$RUN_DIR" || exit 1

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
CKPT_STATE_FILE="$CKPT_DIR/state.json"
CKPT_PLAN_FILE="$CKPT_DIR/plan.md"
state_require_safe_run_file "$CKPT_STATE_FILE" "checkpoint state.json" || exit 1
state_require_safe_run_file "$CKPT_PLAN_FILE" "checkpoint plan.md" || exit 1

TMP_FILE=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$RUN_DIR/.events.jsonl.XXXXXX")
CKPT_STATE_TMP=$(mktemp "$RUN_DIR/.checkpoint-state.json.XXXXXX")
CKPT_PLAN_TMP=$(mktemp "$RUN_DIR/.checkpoint-plan.md.XXXXXX")
cleanup_transaction_temps() { rm -f "$TMP_FILE" "$EVENTS_TMP" "$CKPT_STATE_TMP" "$CKPT_PLAN_TMP"; }
trap cleanup_transaction_temps EXIT
python3 - "$STATE_FILE" "$TMP_FILE" "$CKPT_STATE_TMP" "$EVENTS_FILE" "$EVENTS_TMP" "$NOW" "$RUN_ID" "$CKPT_DIR" <<'PYEOF'
import json
import os
import sys

state_file, tmp_file, checkpoint_state_tmp, events_file, events_tmp, now, run_id, checkpoint_dir = sys.argv[1:]
d = json.load(open(state_file))
d['last_checkpoint'] = now
d['updated_at'] = now
for path in (tmp_file, checkpoint_state_tmp):
    with open(path, 'w') as handle:
        json.dump(d, handle, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'checkpoint_created', 'path': checkpoint_dir}
with open(events_tmp, 'w') as output:
    if os.path.exists(events_file):
        with open(events_file) as source:
            output.write(source.read())
    output.write(json.dumps(event) + '\n')
PYEOF

writes=(
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$TMP_FILE")"
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"
    "$(state_transaction_write_arg "checkpoints/$TS_LABEL/state.json" "$CKPT_STATE_FILE" "$CKPT_STATE_TMP")"
)
if [ -n "$PLAN_PATH" ] && [ -f "$PLAN_PATH" ]; then
    cp "$PLAN_PATH" "$CKPT_PLAN_TMP"
    writes+=("$(state_transaction_write_arg "checkpoints/$TS_LABEL/plan.md" "$CKPT_PLAN_FILE" "$CKPT_PLAN_TMP")")
fi
state_commit_transaction "$RUN_DIR" checkpoint "${writes[@]}"

echo "$CKPT_DIR"
