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

# --- Update plan.md checkbox (atomic: tmp + rename) ---
PLAN_TMP=$(mktemp "$RUN_DIR/.plan.md.XXXXXX")
python3 - "$PLAN_FILE" "$PLAN_TMP" "$TASK_LABEL" <<'PYEOF'
import os
import sys
plan_file, plan_tmp, label = sys.argv[1:]
with open(plan_file) as f:
    lines = f.readlines()

updated = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('- [ ] ') and label.lower() in stripped.lower():
        lines[i] = line.replace('- [ ] ', '- [x] ', 1)
        updated = True
        break

if not updated:
    os.unlink(plan_tmp)
    print(f'Warning: no unchecked checkbox matching \"{label}\" found in plan.md', file=sys.stderr)
    sys.exit(0)

with open(plan_tmp, 'w') as f:
    f.writelines(lines)
PYEOF

if [ -f "$PLAN_TMP" ]; then
    mv "$PLAN_TMP" "$PLAN_FILE"
fi

# --- Update state.json task status (atomic: tmp + rename) ---
STATE_TMP=$(mktemp "$RUN_DIR/.state.json.XXXXXX")
python3 - "$STATE_FILE" "$STATE_TMP" "$NOW" "$TASK_LABEL" <<'PYEOF'
import json, sys
state_file, state_tmp, now, label_arg = sys.argv[1:]
label = label_arg.lower()
d = json.load(open(state_file))
updated = False
for t in d.get('tasks', []):
    if label in t.get('title', '').lower() or label in t.get('id', '').lower():
        t['status'] = 'done'
        updated = True
        break
d['updated_at'] = now
if not updated:
    print(f'Warning: no task matching \"{label}\" found in state.json', file=sys.stderr)
with open(state_tmp, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

mv "$STATE_TMP" "$STATE_FILE"

# --- Append event ---
python3 - "$NOW" "$RUN_ID" "$TASK_LABEL" "$EVENTS_FILE" <<'PYEOF'
import json
import sys
now, run_id, task_label, events_file = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'plan_checkbox_updated', 'task_label': task_label}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF

echo "Updated: plan.md checkbox + state.json task for '$TASK_LABEL'"
