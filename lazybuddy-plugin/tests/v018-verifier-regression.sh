#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-verifier.XXXXXX")"
PASS=0
FAIL=0
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

cp -R "$PLUGIN_ROOT" "$TMP/plugin"
FIXTURE="$TMP/plugin"
grep -Fq 'VERIFY_TIMEOUT="${LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-90}"' "$FIXTURE/scripts/lazybuddy-verify.sh" && pass "aggregate default timeout is finite release budget" || fail "aggregate default timeout budget"
grep -Fq 'LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-90' "$FIXTURE/scripts/hook-pipeline-test.sh" && pass "hook pipeline shares finite release budget" || fail "hook pipeline default timeout budget"

# Given a short trusted package check, when it completes before its deadline,
# then the runner reports a normal pass.
python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label fast --timeout 1 --result-file "$TMP/fast.json" -- bash -c 'exit 0' >"$TMP/fast.out" 2>"$TMP/fast.stderr"
python3 - "$TMP/fast.json" <<'PY'
import json
import sys

assert json.load(open(sys.argv[1], encoding="utf-8")) == {"status": "pass", "reason": "ok", "tail": ""}
PY
grep -q '^PASS: fast$' "$TMP/fast.stderr" && pass "fast trusted command succeeds" || fail "fast trusted command result"

# Given a command whose child remains in the runner-owned process group, when
# its deadline expires, then cleanup terminates that group.
GROUP_CHILD_PID="$TMP/group-child.pid"
if CHILD_PID="$GROUP_CHILD_PID" python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label group --timeout 1 --result-file "$TMP/group.json" -- bash -c '( sleep 30 ) & printf "%s\n" "$!" > "$CHILD_PID"; sleep 30' >"$TMP/group.out" 2>"$TMP/group.stderr"; then
    fail "group timeout must fail"
else
    pass "group timeout fails"
fi
group_child_pid="$(cat "$GROUP_CHILD_PID")"
python3 - "$TMP/group.json" "$group_child_pid" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "timeout"
assert payload["reason"] == "deadline_exceeded"
assert payload["cleanup"] == {
    "process_group_terminated": True,
    "detectable_descendants_remaining": False,
    "detectable_descendant_pids": [],
}
PY
if kill -0 "$group_child_pid" 2>/dev/null; then fail "timeout left owned group child alive"; else pass "timeout terminates owned process group"; fi

# Given a child that escapes into another process group, when the parent times
# out, then the runner reports the still-detectable child but never signals it.
ESCAPED_CHILD_PID="$TMP/escaped-child.pid"
if CHILD_PID="$ESCAPED_CHILD_PID" python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label escaped --timeout 1 --result-file "$TMP/escaped.json" -- bash -c 'python3 -c "import os, time; os.setsid(); time.sleep(30)" & printf "%s\n" "$!" > "$CHILD_PID"; sleep 30' >"$TMP/escaped.out" 2>"$TMP/escaped.stderr"; then
    fail "escaped timeout must fail"
else
    pass "escaped timeout fails"
fi
escaped_child_pid="$(cat "$ESCAPED_CHILD_PID")"
python3 - "$TMP/escaped.json" "$escaped_child_pid" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "timeout"
assert payload["cleanup"] == {
    "process_group_terminated": True,
    "detectable_descendants_remaining": True,
    "detectable_descendant_pids": [int(sys.argv[2])],
}
PY
if kill -0 "$escaped_child_pid" 2>/dev/null; then pass "escaped child is reported without signaling"; else fail "escaped child was signaled"; fi
grep -q '^CLEANUP: escaped detectable_descendants_remaining=true' "$TMP/escaped.stderr" && pass "stderr reports detectable escaped child" || fail "escaped child cleanup report"
kill -KILL "$escaped_child_pid" 2>/dev/null || true

cat > "$FIXTURE/scripts/lazybuddy-smoke-test.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
( sleep 30 ) &
printf '%s\n' "$!" > "${LAZYBUDDY_CHILD_PID:?}"
sleep 30
SH
chmod +x "$FIXTURE/scripts/lazybuddy-smoke-test.sh"
for check_script in \
    lazybuddy-plugin-doctor.sh \
    lazybuddy-docs-check.sh \
    lazybuddy-security-check.sh \
    lazybuddy-mcp-test.sh \
    hook-pipeline-test.sh \
    lazybuddy-load-check.sh \
    lazybuddy-contract-check.sh; do
    printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$FIXTURE/scripts/$check_script"
    chmod +x "$FIXTURE/scripts/$check_script"
done
if CODEBUDDY_PLUGIN_ROOT="$FIXTURE" LAZYBUDDY_VERIFY_TIMEOUT_SECONDS=3 LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 LAZYBUDDY_CHILD_PID="$TMP/child.pid" bash "$FIXTURE/scripts/lazybuddy-verify.sh" >"$TMP/verify.json" 2>"$TMP/verify.stderr"; then
    fail "aggregate timeout must fail"
else
    pass "aggregate timeout fails"
fi
grep -q '^START: smoke$' "$TMP/verify.stderr" && pass "progress starts immediately" || fail "missing smoke START"
if grep -q '^TIMEOUT: smoke$' "$TMP/verify.stderr"; then
    pass "timeout is named"
else
    cat "$TMP/verify.stderr" >&2
    fail "missing named timeout"
fi
if python3 - "$TMP/verify.json" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["all_pass"] is False
assert payload["checks"]["smoke"] == {"status": "timeout", "reason": "deadline_exceeded"}
PY
then
    pass "final summary is valid fail-closed JSON"
else
    cat "$TMP/verify.stderr" >&2
    fail "final summary is valid fail-closed JSON"
fi
for _ in $(seq 1 50); do [ -f "$TMP/child.pid" ] && break; sleep 0.02; done
child_pid="$(cat "$TMP/child.pid")"
if kill -0 "$child_pid" 2>/dev/null; then fail "timeout left owned group child alive"; else pass "timeout terminates smoke process group"; fi

cat > "$FIXTURE/scripts/lazybuddy-smoke-test.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$FIXTURE/scripts/lazybuddy-smoke-test.sh"
python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label "later-check" --timeout 1 --result-file "$TMP/repeat.json" -- bash -c 'exit 0' >"$TMP/repeat.out" 2>"$TMP/repeat.stderr"
python3 - "$TMP/repeat.json" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding="utf-8"))["status"] == "pass"
PY
grep -q '^PASS: later-check$' "$TMP/repeat.stderr"
pass "independent later aggregate runs"

# Given an unversioned regression matching the package suffix, when the
# aggregate inventory runs, then it rejects the unclassified script.
cat > "$FIXTURE/tests/unlisted-regression.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$FIXTURE/tests/unlisted-regression.sh"
if CODEBUDDY_PLUGIN_ROOT="$FIXTURE" LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 bash "$FIXTURE/scripts/lazybuddy-verify.sh" >"$TMP/unclassified.json" 2>"$TMP/unclassified.stderr"; then
    fail "unversioned unclassified regression must fail inventory"
else
    pass "unversioned unclassified regression fails inventory"
fi
grep -Fq 'ERROR: unclassified package-local regression: unlisted-regression.sh' "$TMP/unclassified.stderr" && pass "unversioned regression rejection is identified" || fail "unversioned regression rejection detail"

cp "$PLUGIN_ROOT/scripts/lazybuddy-plugin-doctor.sh" "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh"
mkdir "$TMP/fake-bin"
cat > "$TMP/fake-bin/codebuddy" <<'SH'
#!/usr/bin/env bash
case "${FAKE_CODEBUDDY_MODE:-pass}" in
  pass) printf '%s\n' 'Validation successful: 0 errors' ;;
  semantic) printf '%s\n' 'Validation failed: 2 errors' ;;
  misleading) printf '%s\n' 'Validation passed with errors: 2' ;;
  nonzero) printf '%s\n' 'validator rejected manifest'; exit 9 ;;
  timeout) sleep 30 ;;
esac
SH
chmod +x "$TMP/fake-bin/codebuddy"
for mode in pass semantic misleading nonzero timeout; do
    output="$TMP/doctor-$mode.out"
    if PATH="$TMP/fake-bin:$PATH" FAKE_CODEBUDDY_MODE="$mode" LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS=1 CODEBUDDY_PLUGIN_ROOT="$FIXTURE" bash "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh" >"$output" 2>"$output.err"; then status=0; else status=$?; fi
    case "$mode" in
      pass) [ "$status" -eq 0 ] && grep -q '\[PASS\] CodeBuddy manifest validator' "$output" && pass "doctor accepts validator pass" || fail "doctor pass classification" ;;
      semantic) [ "$status" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$output" && pass "doctor hard-fails semantic validator output" || fail "doctor semantic classification" ;;
      misleading) [ "$status" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$output" && pass "doctor rejects misleading success output" || fail "doctor misleading output classification" ;;
      nonzero) [ "$status" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$output" && pass "doctor hard-fails validator nonzero" || fail "doctor nonzero classification" ;;
      timeout) [ "$status" -eq 1 ] && grep -q 'timeout' "$output" && grep -q '^TIMEOUT: CodeBuddy manifest validator$' "$output.err" && pass "doctor classifies validator timeout" || fail "doctor timeout classification" ;;
    esac
done
PATH="/usr/bin:/bin" CODEBUDDY_PLUGIN_ROOT="$FIXTURE" bash "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh" >"$TMP/doctor-absent.out" 2>"$TMP/doctor-absent.err"
grep -q '\[UNCHECKED\] CodeBuddy manifest validator' "$TMP/doctor-absent.out" && pass "doctor leaves absent CLI unchecked" || fail "doctor absent classification"
printf 'Passed: %s\nFailed: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
