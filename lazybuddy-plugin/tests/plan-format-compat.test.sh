#!/usr/bin/env bash
# plan-format-compat.test.sh
#
# Plan-format compatibility battery for LazyBuddy sync-plan-state.sh /
# update-plan-checkbox.sh (run 20260914-1132 / task T4). Exercises the
# heading-compat fix (## TODOs canonical + legacy ## Todos) and the zero-task
# guard, plus the update-plan-checkbox multiple-match listing.
#
# Uses ONLY temporary project directories under $TMPDIR; never touches the live run.
#
# Usage: bash lazybuddy-plugin/tests/plan-format-compat.test.sh

set -uo pipefail

# Resolve repo-relative script paths regardless of CWD.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$HERE/.." && pwd)"
SYNC="$PLUGIN_ROOT/scripts/state/sync-plan-state.sh"
UPDATE="$PLUGIN_ROOT/scripts/state/update-plan-checkbox.sh"

PASS=0
FAIL=0
FAILURES=()

ok()   { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
bad()  { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "  [FAIL] $1"; }

# make_run <plan_text> <state_json>  -> prints the temp project root path
make_run() {
  local plan_text="$1" state_json="$2"
  local root; root="$(mktemp -d)"
  mkdir -p "$root/.lazybuddy/runs/r1"
  printf '%s\n' "$state_json" > "$root/.lazybuddy/runs/r1/state.json"
  printf ''               > "$root/.lazybuddy/runs/r1/events.jsonl"
  # quoted heredoc: preserves newlines exactly, no word-splitting
  printf '%s\n' "$plan_text" > "$root/.lazybuddy/runs/r1/plan.md"
  printf '%s' "$root"
}

# run_sync <root>  -> echoes "exit=<n>|<stdout+stderr>"
run_sync() {
  local root="$1"
  local out; out="$(cd "$root" && bash "$SYNC" r1 2>&1)"; local rc=$?
  printf '%s|%s' "$rc" "$out"
}

# Assert that sync-plan-state.sh exits 0 and reports N checkboxes parsed.
expect_sync_ok() {
  local name="$1" root="$2" expected_count="$3"
  local res; res="$(run_sync "$root")"
  local rc="${res%%|*}" body="${res#*|}"
  if [ "$rc" != "0" ]; then
    bad "$name: expected exit 0, got $rc (body: $body)"
  elif ! printf '%s' "$body" | grep -q "plan: $expected_count checkboxes"; then
    bad "$name: expected '$expected_count checkboxes' in output, got: $body"
  else
    ok "$name"
  fi
  rm -rf "$root"
}

# Assert that sync-plan-state.sh exits non-zero and its output matches a pattern.
expect_sync_err() {
  local name="$1" root="$2" pattern="$3"
  local res; res="$(run_sync "$root")"
  local rc="${res%%|*}" body="${res#*|}"
  if [ "$rc" = "0" ]; then
    bad "$name: expected non-zero exit, got 0 (body: $body)"
  elif ! printf '%s' "$body" | grep -qE "$pattern"; then
    bad "$name: error output did not match /$pattern/ (body: $body)"
  else
    ok "$name"
  fi
  rm -rf "$root"
}

EMPTY_STATE='{"plan_reference": ".lazybuddy/runs/r1/plan.md", "progress": {}, "tasks": []}'
STATE_2T='{"plan_reference": ".lazybuddy/runs/r1/plan.md", "progress": {}, "tasks": [{"id":"T1","status":"pending"},{"id":"T2","status":"pending"}]}'

# --- Canonical plan: ## TODOs + Final Verification Wave ---
CANONICAL='# Plan

## TODOs
- [ ] T1: first task
- [ ] T2: second task
- [ ] T3: third task

## Final Verification Wave
- [ ] end to end
- [ ] all tests pass
'
expect_sync_ok "canonical ## TODOs enumerates 5 checkboxes" "$(make_run "$CANONICAL" "$EMPTY_STATE")" 5

# --- Legacy plan: ## Todos (legacy task heading) + canonical verification ---
# The only legacy variation under test is the task-section heading ("## Todos").
# The verification heading stays canonical "Final Verification Wave" (the task
# requires exact-case acceptance of "## Todos" only, not arbitrary casing).
LEGACY='# Plan

## Todos
- [ ] T1: first task
- [ ] T2: second task
- [ ] T3: third task

## Final Verification Wave
- [ ] end to end
- [ ] all tests pass
'
expect_sync_ok "legacy ## Todos enumerates 5 checkboxes (same tasks)" "$(make_run "$LEGACY" "$EMPTY_STATE")" 5

# --- duplicate task id -> error (preserve task identity) ---
DUP='## TODOs
- [ ] T1: first task
- [ ] T1: duplicate task
'
expect_sync_err "duplicate task id errors" "$(make_run "$DUP" "$EMPTY_STATE")" "duplicate task id 'T1'"

# --- missing task id in TODOs section -> error ---
MISSING='## TODOs
- [ ] a task with no id prefix
'
expect_sync_err "missing task id in TODOs errors" "$(make_run "$MISSING" "$EMPTY_STATE")" "missing a task id"

# --- empty-section (recognized heading, no checkboxes) -> zero-task guard ---
EMPTYSEC='# Plan
## TODOs
Some prose but no checkboxes here.
'
expect_sync_err "empty-section triggers zero-task guard" "$(make_run "$EMPTYSEC" "$EMPTY_STATE")" "no checkboxes parsed"

# --- unrecognized heading + checkbox -> zero-task guard ---
BADHEAD='## Tasks
- [ ] T1: a
'
expect_sync_err "unrecognized heading triggers zero-task guard" "$(make_run "$BADHEAD" "$EMPTY_STATE")" "no checkboxes parsed"

# --- Final Verification Wave id-less checkboxes are exempt (must succeed) ---
VERIF='## Final Verification Wave
- [ ] end to end
- [ ] all tests pass
'
expect_sync_err "verification-only plan has no tasks" "$(make_run "$VERIF" "$EMPTY_STATE")" "no task checkboxes parsed"

# --- update-plan-checkbox.sh multiple-match listing ---
UP_ROOT="$(mktemp -d)"
mkdir -p "$UP_ROOT/.lazybuddy/runs/r1"
printf '%s\n' '{"plan_reference": ".lazybuddy/runs/r1/plan.md", "progress": {}, "tasks": [{"id":"T1","status":"pending","title":"implement auth"},{"id":"T2","status":"pending","title":"refactor auth"}]}' > "$UP_ROOT/.lazybuddy/runs/r1/state.json"
printf '' > "$UP_ROOT/.lazybuddy/runs/r1/events.jsonl"
printf '%s\n' '## TODOs
- [ ] T1: implement auth
- [ ] T2: refactor auth
' > "$UP_ROOT/.lazybuddy/runs/r1/plan.md"
UP_OUT="$(cd "$UP_ROOT" && bash "$UPDATE" r1 auth 2>&1)"; UP_RC=$?
if [ "$UP_RC" = "0" ]; then
  bad "update-plan-checkbox multiple-match: expected non-zero exit, got 0"
elif ! printf '%s' "$UP_OUT" | grep -q "more specific label"; then
  bad "update-plan-checkbox multiple-match: did not list matches / ask for specific label (out: $UP_OUT)"
else
  ok "update-plan-checkbox multiple-match lists all matches and asks for a more specific label"
fi
rm -rf "$UP_ROOT"

echo ""
expect_sync_err "empty plan rejected" "$(make_run '' "$EMPTY_STATE")" "no checkboxes parsed"
expect_sync_ok "nested acceptance boxes ignored" "$(make_run $'## TODOs\n- [ ] T1: work\n  - [ ] acceptance criterion' "$STATE_2T")" 1
LEGACY_ROOT="$(make_run $'## Todos\n- [x] A1. legacy work' '{"plan_reference":".lazybuddy/runs/r1/plan.md","progress":{},"tasks":[{"id":"A1","status":"pending"}]}')"
(cd "$LEGACY_ROOT" && bash "$SYNC" r1 --fix >/dev/null 2>&1)
if python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["tasks"][0]["status"] == "done"' "$LEGACY_ROOT/.lazybuddy/runs/r1/state.json"; then ok "legacy A1 reconciles state"; else bad "legacy A1 reconciles state"; fi
rm -rf "$LEGACY_ROOT"

CHECKED_ROOT="$(make_run $'## TODOs\n- [x] T1: done' '{"plan_reference":".lazybuddy/runs/r1/plan.md","tasks":[{"id":"T1","title":"done","status":"pending"}]}')"
CHECKED_BEFORE="$(cat "$CHECKED_ROOT/.lazybuddy/runs/r1/state.json")"
CHECKED_OUT="$(cd "$CHECKED_ROOT" && bash "$UPDATE" r1 T1 2>&1)"; CHECKED_RC=$?
if [ "$CHECKED_RC" != 0 ] && [[ "$CHECKED_OUT" == *"already checked"* ]] && [ "$CHECKED_BEFORE" = "$(cat "$CHECKED_ROOT/.lazybuddy/runs/r1/state.json")" ] && [ ! -s "$CHECKED_ROOT/.lazybuddy/runs/r1/events.jsonl" ]; then ok "already checked refuses without state/event mutation"; else bad "already checked refuses without state/event mutation"; fi
rm -rf "$CHECKED_ROOT"

expect_update_rejected_unchanged() {
  local name="$1" plan="$2" label="$3" pattern="$4"
  local root out rc file
  root="$(make_run "$plan" '{"plan_reference":".lazybuddy/runs/r1/plan.md","tasks":[{"id":"T1","title":"target","status":"pending"}]}')"
  for file in plan.md state.json events.jsonl; do cp "$root/.lazybuddy/runs/r1/$file" "$root/$file.before"; done
  out="$(cd "$root" && bash "$UPDATE" r1 "$label" 2>&1)"; rc=$?
  if [ "$rc" = 0 ] || ! printf '%s' "$out" | grep -qE "$pattern"; then
    bad "$name: expected actionable rejection, got $rc: $out"
  elif ! cmp -s "$root/plan.md.before" "$root/.lazybuddy/runs/r1/plan.md" || ! cmp -s "$root/state.json.before" "$root/.lazybuddy/runs/r1/state.json" || ! cmp -s "$root/events.jsonl.before" "$root/.lazybuddy/runs/r1/events.jsonl"; then
    bad "$name: rejection changed plan/state/events"
  else ok "$name"; fi
  rm -rf "$root"
}
expect_update_rejected_unchanged "missing task ID cannot update state" $'## TODOs\n- [ ] target' target 'missing a task id'
expect_update_rejected_unchanged "appendix checkbox cannot update state" $'## TODOs\n- [ ] T2: valid\n## Appendix\n- [ ] T1: target' target 'no task checkbox matching'
expect_update_rejected_unchanged "duplicate ID with different title cannot bypass validation" $'## TODOs\n- [ ] T1: target\n- [ ] T1. other' target 'duplicate task id'
expect_update_rejected_unchanged "idless final verification is not a state task" $'## TODOs\n- [ ] T2: valid\n## Final Verification Wave\n- [ ] target' target 'no task checkbox matching'
expect_update_rejected_unchanged "fenced example is not a state task" $'## TODOs\n- [ ] T2: valid\n```markdown\n- [ ] T1: target\n```' target 'no task checkbox matching'

LEGACY_UPDATE_ROOT="$(make_run $'## Todos\n- [ ]\tA1. target\n  - [ ] acceptance\n## Final Verification Wave\n- [ ] final check' '{"plan_reference":".lazybuddy/runs/r1/plan.md","tasks":[{"id":"A1","title":"different state title","status":"pending"}]}')"
if (cd "$LEGACY_UPDATE_ROOT" && bash "$UPDATE" r1 target >/dev/null) && python3 - "$LEGACY_UPDATE_ROOT/.lazybuddy/runs/r1" <<'PY'
import json
import sys
from pathlib import Path
run = Path(sys.argv[1])
assert json.loads((run / 'state.json').read_text())['tasks'][0]['status'] == 'done'
assert '- [x]\tA1. target' in (run / 'plan.md').read_text()
assert '- [ ] acceptance' in (run / 'plan.md').read_text()
assert '- [ ] final check' in (run / 'plan.md').read_text()
assert len((run / 'events.jsonl').read_text().splitlines()) == 1
PY
then ok "legacy task update uses identity and preserves verification criteria"; else bad "legacy task update uses identity and preserves verification criteria"; fi
rm -rf "$LEGACY_UPDATE_ROOT"

echo "=== plan-format-compat results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
echo "ALL PASS"
exit 0
