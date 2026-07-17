#!/usr/bin/env bash
# summarize-run.sh — Human-readable summary of run state.
# Usage: summarize-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: summarize-run.sh <run_id>" >&2
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

python3 - "$STATE_FILE" "$RUN_ID" <<'PY'
import json
import sys

d = json.load(open(sys.argv[1]))
run_id = sys.argv[2]
tasks = d.get('tasks', [])
tcounts = {'queued': 0, 'running': 0, 'done': 0, 'failed': 0, 'skipped': 0}
blockers = []
for t in tasks:
    s = t.get('status', 'queued')
    tcounts[s] = tcounts.get(s, 0) + 1
    if s == 'failed':
        blockers.append(f"  - {t['id']}: {t.get('title','')}")

gates = d.get('verification_gates', [])
iteration = d.get('iteration', {})
budget = d.get('budget', {})
progress = d.get('progress', {})

print(f'=== Run Summary: {run_id} ===')
print(f"Status:       {d.get('status','unknown')}")
print(f"Objective:    {d.get('objective','N/A')}")
print(f"Created:      {d.get('created_at','N/A')}")
print(f"Updated:      {d.get('updated_at','N/A')}")
print()
print('--- Tasks ---')
print(f"  Queued:     {tcounts['queued']}")
print(f"  Running:    {tcounts['running']}")
print(f"  Done:       {tcounts['done']}")
print(f"  Failed:     {tcounts['failed']}")
print(f"  Skipped:    {tcounts['skipped']}")
print(f"  Total:      {len(tasks)}")
print()
print(f"Progress:       {progress.get('completed_checkboxes',0)}/{progress.get('total_checkboxes',0)} checkboxes")
print()
print('--- Verification Gates ---')
for g in gates:
    print(f"  [{g.get('status','pending')}] {g.get('name','unnamed')}: {g.get('result','N/A')}")
if not gates:
    print('  (none)')
print()
print(f"Review Status:  {d.get('review_status','not_started')}")
print(f"Iteration:      {iteration.get('count',0)}/{iteration.get('max',500)} ({iteration.get('mode','normal')})")
print(f"Last Checkpoint:{d.get('last_checkpoint','never')}")
print(f"Plan Reference: {d.get('plan_reference','N/A')}")
print(f"Budget:         tokens={budget.get('max_tokens','N/A')}, cost_usd={budget.get('max_cost_usd','N/A')}")
print(f"Sessions:       {len(d.get('session_ids',[]))}")

if blockers:
    print()
    print('--- Blockers ---')
    print('\\n'.join(blockers))
PY
