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
state_recover_transaction "$RUN_DIR" || exit 1

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

CKPT_STATE_FILE="$LATEST_CKPT/state.json"
state_require_existing_run_file "$CKPT_STATE_FILE" "checkpoint state.json" || exit 1
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATE_TMP=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$STATE_TMP" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT
python3 - "$CKPT_STATE_FILE" "$STATE_TMP" "$EVENTS_FILE" "$EVENTS_TMP" "$NOW" "$RUN_ID" "$LATEST_CKPT" <<'PY'
import json
import os
import sys

checkpoint_state_file, state_tmp, events_file, events_tmp, now, run_id, latest_checkpoint = sys.argv[1:]
state = json.load(open(checkpoint_state_file))
checkpoint_timestamp = state.get('last_checkpoint', '')
replay_count = 0
events = []
checkpoint_index = None
if os.path.exists(events_file):
    with open(events_file) as f:
      for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise SystemExit(f'Error: malformed event ledger: {error.msg}') from error
        events.append(event)
        if event.get('event') == 'checkpoint_created' and event.get('path') == latest_checkpoint:
            checkpoint_index = len(events) - 1
    replay_events = events[checkpoint_index + 1:] if checkpoint_index is not None else events
    for event in replay_events:
        evt_ts = event.get('ts', '')
        if checkpoint_index is None and (not checkpoint_timestamp or evt_ts <= checkpoint_timestamp):
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

statuses = {task.get('id'): task.get('status') for task in state.get('tasks', [])}
for task in state.get('tasks', []):
    if task.get('status') == 'done':
        incomplete = [dependency for dependency in task.get('depends_on', []) if statuses.get(dependency) != 'done']
        if incomplete:
            raise SystemExit("Error: recovered state violates dependency %s for task '%s'" % (', '.join(incomplete), task.get('id', '?')))
state['updated_at'] = now

with open(state_tmp, 'w') as f:
    json.dump(state, f, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'recovered', 'source_checkpoint': latest_checkpoint, 'events_replayed': replay_count}
events.append(event)
with open(events_tmp, 'w') as output:
    for value in events:
        output.write(json.dumps(value) + '\n')
PY

state_commit_transaction "$RUN_DIR" recover_run \
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$STATE_TMP")" \
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"

cat "$STATE_FILE"
