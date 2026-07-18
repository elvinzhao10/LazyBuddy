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

# Given the complete standalone inventory, when the aggregate verifier assigns
# runner budgets, then only v015 readiness may exceed the 90-second default and
# a controlled global-120 mutation must be rejected by the same policy check.
if python3 - "$FIXTURE" "$TMP" >"$TMP/timeout-policy.out" 2>"$TMP/timeout-policy.stderr" <<'PY'
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

fixture = Path(sys.argv[1])
tmp = Path(sys.argv[2])
fake_runner = '''import json
import os
import sys

args = sys.argv[1:]
def option(name):
    try:
        return args[args.index(name) + 1]
    except (ValueError, IndexError) as error:
        raise SystemExit(f"missing runner option: {name}") from error

label = option("--label")
timeout = option("--timeout")
result_file = option("--result-file")
with open(os.environ["LAZYBUDDY_TIMEOUT_CAPTURE"], "a", encoding="utf-8") as handle:
    handle.write(f"{label}\\t{timeout}\\n")
with open(result_file, "w", encoding="utf-8") as handle:
    json.dump({"status": "pass", "reason": "ok", "tail": ""}, handle)
print(f"PASS: {label}", file=sys.stderr)
'''


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def capture_policy(name, mutate=False):
    root = tmp / name
    shutil.copytree(fixture, root)
    verify = root / "scripts" / "lazybuddy-verify.sh"
    if mutate:
        source = verify.read_text(encoding="utf-8")
        old = 'test_timeout="$VERIFY_TIMEOUT"'
        new = 'test_timeout="$READINESS_REGRESSION_TIMEOUT"'
        require(source.count(old) == 1, "controlled timeout mutation target changed")
        verify.write_text(source.replace(old, new, 1), encoding="utf-8")
    (root / "scripts" / "lazybuddy-bounded-run.py").write_text(fake_runner, encoding="utf-8")
    capture = root / "timeouts.tsv"
    env = os.environ.copy()
    env.pop("LAZYBUDDY_VERIFY_TIMEOUT_SECONDS", None)
    env.update({
        "CODEBUDDY_PLUGIN_ROOT": str(root),
        "LAZYBUDDY_TIMEOUT_CAPTURE": str(capture),
        "LAZYBUDDY_VERIFY_REGRESSION_DEPTH": "0",
        "LAZYBUDDY_VERIFY_SUITE": "all",
    })
    completed = subprocess.run(
        ["bash", str(verify)],
        cwd=root.parent,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    require(completed.returncode == 0, f"policy verifier exited {completed.returncode}: {completed.stderr}")
    require(json.loads(completed.stdout)["all_pass"] is True, "policy verifier summary was not all_pass")
    return root, [line.split("\t") for line in capture.read_text(encoding="utf-8").splitlines()]


def assert_scoped_policy(root, records):
    prefix = "regression:"
    expected = {
        f"{prefix}{path.name}"
        for path in (root / "tests").glob("*-regression.sh")
        if path.name != "publication-regression.sh"
    }
    observed = [(label, timeout) for label, timeout in records if label.startswith(prefix)]
    require(len(observed) == len(expected), "standalone regression timeout capture was incomplete or duplicated")
    by_label = dict(observed)
    require(set(by_label) == expected, "standalone regression timeout labels did not match the complete inventory")
    readiness = f"{prefix}v015-readiness-regression.sh"
    require(by_label[readiness] == "120", f"{readiness} expected 120, observed {by_label[readiness]}")
    for label in sorted(expected - {readiness}):
        require(by_label[label] == "90", f"{label} expected 90, observed {by_label[label]}")
    return len(expected) - 1


production_root, production_records = capture_policy("timeout-policy-production")
other_count = assert_scoped_policy(production_root, production_records)
print("READINESS_TIMEOUT=120")
print(f"OTHER_STANDALONE_TIMEOUT=90 COUNT={other_count}")

mutant_root, mutant_records = capture_policy("timeout-policy-global-120-mutant", mutate=True)
try:
    assert_scoped_policy(mutant_root, mutant_records)
except RuntimeError as error:
    print(f"GLOBAL_120_MUTANT_REJECTED={error}")
else:
    raise RuntimeError("global-120 timeout mutant passed the scoped policy check")
PY
then
    grep -Fq 'READINESS_TIMEOUT=120' "$TMP/timeout-policy.out" \
        && pass "readiness regression receives the scoped 120-second budget" \
        || fail "readiness regression scoped timeout budget"
    grep -Fq 'OTHER_STANDALONE_TIMEOUT=90 COUNT=' "$TMP/timeout-policy.out" \
        && pass "all other standalone regressions retain the 90-second default" \
        || fail "non-readiness standalone regression timeout budget"
    grep -Fq 'GLOBAL_120_MUTANT_REJECTED=' "$TMP/timeout-policy.out" \
        && pass "global-120 standalone timeout mutant is rejected" \
        || fail "global-120 standalone timeout mutant rejection"
else
    cat "$TMP/timeout-policy.out" "$TMP/timeout-policy.stderr" >&2
    fail "standalone timeout policy probe executes"
fi
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

# Given a trusted process inspector that executes but reports failure, cleanup
# must treat inspection as unavailable instead of interpreting empty output as
# proof that no descendants remain.
python3 - "$FIXTURE/scripts/lazybuddy-bounded-run.py" <<'PY'
import importlib.util
import subprocess
import sys
from unittest import mock

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("lazybuddy_bounded_run", module_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

failed_snapshot = subprocess.CompletedProcess(["/bin/ps"], 1, stdout="", stderr="inspection failed")
with mock.patch.object(module.subprocess, "run", return_value=failed_snapshot):
    try:
        module.process_records()
    except subprocess.CalledProcessError:
        pass
    else:
        raise AssertionError("nonzero ps exit was treated as an empty successful snapshot")

invalid_snapshot = subprocess.CompletedProcess(["/bin/ps"], 0, stdout="not a process record\n", stderr="")
with mock.patch.object(module.subprocess, "run", return_value=invalid_snapshot):
    try:
        module.process_records()
    except OSError:
        pass
    else:
        raise AssertionError("invalid ps output was treated as an empty successful snapshot")

class FinishedProcess:
    pid = 424242

    @staticmethod
    def wait(timeout):
        return 0

inspection_error = subprocess.CalledProcessError(1, ["/bin/ps"])
with (
    mock.patch.object(module, "descendant_records", side_effect=inspection_error),
    mock.patch.object(module, "process_records", side_effect=inspection_error),
    mock.patch.object(module.os, "killpg", side_effect=ProcessLookupError),
):
    cleanup = module.terminate_owned_group(FinishedProcess())
assert cleanup == {
    "process_group_terminated": True,
    "detectable_descendants_remaining": True,
    "detectable_descendant_pids": [],
}
PY
pass "failed process inspection remains fail-closed"

if python3 - "$FIXTURE/scripts/lazybuddy-bounded-run.py" >"$TMP/process-inspection.out" 2>&1 <<'PY'
import importlib.util
import sys

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("lazybuddy_bounded_run_probe", module_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
module.process_records()
PY
then
    PROCESS_INSPECTION_SUPPORTED=true
else
    PROCESS_INSPECTION_SUPPORTED=false
    printf 'UNSUPPORTED: trusted process inspection is unavailable; timeout cleanup remains fail-closed\n'
fi

# Given a command whose child remains in the runner-owned process group, when
# its deadline expires, then cleanup terminates that group.
GROUP_CHILD_PID="$TMP/group-child.pid"
if CHILD_PID="$GROUP_CHILD_PID" python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label group --timeout 1 --result-file "$TMP/group.json" -- bash -c '( sleep 30 ) & printf "%s\n" "$!" > "$CHILD_PID"; sleep 30' >"$TMP/group.out" 2>"$TMP/group.stderr"; then
    fail "group timeout must fail"
else
    pass "group timeout fails"
fi
group_child_pid="$(cat "$GROUP_CHILD_PID")"
python3 - "$TMP/group.json" "$group_child_pid" "$PROCESS_INSPECTION_SUPPORTED" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "timeout"
assert payload["reason"] == "deadline_exceeded"
inspection_supported = sys.argv[3] == "true"
assert payload["cleanup"] == {
    "process_group_terminated": True,
    "detectable_descendants_remaining": not inspection_supported,
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
python3 - "$TMP/escaped.json" "$escaped_child_pid" "$PROCESS_INSPECTION_SUPPORTED" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "timeout"
inspection_supported = sys.argv[3] == "true"
assert payload["cleanup"] == {
    "process_group_terminated": True,
    "detectable_descendants_remaining": True,
    "detectable_descendant_pids": [int(sys.argv[2])] if inspection_supported else [],
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
