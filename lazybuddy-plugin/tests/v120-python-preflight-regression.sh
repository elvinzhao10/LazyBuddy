#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RUNNER="$PLUGIN_ROOT/scripts/lazybuddy-bounded-run.py"
VERIFY="$PLUGIN_ROOT/scripts/lazybuddy-verify.sh"
PYTHON_BIN="$(command -v "${LAZYBUDDY_TEST_PYTHON:-python3}")"
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
