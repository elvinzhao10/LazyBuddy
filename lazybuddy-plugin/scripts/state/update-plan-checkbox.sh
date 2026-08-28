#!/usr/bin/env bash
# update-plan-checkbox.sh — Atomically update BOTH plan.md checkbox AND state.json task.
# Solves G-017: plan checkbox / state.json task divergence.
# Usage: update-plan-checkbox.sh <run_id> <task_label_substring>
set -euo pipefail

RUN_ID="${1:-}"
TASK_LABEL="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$TASK_LABEL" ]; then
    echo "Usage: update-plan-checkbox.sh <run_id> <task_label_substring>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
RUN_DIR="$STATE_RUN_DIR"
PLAN_FILE="$RUN_DIR/plan.md"
STATE_FILE="$RUN_DIR/state.json"
EVENTS_FILE="$RUN_DIR/events.jsonl"

state_require_existing_run_file "$PLAN_FILE" "plan.md" || exit 1
state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$PLAN_FILE" ]; then
    echo "Error: plan.md not found for run '$RUN_ID'" >&2
    exit 1
fi
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PLAN_TMP=$(mktemp "$RUN_DIR/.plan.md.XXXXXX")
STATE_TMP=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$PLAN_TMP" "$STATE_TMP" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT

python3 - "$PLAN_FILE" "$PLAN_TMP" "$STATE_FILE" "$STATE_TMP" "$EVENTS_FILE" "$EVENTS_TMP" "$NOW" "$RUN_ID" "$TASK_LABEL" <<'PYEOF'
import json
import sys

plan_file, plan_tmp, state_file, state_tmp, events_file, events_tmp, now, run_id, task_label = sys.argv[1:]
label = task_label.lower()
with open(plan_file) as handle:
    lines = handle.readlines()
plan_matches = [index for index, line in enumerate(lines) if line.strip().startswith('- [ ] ') and label in line.lower()]
if not plan_matches:
    raise SystemExit(f'Error: no unchecked checkbox matching "{task_label}" found in plan.md')
if len(plan_matches) != 1:
    raise SystemExit(f'Error: multiple unchecked checkboxes match "{task_label}" in plan.md')
state = json.load(open(state_file))
task_matches = [task for task in state.get('tasks', []) if label in task.get('title', '').lower() or label in task.get('id', '').lower()]
if not task_matches:
    raise SystemExit(f'Error: no task matching "{task_label}" found in state.json')
if len(task_matches) != 1:
    raise SystemExit(f'Error: multiple tasks match "{task_label}" in state.json')
statuses = {task.get('id'): task.get('status') for task in state.get('tasks', [])}
incomplete = [dependency for dependency in task_matches[0].get('depends_on', []) if statuses.get(dependency) != 'done']
if incomplete:
    raise SystemExit(f'Error: dependency {", ".join(incomplete)} must be done before task "{task_matches[0].get("id", task_label)}"')
lines[plan_matches[0]] = lines[plan_matches[0]].replace('- [ ] ', '- [x] ', 1)
task_matches[0]['status'] = 'done'
state['updated_at'] = now
with open(plan_tmp, 'w') as handle:
    handle.writelines(lines)
with open(state_tmp, 'w') as handle:
    json.dump(state, handle, indent=2)
event = {'ts': now, 'run_id': run_id, 'event': 'plan_checkbox_updated', 'task_label': task_label}
with open(events_tmp, 'w') as output:
    if __import__('os').path.exists(events_file):
        with open(events_file) as source:
            output.write(source.read())
    output.write(json.dumps(event) + '\n')
PYEOF

state_commit_transaction "$RUN_DIR" update_plan_checkbox \
    "$(state_transaction_write_arg plan.md "$PLAN_FILE" "$PLAN_TMP")" \
    "$(state_transaction_write_arg state.json "$STATE_FILE" "$STATE_TMP")" \
    "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"

echo "Updated: plan.md checkbox + state.json task for '$TASK_LABEL'"
