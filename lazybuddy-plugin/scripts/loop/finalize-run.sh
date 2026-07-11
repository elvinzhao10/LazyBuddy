#!/usr/bin/env bash
# finalize-run.sh — Check all conditions and mark run complete.
# Usage: finalize-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"
PLAN_FILE="$STATE_RUN_DIR/plan.md"

state_require_safe_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
state_require_safe_run_file "$PLAN_FILE" "plan.md" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Run all checks
RESULT=$(python3 - "$STATE_FILE" "$PLAN_FILE" <<'PY'
import json
import os
import sys

state_file, plan_file = sys.argv[1:]
d = json.load(open(state_file))
reasons = []

# 1. Verification gates: all must be 'passed'
gates = d.get('verification_gates', [])
for g in gates:
    if g.get('status') != 'passed':
        reasons.append(f"gate '{g.get('name','?')}' is '{g.get('status')}' (need passed)")

# 2. Review status: must be 'accepted'
rs = d.get('review_status', 'not_started')
if rs != 'accepted':
    reasons.append(f"review_status is '{rs}' (need accepted)")

# 3. No queued or running tasks
tasks = d.get('tasks', [])
active = [t for t in tasks if t.get('status') in ('queued','running')]
if active:
    ids = ', '.join(t['id'] for t in active)
    reasons.append(f"active tasks remain: {ids}")

# 4. Cross-check plan.md checkboxes (G-017 fix)
if os.path.isfile(plan_file):
    with open(plan_file) as f:
        lines = f.readlines()
    headings_to_count = {'TODOs', 'Final Verification Wave'}
    unchecked = []
    if not any(line.strip().startswith('## ') for line in lines):
        reasons.append('plan.md has no level-2 headings (expected TODOs or Final Verification Wave)')
    else:
        in_section = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('## '):
                heading = stripped[3:]
                in_section = heading in headings_to_count
                continue
            if not in_section:
                continue
            if stripped.startswith('- [ ] '):
                unchecked.append(stripped[6:60])
    if unchecked:
        reasons.append(f"plan.md has {len(unchecked)} unchecked checkbox(es): {'; '.join(unchecked)}")

if reasons:
    for r in reasons:
        print(f'BLOCKED: {r}', file=sys.stderr)
    sys.exit(2)

print('all_clear')
PY
)

# All checks passed
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
python3 - "$STATE_FILE" "$NOW" "$TMP_FILE" <<'PY'
import json
import sys

state_file, now, tmp_file = sys.argv[1:]
d = json.load(open(state_file))
d['status'] = 'complete'
d['updated_at'] = now
with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
PY
mv "$TMP_FILE" "$STATE_FILE"

python3 - "$EVENTS_FILE" "$NOW" "$RUN_ID" <<'PY'
import json
import sys

events_file, now, run_id = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'run_completed'}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PY

echo "RUN COMPLETE: $RUN_ID"
