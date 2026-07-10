#!/usr/bin/env bash
# update-plan-checkbox.sh — Atomically update BOTH plan.md checkbox AND state.json task.
# Solves G-017: plan checkbox / state.json task divergence.
# Usage: update-plan-checkbox.sh <run_id> <task_label_substring>
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
RUN_DIR="$CWD/.lazybuddy/runs/$RUN_ID"
PLAN_FILE="$RUN_DIR/plan.md"
STATE_FILE="$RUN_DIR/state.json"
EVENTS_FILE="$RUN_DIR/events.jsonl"

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
PLAN_TMP="$PLAN_FILE.tmp.$$"
python3 -c "
import sys
label = sys.argv[1]
with open('$PLAN_FILE') as f:
    lines = f.readlines()

updated = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('- [ ] ') and label.lower() in stripped.lower():
        lines[i] = line.replace('- [ ] ', '- [x] ', 1)
        updated = True
        break

if not updated:
    print(f'Warning: no unchecked checkbox matching \"{label}\" found in plan.md', file=sys.stderr)
    sys.exit(0)

with open('$PLAN_TMP', 'w') as f:
    f.writelines(lines)
" "$TASK_LABEL"

if [ -f "$PLAN_TMP" ]; then
    mv "$PLAN_TMP" "$PLAN_FILE"
fi

# --- Update state.json task status (atomic: tmp + rename) ---
STATE_TMP="$STATE_FILE.tmp.$$"
python3 -c "
import json, sys
label = sys.argv[1].lower()
d = json.load(open('$STATE_FILE'))
updated = False
for t in d.get('tasks', []):
    if label in t.get('title', '').lower() or label in t.get('id', '').lower():
        t['status'] = 'done'
        updated = True
        break
d['updated_at'] = '$NOW'
if not updated:
    print(f'Warning: no task matching \"{label}\" found in state.json', file=sys.stderr)
with open('$STATE_TMP', 'w') as f:
    json.dump(d, f, indent=2)
" "$TASK_LABEL"

mv "$STATE_TMP" "$STATE_FILE"

# --- Append event ---
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'plan_checkbox_updated', 'task_label': '$TASK_LABEL'}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"

echo "Updated: plan.md checkbox + state.json task for '$TASK_LABEL'"
