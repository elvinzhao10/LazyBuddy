#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PLUGIN_ROOT/scripts/state"
LOOP_DIR="$PLUGIN_ROOT/scripts/loop"
HOOK="$PLUGIN_ROOT/scripts/hooks/pre-tool-use.sh"
MATRIX="$PLUGIN_ROOT/tests/fixtures/security-acceptance-matrix.v1.json"
PYTHON_BIN="${LAZYBUDDY_TEST_PYTHON:-python3}"
TMP="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

"$PYTHON_BIN" - "$MATRIX" <<'PYEOF'
import json
import sys

matrix = json.load(open(sys.argv[1], encoding="utf-8"))
assert matrix["schema_version"] == "lazybuddy-security-acceptance.v1", matrix
expected = {
    "ipv4-mapped-ipv6": ("allow", "reject"),
    "redirect-hop-revalidation": ("allow", "reject"),
    "mcp-invalid-arguments": ("result", "jsonrpc_invalid_params"),
    "evidence-redaction": ("preserved", "redacted"),
    "residual-risk-receipt": ("recorded", "reject"),
}
cases = {case["id"]: case for case in matrix["cases"]}
assert set(cases) == set(expected), cases
for case_id, outcomes in expected.items():
    case = cases[case_id]
    assert set(case) == {"id", "positive", "negative"}, case
    assert case["positive"]["outcome"] == outcomes[0], case
    assert case["negative"]["outcome"] == outcomes[1], case
residual = cases["residual-risk-receipt"]
receipt = residual["positive"]["receipt"]
assert receipt == {
    "kind": "residual-risk",
    "scope": "security-acceptance",
    "revision": "todo-14",
    "authoritative_for_completion": False,
}, receipt
negative_receipt = residual["negative"]["receipt"]
assert set(negative_receipt) == {"kind", "authoritative_for_completion"}, negative_receipt
assert negative_receipt["authoritative_for_completion"] is True, negative_receipt
PYEOF

expect_rejected() {
    local label="$1"
    shift
    if "$@" >"$TMP/output" 2>&1; then
        fail "$label was accepted"
    fi
    grep -q 'invalid run_id\|must not be.*symlink' "$TMP/output" || fail "$label did not report a boundary rejection"
}

make_run() {
    local run_id="$1"
    CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" "$run_id" 'test objective' >/dev/null
}

set_single_task() {
    local run_id="$1"
    local status="$2"
    python3 - "$TMP/work/.lazybuddy/runs/$run_id/state.json" "$status" <<'PYEOF'
import json
import sys

state_file, status = sys.argv[1:]
state = json.load(open(state_file))
state['tasks'] = [{
    'id': 'T1',
    'title': 'task',
    'description': 'd',
    'owner': 'test',
    'status': status,
    'depends_on': [],
}]
json.dump(state, open(state_file, 'w'))
PYEOF
}

run_loop() {
    local script="$1"
    local run_id="$2"
    case "$script" in
        create-repair-task) env CWD="$TMP/work" bash "$LOOP_DIR/$script.sh" "$run_id" T1 retry ;;
        classify-failure) env CWD="$TMP/work" bash "$LOOP_DIR/$script.sh" "$run_id" T1 timeout ;;
        *) env CWD="$TMP/work" bash "$LOOP_DIR/$script.sh" "$run_id" ;;
    esac
}

run_state_script() {
    local script="$1"
    local run_id="$2"
    case "$script" in
        append-event) env CWD="$TMP/work" bash "$STATE_DIR/$script.sh" "$run_id" audit '{}' ;;
        checkpoint|recover-run|load-run|summarize-run|validate-state) env CWD="$TMP/work" bash "$STATE_DIR/$script.sh" "$run_id" ;;
        sync-plan-state) env CWD="$TMP/work" bash "$STATE_DIR/$script.sh" "$run_id" --fix ;;
        update-plan-checkbox) env CWD="$TMP/work" bash "$STATE_DIR/$script.sh" "$run_id" task ;;
        update-task) env CWD="$TMP/work" bash "$STATE_DIR/$script.sh" "$run_id" T1 done ;;
        *) fail "unknown state script: $script" ;;
    esac
}

set_plan_reference() {
    local run_id="$1"
    python3 - "$TMP/work/.lazybuddy/runs/$run_id/state.json" "$run_id" <<'PYEOF'
import json
import sys

state_file, run_id = sys.argv[1:]
state = json.load(open(state_file))
state['plan_reference'] = '.lazybuddy/runs/%s/plan.md' % run_id
json.dump(state, open(state_file, 'w'))
PYEOF
}

CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" 'safe.run-1' 'valid objective'
test -f "$TMP/work/.lazybuddy/runs/safe.run-1/state.json" || fail 'valid run was not created'
python3 - "$TMP/work/.lazybuddy/runs/safe.run-1/state.json" <<'PYEOF'
import json
import sys

state_file = sys.argv[1]
state = json.load(open(state_file))
assert state['run_id'] == 'safe.run-1'
assert state['objective'] == 'valid objective'
state['tasks'] = [{'id': 'T1', 'title': 'task', 'description': 'd', 'owner': 'test', 'status': 'queued'}]
json.dump(state, open(state_file, 'w'))
PYEOF

printf '%s\n' '- [ ] task' > "$TMP/work/.lazybuddy/runs/safe.run-1/plan.md"
CWD="$TMP/work" bash "$STATE_DIR/update-task.sh" 'safe.run-1' T1 done 'changed_files=["state"]'
CWD="$TMP/work" bash "$STATE_DIR/update-plan-checkbox.sh" 'safe.run-1' task
python3 - "$TMP/work/.lazybuddy/runs/safe.run-1/state.json" <<'PYEOF'
import json
import sys

task = json.load(open(sys.argv[1]))['tasks'][0]
assert task['status'] == 'done'
assert task['changed_files'] == ['state']
PYEOF

fixture_secret="s""k-$(printf 'A%.0s' {1..24})"
CWD="$TMP/work" bash "$STATE_DIR/append-event.sh" 'safe.run-1' audit "{\"password\":\"$fixture_secret\"}" >/dev/null
"$PYTHON_BIN" - "$TMP/work/.lazybuddy/runs/safe.run-1/events.jsonl" "$fixture_secret" <<'PYEOF'
import json
import pathlib
import sys

events_path = pathlib.Path(sys.argv[1])
secret = sys.argv[2]
serialized = events_path.read_text(encoding="utf-8")
events = [json.loads(line) for line in serialized.splitlines()]
assert any(event["event"] == "run_created" for event in events), events
audit = next(event for event in events if event["event"] == "audit")
assert audit["password"] == "***REDACTED***", audit
assert secret not in serialized
PYEOF

make_run loop-next
set_single_task loop-next queued
next_output=$(run_loop next-task loop-next)
python3 - "$next_output" <<'PYEOF'
import json
import sys
assert json.loads(sys.argv[1])['id'] == 'T1'
PYEOF

make_run loop-cycle
set_single_task loop-cycle queued
cycle_output=$(run_loop run-cycle loop-cycle)
python3 - "$cycle_output" <<'PYEOF'
import json
import sys
result = json.loads(sys.argv[1])
assert result['status'] == 'continue'
assert result['task']['id'] == 'T1'
PYEOF

make_run loop-repair
set_single_task loop-repair failed
repair_output=$(run_loop create-repair-task loop-repair)
python3 - "$TMP/work/.lazybuddy/runs/loop-repair/state.json" "$repair_output" <<'PYEOF'
import json
import sys
state = json.load(open(sys.argv[1]))
assert any(task['id'] == sys.argv[2] and task['repair_of'] == 'T1' for task in state['tasks'])
PYEOF

make_run loop-classify
set_single_task loop-classify queued
classification=$(run_loop classify-failure loop-classify)
test "$classification" = retry || fail 'timeout was not classified as retry'
python3 - "$TMP/work/.lazybuddy/runs/loop-classify/state.json" <<'PYEOF'
import json
import sys
task = json.load(open(sys.argv[1]))['tasks'][0]
assert task['status'] == 'failed'
assert task['classification'] == 'retry'
assert task['error'] == 'timeout'
PYEOF

make_run loop-finalize
python3 - "$TMP/work/.lazybuddy/runs/loop-finalize/state.json" <<'PYEOF'
import json
import sys
state_file = sys.argv[1]
state = json.load(open(state_file))
state['verification_gates'] = [{'name': 'qa', 'status': 'passed'}]
state['review_status'] = 'accepted'
json.dump(state, open(state_file, 'w'))
PYEOF
finalize_output=$(run_loop finalize-run loop-finalize)
test "$finalize_output" = 'RUN COMPLETE: loop-finalize' || fail 'finalize-run did not complete a valid run'

for script in next-task run-cycle finalize-run create-repair-task classify-failure; do
    run_id="loop-state-link-$script"
    make_run "$run_id"
    set_single_task "$run_id" queued
    outside="$TMP/$script-outside-state.json"
    cp "$TMP/work/.lazybuddy/runs/$run_id/state.json" "$outside"
    before=$(cksum "$outside")
    rm "$TMP/work/.lazybuddy/runs/$run_id/state.json"
    ln -s "$outside" "$TMP/work/.lazybuddy/runs/$run_id/state.json"
    expect_rejected "symlinked state file ($script)" run_loop "$script" "$run_id"
    test "$(cksum "$outside")" = "$before" || fail "symlinked state file mutated outside data ($script)"
done

for script in finalize-run create-repair-task classify-failure; do
    run_id="loop-events-link-$script"
    make_run "$run_id"
    set_single_task "$run_id" queued
    outside="$TMP/$script-outside-events.jsonl"
    cp "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl" "$outside"
    before=$(cksum "$outside")
    rm "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl"
    ln -s "$outside" "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl"
    expect_rejected "symlinked events file ($script)" run_loop "$script" "$run_id"
    test "$(cksum "$outside")" = "$before" || fail "symlinked events file mutated outside data ($script)"
done

make_run loop-plan-link
python3 - "$TMP/work/.lazybuddy/runs/loop-plan-link/state.json" <<'PYEOF'
import json
import sys
state_file = sys.argv[1]
state = json.load(open(state_file))
state['verification_gates'] = [{'name': 'qa', 'status': 'passed'}]
state['review_status'] = 'accepted'
json.dump(state, open(state_file, 'w'))
PYEOF
outside_plan="$TMP/outside-plan.md"
printf '%s\n' '- [ ] outside task' > "$outside_plan"
ln -s "$outside_plan" "$TMP/work/.lazybuddy/runs/loop-plan-link/plan.md"
expect_rejected 'symlinked plan file (finalize-run)' run_loop finalize-run loop-plan-link
grep -q -- '- \[ \] outside task' "$outside_plan" || fail 'symlinked plan file was modified outside the run'

for script in next-task run-cycle finalize-run create-repair-task classify-failure; do
    run_id="loop-run-link-$script"
    outside="$TMP/$script-outside-run"
    mkdir -p "$outside"
    ln -s "$outside" "$TMP/work/.lazybuddy/runs/$run_id"
    expect_rejected "symlinked loop run ($script)" run_loop "$script" "$run_id"
    test ! -e "$outside/state.json" || fail "symlinked loop run created outside state ($script)"
    test ! -e "$outside/events.jsonl" || fail "symlinked loop run created outside events ($script)"
done

for run_id in '/absolute' '../escape' 'safe/run' 'safe\run'; do
    for script in next-task run-cycle finalize-run create-repair-task classify-failure; do
        expect_rejected "invalid loop run_id ($script: $run_id)" run_loop "$script" "$run_id"
    done
done

for run_id in '/absolute' '../escape' 'safe/run' 'safe\run'; do
    expect_rejected "$run_id" env CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" "$run_id" objective
done

for script in load-run summarize-run validate-state update-task update-plan-checkbox checkpoint recover-run sync-plan-state; do
    run_id="state-file-link-$script"
    make_run "$run_id"
    set_single_task "$run_id" queued
    printf '%s\n' '- [ ] task' > "$TMP/work/.lazybuddy/runs/$run_id/plan.md"
    if [ "$script" = sync-plan-state ]; then
        set_plan_reference "$run_id"
    fi
    outside="$TMP/$script-state-artifact.json"
    cp "$TMP/work/.lazybuddy/runs/$run_id/state.json" "$outside"
    before=$(cksum "$outside")
    rm "$TMP/work/.lazybuddy/runs/$run_id/state.json"
    ln -s "$outside" "$TMP/work/.lazybuddy/runs/$run_id/state.json"
    expect_rejected "symlinked state artifact ($script)" run_state_script "$script" "$run_id"
    test "$(cksum "$outside")" = "$before" || fail "state artifact escaped through $script"
done

mkdir -p "$TMP/work/.lazybuddy/runs/create-state-link"
outside_create_state="$TMP/create-state-outside.json"
printf '%s\n' '{}' > "$outside_create_state"
before=$(cksum "$outside_create_state")
ln -s "$outside_create_state" "$TMP/work/.lazybuddy/runs/create-state-link/state.json"
expect_rejected 'symlinked state artifact (create-run)' env CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" create-state-link objective
test "$(cksum "$outside_create_state")" = "$before" || fail 'state artifact escaped through create-run'

for script in append-event update-task update-plan-checkbox checkpoint recover-run sync-plan-state; do
    run_id="events-file-link-$script"
    make_run "$run_id"
    set_single_task "$run_id" queued
    printf '%s\n' '- [ ] task' > "$TMP/work/.lazybuddy/runs/$run_id/plan.md"
    if [ "$script" = sync-plan-state ]; then
        set_plan_reference "$run_id"
    fi
    outside="$TMP/$script-events-artifact.jsonl"
    cp "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl" "$outside"
    before=$(cksum "$outside")
    rm "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl"
    ln -s "$outside" "$TMP/work/.lazybuddy/runs/$run_id/events.jsonl"
    expect_rejected "symlinked events artifact ($script)" run_state_script "$script" "$run_id"
    test "$(cksum "$outside")" = "$before" || fail "events artifact escaped through $script"
done

mkdir -p "$TMP/work/.lazybuddy/runs/create-events-link"
outside_create_events="$TMP/create-events-outside.jsonl"
printf '%s\n' '{}' > "$outside_create_events"
before=$(cksum "$outside_create_events")
ln -s "$outside_create_events" "$TMP/work/.lazybuddy/runs/create-events-link/events.jsonl"
expect_rejected 'symlinked events artifact (create-run)' env CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" create-events-link objective
test "$(cksum "$outside_create_events")" = "$before" || fail 'events artifact escaped through create-run'

make_run state-plan-link
set_single_task state-plan-link queued
outside_plan="$TMP/state-outside-plan.md"
printf '%s\n' '- [ ] task' > "$outside_plan"
ln -s "$outside_plan" "$TMP/work/.lazybuddy/runs/state-plan-link/plan.md"
expect_rejected 'symlinked state plan artifact (update-plan-checkbox)' run_state_script update-plan-checkbox state-plan-link
grep -q -- '- \[ \] task' "$outside_plan" || fail 'state plan artifact escaped through update-plan-checkbox'

make_run state-sync-plan-link
set_single_task state-sync-plan-link queued
outside_sync_plan="$TMP/state-outside-sync-plan.md"
printf '%s\n' '- [ ] task' > "$outside_sync_plan"
ln -s "$outside_sync_plan" "$TMP/work/.lazybuddy/runs/state-sync-plan-link/plan.md"
set_plan_reference state-sync-plan-link
expect_rejected 'symlinked state plan artifact (sync-plan-state)' run_state_script sync-plan-state state-sync-plan-link

make_run checkpoint-dir-link
rmdir "$TMP/work/.lazybuddy/runs/checkpoint-dir-link/checkpoints"
outside_checkpoint_dir="$TMP/outside-checkpoint-dir"
mkdir -p "$outside_checkpoint_dir"
ln -s "$outside_checkpoint_dir" "$TMP/work/.lazybuddy/runs/checkpoint-dir-link/checkpoints"
expect_rejected 'symlinked checkpoints directory' run_state_script checkpoint checkpoint-dir-link
test ! -e "$outside_checkpoint_dir/state.json" || fail 'checkpoint snapshot escaped through checkpoints directory'

make_run recovery-snapshot-link
checkpoint_dir="$TMP/work/.lazybuddy/runs/recovery-snapshot-link/checkpoints/20990101T000000Z"
mkdir -p "$checkpoint_dir"
outside_checkpoint_state="$TMP/outside-checkpoint-state.json"
cp "$TMP/work/.lazybuddy/runs/recovery-snapshot-link/state.json" "$outside_checkpoint_state"
ln -s "$outside_checkpoint_state" "$checkpoint_dir/state.json"
expect_rejected 'symlinked checkpoint state snapshot' run_state_script recover-run recovery-snapshot-link

mkdir -p "$TMP/outside" "$TMP/work/.lazybuddy/runs"
ln -s "$TMP/outside" "$TMP/work/.lazybuddy/runs/escaped"
expect_rejected 'symlinked run create' env CWD="$TMP/work" bash "$STATE_DIR/create-run.sh" escaped objective
expect_rejected 'symlinked run event write' env CWD="$TMP/work" bash "$STATE_DIR/append-event.sh" escaped audit '{}'
expect_rejected 'symlinked run read' env CWD="$TMP/work" bash "$STATE_DIR/load-run.sh" escaped
expect_rejected 'symlinked run summary' env CWD="$TMP/work" bash "$STATE_DIR/summarize-run.sh" escaped
expect_rejected 'symlinked run task update' env CWD="$TMP/work" bash "$STATE_DIR/update-task.sh" escaped T1 done
expect_rejected 'symlinked run plan update' env CWD="$TMP/work" bash "$STATE_DIR/update-plan-checkbox.sh" escaped task
expect_rejected 'symlinked run recovery' env CWD="$TMP/work" bash "$STATE_DIR/recover-run.sh" escaped
expect_rejected 'symlinked run sync' env CWD="$TMP/work" bash "$STATE_DIR/sync-plan-state.sh" escaped
expect_rejected 'symlinked run checkpoint' env CWD="$TMP/work" bash "$STATE_DIR/checkpoint.sh" escaped
expect_rejected 'symlinked run validation' env CWD="$TMP/work" bash "$STATE_DIR/validate-state.sh" escaped
test ! -e "$TMP/outside/state.json" || fail 'state escaped through symlink'
test ! -e "$TMP/outside/events.jsonl" || fail 'events escaped through symlink'

mkdir -p "$TMP/root-link-work" "$TMP/root-link-outside"
ln -s "$TMP/root-link-outside" "$TMP/root-link-work/.lazybuddy"
expect_rejected 'symlinked state root' env CWD="$TMP/root-link-work" bash "$STATE_DIR/create-run.sh" root-escaped objective
test ! -e "$TMP/root-link-outside/runs" || fail 'state root escaped through symlink'

deny_output=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"rm -rf -- /"}}' | bash "$HOOK")
python3 - "$deny_output" <<'PYEOF'
import json
import sys

result = json.loads(sys.argv[1])
assert result['continue'] is False
hook = result['hookSpecificOutput']
assert hook['hookEventName'] == 'PreToolUse'
assert hook['permissionDecision'] == 'deny'
assert hook['permissionDecisionReason']
PYEOF

tmp_deny_output=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' | bash "$HOOK")
python3 - "$tmp_deny_output" <<'PYEOF'
import json
import sys

assert json.loads(sys.argv[1])['hookSpecificOutput']['permissionDecision'] == 'deny'
PYEOF

allow_output=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"ls -la /"}}' | bash "$HOOK")
test -z "$allow_output" || fail 'safe command was not allowed'

echo 'PASS: security matrix keeps mapped-address and residual-risk controls frozen; audit evidence redacts fixture secrets'
