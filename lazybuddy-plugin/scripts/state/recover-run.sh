#!/usr/bin/env bash
# recover-run.sh — Restore state from latest checkpoint and replay events.
# Usage: recover-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: recover-run.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
RUN_DIR="$STATE_RUN_DIR"
STATE_FILE="$RUN_DIR/state.json"
CKPTS_DIR="$RUN_DIR/checkpoints"
EVENTS_FILE="$RUN_DIR/events.jsonl"
state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
state_require_safe_run_directory "$CKPTS_DIR" "checkpoints directory" || exit 1

# Find latest checkpoint
LATEST_CKPT=""
for candidate in "$CKPTS_DIR"/*; do
    [ -e "$candidate" ] || continue
    state_require_safe_run_directory "$candidate" "checkpoint directory" || exit 1
    if [ -z "$LATEST_CKPT" ] || [[ "$(basename "$candidate")" > "$(basename "$LATEST_CKPT")" ]]; then
        LATEST_CKPT="$candidate"
    fi
done
if [ -z "$LATEST_CKPT" ]; then
    echo "Error: no checkpoint available for run '$RUN_ID'" >&2
    exit 1
fi

# Restore state from checkpoint
CKPT_STATE_FILE="$LATEST_CKPT/state.json"
state_require_existing_run_file "$CKPT_STATE_FILE" "checkpoint state.json" || exit 1
cp "$CKPT_STATE_FILE" "$STATE_FILE"

# Determine checkpoint timestamp from state snapshot
CKPT_TS=$(python3 - "$STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    print(json.load(handle).get('last_checkpoint', ''))
PY
) || CKPT_TS=""

# Replay events after checkpoint timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ -f "$EVENTS_FILE" ] && [ -n "$CKPT_TS" ]; then
    python3 - "$STATE_FILE" "$EVENTS_FILE" "$CKPT_TS" "$NOW" "$RUN_ID" "$LATEST_CKPT" <<'PY'
import json
import sys

state_file, events_file, checkpoint_timestamp, now, run_id, latest_checkpoint = sys.argv[1:]
state = json.load(open(state_file))
replay_count = 0

with open(events_file) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        evt_ts = event.get('ts', '')
        if evt_ts <= checkpoint_timestamp:
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

state['updated_at'] = now

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

# Append recovery event
event = {'ts': now, 'run_id': run_id, 'event': 'recovered', 'source_checkpoint': latest_checkpoint, 'events_replayed': replay_count}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PY
else
    python3 - "$STATE_FILE" "$NOW" <<'PY'
import json
import sys

state_file, now = sys.argv[1:]
d = json.load(open(state_file))
d['updated_at'] = now
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PY
fi

cat "$STATE_FILE"
