#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-verifier.XXXXXX")"
PASS=0
FAIL=0
unset CODEBUDDY_PLUGIN_ROOT CWD
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

mkdir "$TMP/lazybuddy-plugin"
mkdir -p "$TMP/.codebuddy-plugin"
cp "$PLUGIN_ROOT/../.codebuddy-plugin/marketplace.json" "$TMP/.codebuddy-plugin/marketplace.json"
# Given the former streaming fixture copy, when its consumer exits after one
# byte, then pipefail exposes tar's real write-side EPIPE failure.  The
# controlled early close makes this independent of archive size and host I/O.
if tar -C "$PLUGIN_ROOT" --exclude='tooling/node_modules' --exclude='*/__pycache__' --exclude='*.pyc' -cf - . \
    2>"$TMP/old-stream.stderr" | { IFS= read -r -n 1 _; exit 0; }; then
    old_stream_statuses=("${PIPESTATUS[@]}")
else
    old_stream_statuses=("${PIPESTATUS[@]}")
fi
if [ "${old_stream_statuses[0]}" -ne 0 ] \
    && [ "${old_stream_statuses[1]}" -eq 0 ] \
    && grep -qi 'write error' "$TMP/old-stream.stderr"; then
    pass "controlled old streaming archive reports producer EPIPE"
else
    fail "controlled old streaming archive must report producer EPIPE"
fi

if tar -C "$PLUGIN_ROOT" --exclude='tooling/node_modules' --exclude='*/__pycache__' --exclude='*.pyc' -cf "$TMP/plugin.tar" .; then
    pass "file-backed fixture archive is created"
else
    fail "file-backed fixture archive creation"
    exit 1
fi
if tar -C "$TMP/lazybuddy-plugin" -xf "$TMP/plugin.tar"; then
    pass "file-backed fixture archive extracts successfully"
else
    fail "file-backed fixture archive extraction"
    exit 1
fi
FIXTURE="$TMP/lazybuddy-plugin"
[ -f "$FIXTURE/LICENSE" ] && pass "file-backed fixture contains the source license" || fail "file-backed fixture source license"
[ ! -e "$FIXTURE/tooling/node_modules" ] && pass "verifier fixture omits unused tooling dependencies" || fail "verifier fixture must omit unused tooling dependencies"

fixture_parity() {
    local candidate="$1" report="$2"
    if diff -ru --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' "$PLUGIN_ROOT" "$candidate" >"$report"; then
        return 0
    fi
    printf 'FIXTURE_PARITY_MISMATCH: %s\n' "$candidate" >>"$report"
    return 1
}

if fixture_parity "$FIXTURE" "$TMP/fixture-parity.out"; then
    pass "file-backed fixture passes named source parity validation"
else
    cat "$TMP/fixture-parity.out" >&2
    fail "file-backed fixture source parity validation"
fi
cp -R "$FIXTURE" "$TMP/mismatched-plugin"
rm -f "$TMP/mismatched-plugin/LICENSE"
if fixture_parity "$TMP/mismatched-plugin" "$TMP/mismatched-parity.out"; then
    fail "deliberate fixture mismatch must fail named parity validation"
elif grep -Fq 'FIXTURE_PARITY_MISMATCH:' "$TMP/mismatched-parity.out" \
    && grep -Fq 'LICENSE' "$TMP/mismatched-parity.out"; then
    pass "deliberate fixture mismatch fails named parity validation"
else
    cat "$TMP/mismatched-parity.out" >&2
    fail "deliberate fixture mismatch parity failure detail"
fi
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
    paired_only = {
        "v016-automatic-tooling-contract-parity.sh",
        "v017-capability-readiness-contract-parity.sh",
        "v018-docs-manifest-parity.sh",
        "v103-lifecycle-contract-parity.sh",
        "v110-six-host-contract-parity.sh",
        "v110-six-host-contract-parity-regression.sh",
        "v110-paired-live-test-candidate.sh",
    }
    expected = {
        f"{prefix}{path.name}"
        for path in (root / "tests").glob("*-regression.sh")
        if path.name != "publication-regression.sh" and path.name not in paired_only
    }
    observed = [(label, timeout) for label, timeout in records if label.startswith(prefix)]
    require(len(observed) == len(expected), "standalone regression timeout capture was incomplete or duplicated")
    by_label = dict(observed)
    require(set(by_label) == expected, "standalone regression timeout labels did not match the complete inventory")
    require(
        not ({f"{prefix}{name}" for name in paired_only} & set(by_label)),
        "explicit-root paired-only regression was scheduled as standalone",
    )
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

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "pass" and payload["reason"] == "ok" and payload["tail"] == ""
assert payload["cleanup"]["status"] == "verified-absent"
PY
grep -q '^PASS: fast$' "$TMP/fast.stderr" && pass "fast trusted command succeeds" || fail "fast trusted command result"

# Given a trusted process inspector that executes but reports failure, cleanup
# must treat inspection as unavailable instead of interpreting empty output as
# proof that no descendants remain.
python3 - "$FIXTURE/scripts/lazybuddy-bounded-run.py" "$FIXTURE/scripts/lazybuddy_process_lifecycle.py" <<'PY'
import importlib.util
import importlib
import subprocess
import sys
from unittest import mock

module_path = sys.argv[1]
sys.path.insert(0, str(__import__('pathlib').Path(sys.argv[2]).parent))
spec = importlib.util.spec_from_file_location("lazybuddy_bounded_run", module_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
process_module = importlib.import_module("lazybuddy_bounded_process")
lifecycle_module = importlib.import_module("lazybuddy_process_lifecycle")

failed_snapshot = subprocess.CompletedProcess(["/bin/ps"], 1, stdout="", stderr="inspection failed")
with mock.patch.object(process_module.subprocess, "run", return_value=failed_snapshot):
    try:
        process_module.process_records()
    except subprocess.CalledProcessError:
        pass
    else:
        raise AssertionError("nonzero ps exit was treated as an empty successful snapshot")

invalid_snapshot = subprocess.CompletedProcess(["/bin/ps"], 0, stdout="not a process record\n", stderr="")
with mock.patch.object(process_module.subprocess, "run", return_value=invalid_snapshot):
    try:
        process_module.process_records()
    except OSError:
        pass
    else:
        raise AssertionError("invalid ps output was treated as an empty successful snapshot")

inspection_error = subprocess.CalledProcessError(1, ["/bin/ps"])
root = lifecycle_module.ProcessRecord(424242, 1, 424242, "S", "owned-start")
tracker = lifecycle_module.OwnershipTracker.establish(root, lifecycle_module.InspectionAvailable((root,)))
with mock.patch.object(process_module, "process_records", side_effect=inspection_error):
    cleanup = lifecycle_module.cleanup_owned_processes(
        tracker,
        process_module.inspect_processes,
        process_module.signal_owned_group,
    )
assert cleanup.status is lifecycle_module.CleanupStatus.INSPECTION_UNAVAILABLE
assert cleanup.tracked_pids == (424242,)
PY
pass "failed process inspection remains fail-closed"

if python3 - "$FIXTURE/scripts/lazybuddy-bounded-run.py" >"$TMP/process-inspection.out" 2>&1 <<'PY'
import importlib.util
import importlib
import sys

module_path = sys.argv[1]
sys.path.insert(0, str(__import__('pathlib').Path(module_path).parent))
spec = importlib.util.spec_from_file_location("lazybuddy_bounded_run_probe", module_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
importlib.import_module("lazybuddy_bounded_process").process_records()
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
assert payload["cleanup"]["status"] == ("verified-absent" if inspection_supported else "inspection-unavailable")
assert payload["cleanup"]["process_group_terminated"] is inspection_supported
assert payload["cleanup"]["detectable_descendants_remaining"] is (not inspection_supported)
PY
if kill -0 "$group_child_pid" 2>/dev/null; then fail "timeout left owned group child alive"; else pass "timeout terminates owned process group"; fi

# Given a child that escapes into another process group, when the parent times
# out, then the runner reports the still-detectable child but never signals it.
ESCAPED_CHILD_PID="$TMP/escaped-child.pid"
if CHILD_PID="$ESCAPED_CHILD_PID" python3 "$FIXTURE/scripts/lazybuddy-bounded-run.py" --label escaped --timeout 1 --result-file "$TMP/escaped.json" -- bash -c 'python3 -c "import os, time; os.setsid(); time.sleep(3)" & printf "%s\n" "$!" > "$CHILD_PID"; sleep 30' >"$TMP/escaped.out" 2>"$TMP/escaped.stderr"; then
    fail "escaped timeout must fail"
else
    pass "escaped timeout fails"
fi
escaped_child_pid="$(cat "$ESCAPED_CHILD_PID")"
python3 - "$TMP/escaped.json" "$escaped_child_pid" "$PROCESS_INSPECTION_SUPPORTED" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "unavailable"
assert payload["reason"] == "process_cleanup_failed"
inspection_supported = sys.argv[3] == "true"
assert payload["cleanup"]["status"] == ("verified-remaining" if inspection_supported else "inspection-unavailable")
assert payload["cleanup"]["process_group_terminated"] is False
assert payload["cleanup"]["detectable_descendants_remaining"] is True
assert payload["cleanup"]["supervisor_teardown"] == "verified-absent"
PY
if kill -0 "$escaped_child_pid" 2>/dev/null; then pass "escaped child is reported without signaling"; else fail "escaped child was signaled"; fi
grep -q '^CLEANUP: escaped status=.* detectable_descendants_remaining=true' "$TMP/escaped.stderr" && pass "stderr reports detectable escaped child" || fail "escaped child cleanup report"
for _ in $(seq 1 150); do
    if ! kill -0 "$escaped_child_pid" 2>/dev/null; then break; fi
    sleep 0.02
done
if kill -0 "$escaped_child_pid" 2>/dev/null; then fail "escaped fixture did not finish its bounded self-cleanup"; else pass "escaped fixture self-cleans without runner signaling"; fi

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
rm -f "$FIXTURE/tests/unlisted-regression.sh"

cp "$PLUGIN_ROOT/scripts/lazybuddy-plugin-doctor.sh" "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh"
mkdir "$TMP/fake-bin"
cat > "$TMP/fake-bin/codebuddy" <<'SH'
#!/usr/bin/env bash
[ -z "${FAKE_CODEBUDDY_MARKER:-}" ] || printf 'invoked\n' >> "$FAKE_CODEBUDDY_MARKER"
case "${FAKE_CODEBUDDY_MODE:-pass}" in
  pass) printf '%s\n' 'Validation successful: 0 errors' ;;
  structured-pass) printf '%s\n' 'Validation passed' '{"valid":true}' ;;
  structured-leading-failure) printf '%s\n' 'Validation failed: leading validator output' '{"valid":true}' ;;
  structured-leading-invalid) printf '%s\n' 'Invalid plugin manifest' '{"valid":true}' ;;
  structured-leading-rejected) printf '%s\n' 'Rejected plugin manifest' '{"valid":true}' ;;
  structured-leading-error) printf '%s\n' 'Error: plugin manifest could not be checked' '{"valid":true}' ;;
  structured-pass-trailing-failure)
    printf '%s\n' '{"valid":true}' 'Validation failed: trailing validator output'
    ;;
  structured-errors) printf '%s\n' 'Validation passed' '{"valid":true,"errors":["bad"]}' ;;
  structured-error-object) printf '%s\n' 'Validation passed' '{"valid":true}' '{"error":"bad"}' ;;
  pretty-embedded)
    printf '%s\n' 'Validation passed with details:' '{' '  "valid": true,' '  "errors": []' '}'
    ;;
  contradictory)
    printf '%s\n' 'Validation passed with details:' '{"valid":true}' '{"valid":false,"errors":["bad manifest"]}'
    ;;
  structured-nonzero) printf '%s\n' 'Validation passed' '{"valid":true}'; exit 9 ;;
  semantic) printf '%s\n' 'Validation failed: 2 errors' ;;
  misleading) printf '%s\n' 'Validation passed with errors: 2' ;;
  invalid-text) printf '%s\n' 'Invalid plugin manifest' ;;
  invalid-json) printf '%s\n' '{"valid":false,"errors":["bad manifest"]}' ;;
  invalid-symbol) printf '%s\n' '✘ plugin manifest rejected' ;;
  nonzero) printf '%s\n' 'validator rejected manifest'; exit 9 ;;
  timeout) sleep 30 ;;
esac
SH
chmod +x "$TMP/fake-bin/codebuddy"

mkdir "$TMP/launch-error-bin"
printf '%s\n' '#!/definitely/missing/lazybuddy-interpreter' > "$TMP/launch-error-bin/codebuddy"
chmod +x "$TMP/launch-error-bin/codebuddy"
RUNTIME_PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"

run_doctor() {
    local label="$1" host="$2" mode="$3" bin_dir="$4"
    DOCTOR_OUTPUT="$TMP/doctor-$label.out"
    if PATH="$bin_dir:$RUNTIME_PATH" \
        FAKE_CODEBUDDY_MODE="$mode" \
        FAKE_CODEBUDDY_MARKER="${DOCTOR_MARKER:-}" \
        LAZYBUDDY_DOCTOR_HOST="$host" \
        LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS=1 \
        CODEBUDDY_PLUGIN_ROOT="$FIXTURE" \
        bash "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh" >"$DOCTOR_OUTPUT" 2>"$DOCTOR_OUTPUT.err"; then
        DOCTOR_STATUS=0
    else
        DOCTOR_STATUS=$?
    fi
}

run_doctor package-pass package pass "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[PASS\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor accepts validator pass" || fail "package validator pass classification"
run_doctor package-structured-pass package structured-pass "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[PASS\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor accepts structured validator pass" || fail "package structured validator pass classification"
run_doctor package-structured-leading-failure package structured-leading-failure "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects leading validator failure text before valid JSON" || fail "package leading validator failure classification"
run_doctor package-structured-leading-invalid package structured-leading-invalid "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects leading invalid text before valid JSON" || fail "package leading invalid text classification"
run_doctor package-structured-leading-rejected package structured-leading-rejected "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects leading rejected text before valid JSON" || fail "package leading rejected text classification"
run_doctor package-structured-leading-error package structured-leading-error "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects leading error text before valid JSON" || fail "package leading error text classification"
run_doctor package-structured-pass-trailing-failure package structured-pass-trailing-failure "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects trailing validator failure text" || fail "package trailing validator failure classification"
run_doctor package-structured-errors package structured-errors "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects valid structured output with errors" || fail "package structured output with errors classification"
run_doctor package-structured-error-object package structured-error-object "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects adjacent structured error object" || fail "package adjacent structured error object classification"
run_doctor package-pretty-embedded package pretty-embedded "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[PASS\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor accepts pretty embedded validator JSON" || fail "package pretty embedded validator JSON classification"
run_doctor package-contradictory package contradictory "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects contradictory validator JSON" || fail "package contradictory validator JSON classification"
run_doctor package-structured-nonzero package structured-nonzero "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects structured validator nonzero" || fail "package structured validator nonzero classification"
run_doctor package-semantic package semantic "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor hard-fails semantic validator output" || fail "package semantic validator classification"
run_doctor package-misleading package misleading "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor rejects misleading success output" || fail "package misleading validator classification"
run_doctor package-invalid-text package invalid-text "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && grep -Fq 'Invalid plugin manifest' "$DOCTOR_OUTPUT" && pass "package doctor rejects unrecognized invalid-manifest text" || fail "package invalid-manifest text classification"
run_doctor package-invalid-json package invalid-json "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && grep -Fq '{"valid":false,"errors":["bad manifest"]}' "$DOCTOR_OUTPUT" && pass "package doctor rejects structured false validator output" || fail "package structured false validator classification"
run_doctor package-invalid-symbol package invalid-symbol "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && grep -Fq '✘ plugin manifest rejected' "$DOCTOR_OUTPUT" && pass "package doctor rejects symbolic manifest rejection" || fail "package symbolic rejection classification"
run_doctor package-nonzero package nonzero "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "package doctor hard-fails validator nonzero" || fail "package nonzero validator classification"
run_doctor package-timeout package timeout "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[UNCHECKED\] CodeBuddy manifest validator.*timeout' "$DOCTOR_OUTPUT" && grep -q '^TIMEOUT: CodeBuddy manifest validator$' "$DOCTOR_OUTPUT.err" && pass "package doctor leaves validator timeout unchecked" || fail "package timeout validator classification"
run_doctor package-launch package pass "$TMP/launch-error-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[UNCHECKED\] CodeBuddy manifest validator.*unavailable' "$DOCTOR_OUTPUT" && pass "package doctor leaves validator launch unavailable unchecked" || fail "package launch validator classification"
run_doctor package-absent package pass "$TMP/empty-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[UNCHECKED\] CodeBuddy manifest validator.*CLI unavailable' "$DOCTOR_OUTPUT" && pass "package doctor leaves absent CLI unchecked" || fail "package absent validator classification"

run_doctor cli-pass codebuddy-cli pass "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[PASS\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "CLI doctor accepts validator pass" || fail "CLI validator pass classification"
run_doctor cli-semantic codebuddy-cli semantic "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && pass "CLI doctor hard-fails semantic validator output" || fail "CLI semantic validator classification"
run_doctor cli-timeout codebuddy-cli timeout "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator.*timeout' "$DOCTOR_OUTPUT" && pass "CLI doctor hard-fails validator timeout" || fail "CLI timeout validator classification"
run_doctor cli-launch codebuddy-cli pass "$TMP/launch-error-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator.*unavailable' "$DOCTOR_OUTPUT" && pass "CLI doctor hard-fails validator launch unavailable" || fail "CLI launch validator classification"
run_doctor cli-absent codebuddy-cli pass "$TMP/empty-bin"
[ "$DOCTOR_STATUS" -eq 1 ] && grep -q '\[FAIL\] CodeBuddy manifest validator.*CLI unavailable' "$DOCTOR_OUTPUT" && pass "CLI doctor hard-fails absent CLI" || fail "CLI absent validator classification"

DOCTOR_MARKER="$TMP/ide-validator.marker"
rm -f "$DOCTOR_MARKER"
run_doctor ide-skip codebuddy-ide semantic "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[SKIP\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && [ ! -e "$DOCTOR_MARKER" ] && pass "IDE doctor skips CLI-only validator" || fail "IDE validator skip classification"
DOCTOR_MARKER="$TMP/workbuddy-validator.marker"
rm -f "$DOCTOR_MARKER"
run_doctor workbuddy-skip workbuddy semantic "$TMP/fake-bin"
[ "$DOCTOR_STATUS" -eq 0 ] && grep -q '\[SKIP\] CodeBuddy manifest validator' "$DOCTOR_OUTPUT" && [ ! -e "$DOCTOR_MARKER" ] && pass "WorkBuddy doctor skips CLI-only validator" || fail "WorkBuddy validator skip classification"
unset DOCTOR_MARKER

if LAZYBUDDY_DOCTOR_HOST=unknown CODEBUDDY_PLUGIN_ROOT="$FIXTURE" bash "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh" >"$TMP/doctor-invalid-host.out" 2>"$TMP/doctor-invalid-host.err"; then
    invalid_host_status=0
else
    invalid_host_status=$?
fi
[ "$invalid_host_status" -eq 2 ] && grep -q 'LAZYBUDDY_DOCTOR_HOST must be package, codebuddy-cli, codebuddy-ide, or workbuddy' "$TMP/doctor-invalid-host.err" && pass "doctor rejects an unknown host selector" || fail "doctor unknown host selector classification"

cp -R "$FIXTURE" "$TMP/custom-skills-plugin"
cp -R "$TMP/custom-skills-plugin/skills" "$TMP/custom-skills-plugin/custom-skills"
python3 - "$TMP/custom-skills-plugin/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["skills"] = "./custom-skills/"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
if LAZYBUDDY_DOCTOR_HOST=workbuddy CODEBUDDY_PLUGIN_ROOT="$TMP/custom-skills-plugin" bash "$TMP/custom-skills-plugin/scripts/lazybuddy-plugin-doctor.sh" >"$TMP/doctor-custom-skills.out" 2>"$TMP/doctor-custom-skills.err" \
    && grep -q '\[INFO\] CodeBuddy skills: declared: 14 skill(s)' "$TMP/doctor-custom-skills.out"; then
    pass "doctor accepts a valid declared CodeBuddy skills directory"
else
    fail "doctor valid declared CodeBuddy skills classification"
fi
python3 - "$TMP/custom-skills-plugin/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["skills"] = "../"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
if LAZYBUDDY_DOCTOR_HOST=workbuddy CODEBUDDY_PLUGIN_ROOT="$TMP/custom-skills-plugin" bash "$TMP/custom-skills-plugin/scripts/lazybuddy-plugin-doctor.sh" >"$TMP/doctor-escaping-skills.out" 2>"$TMP/doctor-escaping-skills.err"; then
    fail "doctor must reject an escaping CodeBuddy skills directory"
elif grep -q '\[FAIL\] CodeBuddy skills discovery.*path escapes plugin root' "$TMP/doctor-escaping-skills.out"; then
    pass "doctor rejects an escaping CodeBuddy skills directory"
else
    fail "doctor escaping CodeBuddy skills classification"
fi

cp -R "$FIXTURE" "$TMP/broken-plugin"
rm -f "$TMP/broken-plugin/LICENSE"
if LAZYBUDDY_DOCTOR_HOST=workbuddy CODEBUDDY_PLUGIN_ROOT="$TMP/broken-plugin" LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 bash "$TMP/broken-plugin/scripts/lazybuddy-verify.sh" >"$TMP/broken-package.json" 2>"$TMP/broken-package.stderr"; then
    fail "aggregate verifier must fail an intentional package break"
else
    pass "aggregate verifier stays red for an intentional package break"
fi
if python3 - "$TMP/broken-package.json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["doctor"] == "fail"
assert payload["checks"]["doctor"]["status"] == "fail"
assert payload["regression_inventory"] == "pass"
assert payload["all_pass"] is False
PY
then
    pass "aggregate red summary identifies the doctor package failure"
else
    fail "aggregate red summary identifies the doctor package failure"
fi

STATE_RUN="$TMP/.lazybuddy/runs/legacy"
mkdir -p "$STATE_RUN"
printf '%s\n' '{"status":"created","tasks":[]}' > "$STATE_RUN/state.json"

run_state_doctor() {
    local label="$1"
    STATE_OUTPUT="$TMP/state-$label.out"
    if LAZYBUDDY_DOCTOR_HOST=workbuddy CODEBUDDY_PLUGIN_ROOT="$FIXTURE" bash "$FIXTURE/scripts/lazybuddy-plugin-doctor.sh" >"$STATE_OUTPUT" 2>"$STATE_OUTPUT.err"; then
        STATE_STATUS=0
    else
        STATE_STATUS=$?
    fi
}

printf '%s\n' '{"event":"created"}' > "$STATE_RUN/events.jsonl"
run_state_doctor valid-jsonl
[ "$STATE_STATUS" -eq 0 ] && grep -q '\[PASS\] Run state drift/evidence/boundaries' "$STATE_OUTPUT" && ! grep -q '\[WARN\].*legacy RUN_ID' "$STATE_OUTPUT" && pass "doctor accepts strict valid JSONL" || fail "valid JSONL classification"

printf '%s\n' 'RUN_ID: legacy' '{"event":"created"}' > "$STATE_RUN/events.jsonl"
cp "$STATE_RUN/events.jsonl" "$TMP/legacy-events.before"
run_state_doctor legacy-first-line
[ "$STATE_STATUS" -eq 0 ] && grep -q '\[WARN\].*legacy: events.jsonl line 1 legacy RUN_ID header preserved unchanged; not a JSON event; excluded from package-health failure' "$STATE_OUTPUT" && cmp -s "$TMP/legacy-events.before" "$STATE_RUN/events.jsonl" && pass "doctor warns and preserves a matching first-line legacy RUN_ID header" || fail "legacy first-line RUN_ID classification"

printf '%s\n' 'RUN_ID: stale-run' '{"event":"created"}' > "$STATE_RUN/events.jsonl"
run_state_doctor stale-legacy-header
[ "$STATE_STATUS" -eq 1 ] && grep -q 'events.jsonl line 1 parse error' "$STATE_OUTPUT" && pass "doctor rejects a stale mismatched RUN_ID header" || fail "stale RUN_ID header classification"

printf '%s\n' 'RANDOM_HEADER: legacy' '{"event":"created"}' > "$STATE_RUN/events.jsonl"
run_state_doctor random-header
[ "$STATE_STATUS" -eq 1 ] && grep -q 'events.jsonl line 1 parse error' "$STATE_OUTPUT" && pass "doctor rejects a random first-line header" || fail "random first-line header classification"

printf '%s\n' '{"event":"created"}' 'RUN_ID: legacy' > "$STATE_RUN/events.jsonl"
run_state_doctor legacy-second-line
[ "$STATE_STATUS" -eq 1 ] && grep -q 'events.jsonl line 2 parse error' "$STATE_OUTPUT" && pass "doctor rejects a legacy RUN_ID header after line one" || fail "legacy subsequent-line RUN_ID classification"

printf '%s\n' '{"event":' > "$STATE_RUN/events.jsonl"
run_state_doctor malformed-json
[ "$STATE_STATUS" -eq 1 ] && grep -q 'events.jsonl line 1 parse error' "$STATE_OUTPUT" && pass "doctor rejects malformed JSON events" || fail "malformed JSON event classification"

printf 'Passed: %s\nFailed: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
