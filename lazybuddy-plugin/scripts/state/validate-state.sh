#!/usr/bin/env bash
# validate-state.sh — Validate state.json against required schema.
# Usage: validate-state.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: validate-state.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"

state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

python3 - "$STATE_FILE" <<'PY'
import json, sys

with open(sys.argv[1]) as f:
    d = json.load(f)

errors = []
VALID_STATUSES = ['created','planning','executing','blocked','verifying','reviewing','complete','failed','cancelled']
VALID_TASK_STATUSES = ['queued','running','done','failed','skipped']
VALID_GATE_STATUSES = ['pending','passed','failed']
VALID_REVIEW_STATUSES = ['not_started','accepted','revise','rejected']

# Required top-level fields
REQUIRED_TOP = ['status','plan_reference','schema_version','run_id','created_at','updated_at',
    'objective','tasks','progress','verification_gates','review_status','iteration',
    'last_checkpoint','budget','session_ids']
for field in REQUIRED_TOP:
    if field not in d:
        errors.append(f"Missing top-level field: {field}")

# Status validation
if d.get('status') not in VALID_STATUSES:
    errors.append(f"Invalid status: {d.get('status')} (must be one of {VALID_STATUSES})")

# Schema version
if d.get('schema_version') != '2':
    errors.append(f"Invalid schema_version: {d.get('schema_version')} (expected '2')")

# Tasks validation
task_ids = set()
all_task_ids = set()
for task in d.get('tasks', []):
    tid = task.get('id')
    if not tid:
        errors.append('Task missing id field')
        continue
    if tid in task_ids:
        errors.append(f"Duplicate task id: {tid}")
    task_ids.add(tid)
    all_task_ids.add(tid)
    for req in ['title','description','owner','status']:
        if req not in task:
            errors.append(f"Task {tid} missing field: {req}")
    if task.get('status') not in VALID_TASK_STATUSES:
        errors.append(f"Task {tid} invalid status: {task.get('status')}")
    for dep in task.get('depends_on', []):
        if dep not in all_task_ids:
            errors.append(f"Task {tid} depends_on missing task: {dep}")

# Verification gates
for gate in d.get('verification_gates', []):
    if 'name' not in gate:
        errors.append('Verification gate missing name')
    if gate.get('status') not in VALID_GATE_STATUSES:
        errors.append(f"Gate {gate.get('name','?')} invalid status: {gate.get('status')}")

# Review status
if d.get('review_status') not in VALID_REVIEW_STATUSES:
    errors.append(f"Invalid review_status: {d.get('review_status')}")

# Iteration
it = d.get('iteration', {})
if not isinstance(it, dict):
    errors.append('iteration must be an object')

# Progress
pr = d.get('progress', {})
if not isinstance(pr, dict):
    errors.append('progress must be an object')

# Budget
b = d.get('budget', {})
if not isinstance(b, dict):
    errors.append('budget must be an object')

if errors:
    print('FAIL')
    for e in errors:
        print(f'  - {e}')
    sys.exit(1)
else:
    print('PASS')
    print(f'  run_id: {d["run_id"]}')
    print(f'  status: {d["status"]}')
    print(f'  tasks: {len(d["tasks"])}')
    print(f'  gates: {len(d["verification_gates"])}')
PY
