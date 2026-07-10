#!/usr/bin/env bash
# recover-run.sh — Restore state from latest checkpoint and replay events.
# Usage: recover-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: recover-run.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
RUN_DIR="$CWD/.lazybuddy/runs/$RUN_ID"
STATE_FILE="$RUN_DIR/state.json"
CKPTS_DIR="$RUN_DIR/checkpoints"

# Find latest checkpoint
LATEST_CKPT=$(ls -1d "$CKPTS_DIR"/*/ 2>/dev/null | sort -r | head -1 || echo "")
if [ -z "$LATEST_CKPT" ]; then
    echo "Error: no checkpoint available for run '$RUN_ID'" >&2
    exit 1
fi

# Restore state from checkpoint
if [ ! -f "$LATEST_CKPT/state.json" ]; then
    echo "Error: checkpoint state snapshot missing in '$LATEST_CKPT'" >&2
    exit 1
fi
cp "$LATEST_CKPT/state.json" "$STATE_FILE"

# Determine checkpoint timestamp from state snapshot
CKPT_TS=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('last_checkpoint',''))" 2>/dev/null || echo "")

# Replay events after checkpoint timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EVENTS_FILE="$RUN_DIR/events.jsonl"
if [ -f "$EVENTS_FILE" ] && [ -n "$CKPT_TS" ]; then
    python3 -c "
import json, sys

# Read checkpoint state
state = json.load(open('$STATE_FILE'))
replay_count = 0

# Replay events after checkpoint
with open('$EVENTS_FILE') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        evt_ts = event.get('ts', '')
        if evt_ts <= '$CKPT_TS':
            continue
        evt_type = event.get('event', '')
        replay_count += 1
        if evt_type == 'task_updated':
            tid = event.get('task_id')
            tstatus = event.get('status')
            changed_files = event.get('changed_files')
            for task in state.get('tasks', []):
                if task['id'] == tid:
                    task['status'] = tstatus
                    if changed_files:
                        task['changed_files'] = list(set(task.get('changed_files', []) + changed_files))
                    break
        elif evt_type == 'checkpoint_created':
            state['last_checkpoint'] = evt_ts
        elif evt_type == 'run_created':
            pass

state['updated_at'] = '$NOW'

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)

# Append recovery event
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'recovered', 'source_checkpoint': '$LATEST_CKPT', 'events_replayed': replay_count}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
" 
else
    python3 -c "
import json
d = json.load(open('$STATE_FILE'))
d['updated_at'] = '$NOW'
with open('$STATE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
fi

cat "$STATE_FILE"
