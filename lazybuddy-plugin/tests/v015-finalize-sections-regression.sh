#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PLUGIN/scripts/state"
FINALIZER="$PLUGIN/scripts/loop/finalize-run.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-finalize-sections.XXXXXX")"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

make_run() {
    local run_id="$1"
    CWD="$TMP" bash "$STATE_DIR/create-run.sh" "$run_id" 'finalize sections regression' >/dev/null
    python3 - "$TMP/.lazybuddy/runs/$run_id/state.json" <<'PY'
import json
import sys

state_file = sys.argv[1]
with open(state_file, encoding='utf-8') as handle:
    state = json.load(handle)
state['verification_gates'] = [{'name': 'qa', 'status': 'passed'}]
state['review_status'] = 'accepted'
with open(state_file, 'w', encoding='utf-8') as handle:
    json.dump(state, handle)
PY
}

assert_status() {
    local run_id="$1"
    local expected="$2"
    python3 - "$TMP/.lazybuddy/runs/$run_id/state.json" "$expected" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    actual = json.load(handle)['status']
assert actual == sys.argv[2], (actual, sys.argv[2])
PY
}

make_run notes-only
printf '%s\n' '## Notes' '- [ ] informational follow-up' > "$TMP/.lazybuddy/runs/notes-only/plan.md"
if ! notes_output=$(CWD="$TMP" bash "$FINALIZER" notes-only 2>&1); then
    fail "Notes-only plan was blocked: $notes_output"
fi
test "$notes_output" = 'RUN COMPLETE: notes-only' || fail 'Notes-only plan did not complete'
assert_status notes-only complete

make_run todos-unchecked
printf '%s\n' '## TODOs' '- [ ] required task' > "$TMP/.lazybuddy/runs/todos-unchecked/plan.md"
if CWD="$TMP" bash "$FINALIZER" todos-unchecked >"$TMP/todos.out" 2>&1; then
    fail 'unchecked TODO was accepted'
fi
grep -q 'plan.md has 1 unchecked checkbox' "$TMP/todos.out" || fail 'unchecked TODO did not report a block'
assert_status todos-unchecked created

make_run verification-unchecked
printf '%s\n' '## Final Verification Wave' '- [ ] required verification' > "$TMP/.lazybuddy/runs/verification-unchecked/plan.md"
if CWD="$TMP" bash "$FINALIZER" verification-unchecked >"$TMP/verification.out" 2>&1; then
    fail 'unchecked verification item was accepted'
fi
grep -q 'plan.md has 1 unchecked checkbox' "$TMP/verification.out" || fail 'unchecked verification item did not report a block'
assert_status verification-unchecked created

make_run headingless
printf '%s\n' '- [ ] malformed plan item' > "$TMP/.lazybuddy/runs/headingless/plan.md"
if CWD="$TMP" bash "$FINALIZER" headingless >"$TMP/headingless.out" 2>&1; then
    fail 'heading-less plan was accepted'
fi
grep -q 'plan.md has no level-2 headings' "$TMP/headingless.out" || fail 'heading-less plan did not report a clear error'
assert_status headingless created

make_run recognized-complete
printf '%s\n' '## TODOs' '- [x] completed task' '## Final Verification Wave' '- [x] completed verification' > "$TMP/.lazybuddy/runs/recognized-complete/plan.md"
if ! complete_output=$(CWD="$TMP" bash "$FINALIZER" recognized-complete 2>&1); then
    fail "recognized complete plan was blocked: $complete_output"
fi
test "$complete_output" = 'RUN COMPLETE: recognized-complete' || fail 'recognized complete plan did not complete'
assert_status recognized-complete complete

echo 'v0.15 finalize sections regression: PASS'
