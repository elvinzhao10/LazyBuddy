#!/usr/bin/env bash
# checkpoint.sh — Snapshot current state.json and plan.md into a timestamped checkpoint.
# Usage: checkpoint.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if [ -z "$RUN_ID" ]; then
    echo "Usage: checkpoint.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
RUN_DIR="$CWD/.lazyworkbuddy/runs/$RUN_ID"
STATE_FILE="$RUN_DIR/state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TS_LABEL=$(date -u +"%Y%m%dT%H%M%SZ")
CKPT_DIR="$RUN_DIR/checkpoints/$TS_LABEL"
mkdir -p "$CKPT_DIR"

# Snapshot state.json
cp "$STATE_FILE" "$CKPT_DIR/state.json"

# Snapshot plan.md if referenced
PLAN_REF=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('plan_reference',''))" 2>/dev/null || echo "")
if [ -n "$PLAN_REF" ]; then
    PLAN_PATH="$CWD/$PLAN_REF"
    if [ -f "$PLAN_PATH" ]; then
        cp "$PLAN_PATH" "$CKPT_DIR/plan.md"
    fi
fi

# Update last_checkpoint in state.json
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
d['last_checkpoint'] = '$NOW'
d['updated_at'] = '$NOW'
with open('$STATE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"

# Append checkpoint event
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'checkpoint_created', 'path': '$CKPT_DIR'}
with open('$RUN_DIR/events.jsonl', 'a') as f:
    f.write(json.dumps(event) + '\n')
"

echo "$CKPT_DIR"
