#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PLUGIN_ROOT/scripts/state"
LOOP_DIR="$PLUGIN_ROOT/scripts/loop"
TMP="$(mktemp -d)"
MARKER="$TMP/cwd-python-marker"
EVIL_CWD="$TMP/');__import__('os').system('touch $MARKER');#"
RUN_ID="secure-run"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

write_state() {
    local state_file="$1"
    local mode="$2"
    python3 - "$state_file" "$mode" <<'PY'
import json
import sys

state_file, mode = sys.argv[1:]
with open(state_file) as handle:
    state = json.load(handle)

state['plan_reference'] = '.lazybuddy/runs/secure-run/plan.md'
state['review_status'] = 'accepted'
state['verification_gates'] = [{'name': 'qa', 'status': 'passed'}]
state['tasks'] = [{
    'id': 'T1',
    'title': 'task',
    'description': 'security regression',
    'owner': 'test',
    'status': mode,
    'depends_on': [],
}]

with open(state_file, 'w') as handle:
    json.dump(state, handle)
PY
}

assert_no_cwd_execution() {
    local label="$1"
    shift
    rm -f "$MARKER"
    if ! CWD="$EVIL_CWD" "$@" >"$TMP/$label.out" 2>"$TMP/$label.err"; then
        cat "$TMP/$label.out" >&2 || true
        cat "$TMP/$label.err" >&2 || true
        fail "$label failed with a valid state fixture"
    fi
    test ! -e "$MARKER" || fail "$label executed CWD as Python source"
}

mkdir -p "$EVIL_CWD"
CWD="$EVIL_CWD" bash "$STATE_DIR/create-run.sh" "$RUN_ID" 'security regression' >/dev/null
STATE_FILE="$EVIL_CWD/.lazybuddy/runs/$RUN_ID/state.json"
PLAN_FILE="$EVIL_CWD/.lazybuddy/runs/$RUN_ID/plan.md"
printf '%s\n' '## TODOs' '- [x] T1: task' > "$PLAN_FILE"
write_state "$STATE_FILE" done

assert_no_cwd_execution list-runs bash "$STATE_DIR/list-runs.sh"
assert_no_cwd_execution latest-run bash "$STATE_DIR/latest-run.sh"
assert_no_cwd_execution validate-state bash "$STATE_DIR/validate-state.sh" "$RUN_ID"
assert_no_cwd_execution summarize-run bash "$STATE_DIR/summarize-run.sh" "$RUN_ID"
assert_no_cwd_execution sync-plan-state bash "$STATE_DIR/sync-plan-state.sh" "$RUN_ID"

checkpoint_dir="$EVIL_CWD/.lazybuddy/runs/$RUN_ID/checkpoints/20990101T000000Z"
mkdir -p "$checkpoint_dir"
cp "$STATE_FILE" "$checkpoint_dir/state.json"
assert_no_cwd_execution recover-run bash "$STATE_DIR/recover-run.sh" "$RUN_ID"

write_state "$STATE_FILE" queued
assert_no_cwd_execution next-task bash "$LOOP_DIR/next-task.sh" "$RUN_ID"
write_state "$STATE_FILE" queued
assert_no_cwd_execution run-cycle bash "$LOOP_DIR/run-cycle.sh" "$RUN_ID"
write_state "$STATE_FILE" done
assert_no_cwd_execution finalize-run bash "$LOOP_DIR/finalize-run.sh" "$RUN_ID"

NORMAL_CWD="$TMP/normal"
CWD="$NORMAL_CWD" bash "$STATE_DIR/create-run.sh" plan-ref 'plan reference security' >/dev/null
NORMAL_STATE="$NORMAL_CWD/.lazybuddy/runs/plan-ref/state.json"
OUTSIDE_PLAN="$TMP/outside.md"
printf '%s\n' '## TODOs' '- [ ] outside task' > "$OUTSIDE_PLAN"

set_plan_reference() {
    python3 - "$NORMAL_STATE" "$1" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    state = json.load(handle)
state['plan_reference'] = sys.argv[2]
with open(sys.argv[1], 'w') as handle:
    json.dump(state, handle)
PY
}

expect_plan_rejected() {
    local label="$1"
    set_plan_reference "$2"
    if CWD="$NORMAL_CWD" bash "$STATE_DIR/sync-plan-state.sh" plan-ref >"$TMP/$label.out" 2>"$TMP/$label.err"; then
        fail "$label plan_reference was accepted"
    fi
    grep -qi 'plan_reference\|plan file\|relative\|boundary' "$TMP/$label.err" || fail "$label did not report a plan boundary rejection"
}

expect_plan_rejected absolute "$OUTSIDE_PLAN"
expect_plan_rejected traversal '../outside.md'
ln -s "$OUTSIDE_PLAN" "$NORMAL_CWD/.lazybuddy/plans-link.md"
expect_plan_rejected symlink '.lazybuddy/plans-link.md'

expect_checkpoint_rejected() {
    local label="$1"
    set_plan_reference "$2"
    if CWD="$NORMAL_CWD" bash "$STATE_DIR/checkpoint.sh" plan-ref >"$TMP/checkpoint-$label.out" 2>"$TMP/checkpoint-$label.err"; then
        fail "$label checkpoint plan_reference was accepted"
    fi
    grep -qi 'plan_reference\|plan file\|relative\|boundary' "$TMP/checkpoint-$label.err" || fail "$label checkpoint did not report a plan boundary rejection"
}

expect_checkpoint_rejected absolute "$OUTSIDE_PLAN"
expect_checkpoint_rejected traversal '../outside.md'
expect_checkpoint_rejected symlink '.lazybuddy/plans-link.md'

VALID_PLAN="$NORMAL_CWD/.lazybuddy/plans/valid.md"
mkdir -p "$(dirname "$VALID_PLAN")"
printf '%s\n' '## TODOs' '- [ ] in-bound task' > "$VALID_PLAN"
set_plan_reference '.lazybuddy/plans/valid.md'
CWD="$NORMAL_CWD" bash "$STATE_DIR/sync-plan-state.sh" plan-ref >"$TMP/valid-plan.out"
grep -q 'plan: 1 checkboxes' "$TMP/valid-plan.out" || fail 'valid in-bound plan_reference was not read'
checkpoint_dir=$(CWD="$NORMAL_CWD" bash "$STATE_DIR/checkpoint.sh" plan-ref)
cmp -s "$VALID_PLAN" "$checkpoint_dir/plan.md" || fail 'valid in-bound plan_reference was not checkpointed'

echo 'PASS: CWD Python-source injection and plan-reference boundary regressions'
