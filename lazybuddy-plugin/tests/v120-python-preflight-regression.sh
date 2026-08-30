#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RUNNER="$PLUGIN_ROOT/scripts/lazybuddy-bounded-run.py"
VERIFY="$PLUGIN_ROOT/scripts/lazybuddy-verify.sh"
PYTHON_BIN="$(command -v "${LAZYBUDDY_TEST_PYTHON:-${LAZYBUDDY_PYTHON:-python3}}")"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-python-preflight.XXXXXX")"
REMEDIATION='ERROR: LazyBuddy requires Python 3.10 or newer. Install Python 3.10+ and make it available as python3.'

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

make_version_shim() {
    local directory="$1"
    mkdir -p "$directory"
    cat >"$directory/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-c" ]; then
    printf '%s\n' "$LAZYBUDDY_SHIM_VERSION"
    exit 0
fi
if [ "${1:-}" = "$LAZYBUDDY_RUNNER_PATH" ]; then
    : >"$LAZYBUDDY_RUNNER_SENTINEL"
    exit 97
fi
exec "$LAZYBUDDY_TEST_PYTHON" "$@"
SH
    chmod +x "$directory/python3"
}

assert_supported_version_reaches_runner() {
    local version="$1"
    local directory="$TMP/python-$version-bin"
    local sentinel="$TMP/python-$version-ran-runner"
    local output status
    make_version_shim "$directory"
    set +e
    output="$(
        PATH="$directory:$PATH" \
        LAZYBUDDY_PYTHON=python3 \
        LAZYBUDDY_RUNNER_PATH="$RUNNER" \
        LAZYBUDDY_RUNNER_SENTINEL="$sentinel" \
        LAZYBUDDY_SHIM_VERSION="${version/./ }" \
        LAZYBUDDY_TEST_PYTHON="$PYTHON_BIN" \
        LAZYBUDDY_VERIFY_SUITE=core \
        LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 \
        bash "$VERIFY" 2>&1
    )"
    status=$?
    set -e
    test -e "$sentinel" || fail "Python $version did not reach the bounded runner"
    test "$output" != "$REMEDIATION" || fail "Python $version was rejected by the preflight"
    test "$status" -ne 2 || fail "Python $version exited at the preflight"
}

"$PYTHON_BIN" "$RUNNER" --label python-baseline --timeout 3 \
    --result-file "$TMP/baseline-result.json" -- bash -c 'exit 0' \
    >"$TMP/baseline.stdout" 2>"$TMP/baseline.stderr" \
    || fail 'supported Python did not reach the existing bounded runner'
"$PYTHON_BIN" - "$TMP/baseline-result.json" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "pass", result
assert result["reason"] == "ok", result
PY

printf 'PASS: supported Python reaches the existing bounded runner\n'

mkdir -p "$TMP/python-3.9-bin" "$TMP/python-3.12-bin"
cat >"$TMP/python-3.9-bin/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-c" ]; then
    printf '3 9\n'
    exit 0
fi
if [ "${1:-}" = "$LAZYBUDDY_RUNNER_PATH" ]; then
    : >"$LAZYBUDDY_RUNNER_SENTINEL"
    exit 97
fi
exec "$LAZYBUDDY_TEST_PYTHON" "$@"
SH
chmod +x "$TMP/python-3.9-bin/python3"

set +e
python_39_output="$(
    PATH="$TMP/python-3.9-bin:$PATH" \
    LAZYBUDDY_PYTHON=python3 \
    LAZYBUDDY_RUNNER_PATH="$RUNNER" \
    LAZYBUDDY_RUNNER_SENTINEL="$TMP/python-3.9-ran-runner" \
    LAZYBUDDY_TEST_PYTHON="$PYTHON_BIN" \
    LAZYBUDDY_VERIFY_SUITE=core \
    LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 \
    bash "$VERIFY" 2>&1
)"
python_39_status=$?
set -e
test "$python_39_status" -eq 2 || fail 'Python 3.9 did not return the preflight status'
test "$python_39_output" = "$REMEDIATION" || fail 'Python 3.9 did not return the stable remediation'
test ! -e "$TMP/python-3.9-ran-runner" || fail 'Python 3.9 reached the bounded runner'

set +e
missing_output="$(LAZYBUDDY_PYTHON="$TMP/missing-python" bash "$VERIFY" 2>&1)"
missing_status=$?
set -e
test "$missing_status" -eq 2 || fail 'missing selected Python did not return the preflight status'
test "$missing_output" = "$REMEDIATION" || fail 'missing selected Python did not return the stable remediation'

cat >"$TMP/python-3.12-bin/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-c" ]; then
    printf '3 12\n'
    exit 0
fi
if [ "${1:-}" = "$LAZYBUDDY_RUNNER_PATH" ]; then
    : >"$LAZYBUDDY_RUNNER_SENTINEL"
fi
exec "$LAZYBUDDY_TEST_PYTHON" "$@"
SH
chmod +x "$TMP/python-3.12-bin/python3"

set +e
python_312_output="$(
    PATH="$TMP/python-3.12-bin:$PATH" \
    LAZYBUDDY_PYTHON=python3 \
    LAZYBUDDY_RUNNER_PATH="$RUNNER" \
    LAZYBUDDY_RUNNER_SENTINEL="$TMP/python-3.12-ran-runner" \
    LAZYBUDDY_TEST_PYTHON="$PYTHON_BIN" \
    LAZYBUDDY_VERIFY_SUITE=core \
    LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 \
    bash "$VERIFY" 2>&1
)"
python_312_status=$?
set -e
test -e "$TMP/python-3.12-ran-runner" || fail 'Python 3.12 did not reach the bounded runner'
test "$python_312_output" != "$REMEDIATION" || fail 'Python 3.12 was rejected by the preflight'
test "$python_312_status" -ne 2 || fail 'Python 3.12 exited at the preflight'

assert_supported_version_reaches_runner 3.10
assert_supported_version_reaches_runner 4.0

printf 'PASS: Python preflight rejects 3.9 before parsing and admits Python 3.10+\n'

AGGREGATE_FIXTURE="$TMP/aggregate-fixture"
AGGREGATE_TMP="$TMP/aggregate-tmp"
mkdir -p "$AGGREGATE_FIXTURE/scripts" "$AGGREGATE_TMP" "$TMP/path-spoof-bin"
cp "$VERIFY" "$AGGREGATE_FIXTURE/scripts/lazybuddy-verify.sh"
cp -R "$PLUGIN_ROOT/tests" "$AGGREGATE_FIXTURE/tests"
cat >"$AGGREGATE_FIXTURE/scripts/lazybuddy-bounded-run.py" <<'PY'
import json
import subprocess
import sys

arguments = sys.argv[1:]
result_file = arguments[arguments.index("--result-file") + 1]
command = arguments[arguments.index("--") + 1:]
completed = subprocess.run(command, capture_output=True, text=True, check=False)
with open(result_file, "w", encoding="utf-8") as handle:
    json.dump({
        "status": "pass" if completed.returncode == 0 else "fail",
        "reason": "ok" if completed.returncode == 0 else "exit_nonzero",
        "tail": completed.stdout + completed.stderr,
    }, handle)
raise SystemExit(completed.returncode)
PY
for check_script in \
    lazybuddy-smoke-test.sh \
    lazybuddy-docs-check.sh \
    lazybuddy-security-check.sh \
    lazybuddy-mcp-test.sh \
    hook-pipeline-test.sh \
    lazybuddy-load-check.sh \
    lazybuddy-contract-check.sh; do
    printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$AGGREGATE_FIXTURE/scripts/$check_script"
    chmod +x "$AGGREGATE_FIXTURE/scripts/$check_script"
done
cat >"$AGGREGATE_FIXTURE/scripts/lazybuddy-plugin-doctor.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
python3 -c 'import os, sys; assert os.path.realpath(sys.executable) == os.path.realpath(os.environ["LAZYBUDDY_EXPECTED_PYTHON"])'
SH
chmod +x "$AGGREGATE_FIXTURE/scripts/lazybuddy-plugin-doctor.sh"

cat >"$TMP/path-spoof-bin/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
: >"${LAZYBUDDY_PATH_SPOOF_MARKER:?}"
exec "${LAZYBUDDY_TEST_PYTHON:?}" "$@"
SH
chmod +x "$TMP/path-spoof-bin/python3"

for run in 1 2; do
    set +e
    TMPDIR="$AGGREGATE_TMP" \
    PATH="$TMP/path-spoof-bin:$PATH" \
    LAZYBUDDY_PATH_SPOOF_MARKER="$TMP/path-spoof-used" \
    LAZYBUDDY_PYTHON="$PYTHON_BIN" \
    LAZYBUDDY_TEST_PYTHON="$PYTHON_BIN" \
    LAZYBUDDY_EXPECTED_PYTHON="$PYTHON_BIN" \
    CODEBUDDY_PLUGIN_ROOT="$AGGREGATE_FIXTURE" \
    LAZYBUDDY_VERIFY_SUITE=core \
    LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1 \
    bash "$AGGREGATE_FIXTURE/scripts/lazybuddy-verify.sh" >"$TMP/aggregate-$run.out" 2>"$TMP/aggregate-$run.err"
    aggregate_status=$?
    set -e
    test "$aggregate_status" -eq 0 || fail "aggregate selected-Python propagation probe $run failed"
    grep -Fq '"all_pass":true' "$TMP/aggregate-$run.out" || fail "aggregate selected-Python propagation probe $run did not pass"
    if grep -Fq 'SyntaxError' "$TMP/aggregate-$run.out" "$TMP/aggregate-$run.err"; then
        fail "aggregate selected-Python propagation probe $run emitted SyntaxError"
    fi
done
test ! -e "$TMP/path-spoof-used" || fail 'aggregate child used PATH python3 instead of the selected interpreter'
if find "$AGGREGATE_TMP" -mindepth 1 -print -quit | grep -q .; then
    fail 'aggregate left a private Python or result directory behind'
fi

printf 'PASS: aggregate children use selected Python instead of PATH python3\n'
printf 'PASS: repeated aggregate invocation removes private interpreter roots\n'
