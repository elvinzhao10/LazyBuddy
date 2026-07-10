#!/usr/bin/env bash
# finalize-run.sh — Check all conditions and mark run complete.
# Usage: finalize-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if ! [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    echo "Error: invalid run_id" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazybuddy/runs/$RUN_ID/state.json"
EVENTS_FILE="$CWD/.lazybuddy/runs/$RUN_ID/events.jsonl"
PLAN_FILE="$CWD/.lazybuddy/runs/$RUN_ID/plan.md"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Run all checks
RESULT=$(python3 -c "
import json, sys, os

d = json.load(open('$STATE_FILE'))
reasons = []

# 1. Verification gates: all must be 'passed'
gates = d.get('verification_gates', [])
for g in gates:
    if g.get('status') != 'passed':
        reasons.append(f\"gate '{g.get('name','?')}' is '{g.get('status')}' (need passed)\")

# 2. Review status: must be 'accepted'
rs = d.get('review_status', 'not_started')
if rs != 'accepted':
    reasons.append(f\"review_status is '{rs}' (need accepted)\")

# 3. No queued or running tasks
tasks = d.get('tasks', [])
active = [t for t in tasks if t.get('status') in ('queued','running')]
if active:
    ids = ', '.join(t['id'] for t in active)
    reasons.append(f\"active tasks remain: {ids}\")

# 4. Cross-check plan.md checkboxes (G-017 fix)
plan_path = '$PLAN_FILE'
if os.path.isfile(plan_path):
    with open(plan_path) as f:
        lines = f.readlines()
    headings_to_count = {'TODOs', 'Final Verification Wave'}
    in_section = not any(l.strip().startswith('## ') and l.strip()[3:] in headings_to_count for l in lines)
    unchecked = []
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
        reasons.append(f\"plan.md has {len(unchecked)} unchecked checkbox(es): {'; '.join(unchecked)}\")

if reasons:
    for r in reasons:
        print(f'BLOCKED: {r}', file=sys.stderr)
    sys.exit(2)

print('all_clear')
")

# All checks passed
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE="$STATE_FILE.tmp.$$"
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
d['status'] = 'complete'
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
mv "$TMP_FILE" "$STATE_FILE"

python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'run_completed'}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"

echo "RUN COMPLETE: $RUN_ID"
