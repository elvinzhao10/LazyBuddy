#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REPOSITORY_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-ci-suites.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cp -R "$PLUGIN_ROOT" "$TMP/plugin"
FIXTURE="$TMP/plugin"
CORE_LOG="$TMP/core.log"
REGRESSION_LOG="$TMP/regressions.log"
SENSITIVE_TESTS=(
    v015-readiness-regression.sh
    v016-tooling-lifecycle-regression.sh
    v016-codegraph-regression.sh
    v017-codegraph-fixture-cleanup-regression.sh
    v017-codegraph-install-timeout-regression.sh
    v017-codegraph-lifecycle-caller-survival-regression.sh
    v017-codegraph-uninstall-pid-identity-regression.sh
    v018-verifier-regression.sh
)

for script_name in \
    lazybuddy-plugin-doctor.sh \
    lazybuddy-smoke-test.sh \
    lazybuddy-docs-check.sh \
    lazybuddy-security-check.sh \
    lazybuddy-mcp-test.sh \
    hook-pipeline-test.sh \
    lazybuddy-load-check.sh \
    lazybuddy-contract-check.sh; do
    printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "$CORE_LOG"\n' "$script_name" > "$FIXTURE/scripts/$script_name"
    chmod +x "$FIXTURE/scripts/$script_name"
done

while IFS= read -r regression; do
    regression_name="$(basename "$regression")"
    printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "$REGRESSION_LOG"\n' "$regression_name" > "$regression"
    chmod +x "$regression"
done < <(find "$FIXTURE/tests" -maxdepth 1 -type f -name 'v*-regression.sh' -print)

: > "$CORE_LOG"
: > "$REGRESSION_LOG"
CORE_LOG="$CORE_LOG" REGRESSION_LOG="$REGRESSION_LOG" CODEBUDDY_PLUGIN_ROOT="$FIXTURE" \
    LAZYBUDDY_VERIFY_REGRESSION_DEPTH=0 LAZYBUDDY_VERIFY_SUITE=core \
    bash "$FIXTURE/scripts/lazybuddy-verify.sh" > "$TMP/core.json"
python3 - "$TMP/core.json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["suite"] == "core"
assert payload["all_pass"] is True
PY
test -s "$CORE_LOG"
for regression_name in "${SENSITIVE_TESTS[@]}"; do
    if grep -Fqx "$regression_name" "$REGRESSION_LOG"; then
        printf 'FAIL core suite ran timing-sensitive lifecycle regression: %s\n' "$regression_name" >&2
        exit 1
    fi
done

: > "$CORE_LOG"
: > "$REGRESSION_LOG"
CORE_LOG="$CORE_LOG" REGRESSION_LOG="$REGRESSION_LOG" CODEBUDDY_PLUGIN_ROOT="$FIXTURE" \
    LAZYBUDDY_VERIFY_REGRESSION_DEPTH=0 LAZYBUDDY_VERIFY_SUITE=lifecycle \
    bash "$FIXTURE/scripts/lazybuddy-verify.sh" > "$TMP/lifecycle.json"
python3 - "$TMP/lifecycle.json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["suite"] == "lifecycle"
assert payload["all_pass"] is True
PY
test ! -s "$CORE_LOG"
for regression_name in "${SENSITIVE_TESTS[@]}"; do
    grep -Fqx "$regression_name" "$REGRESSION_LOG"
done

WORKFLOW="$REPOSITORY_ROOT/.github/workflows/ci.yml"
grep -Eq '^  validate:$' "$WORKFLOW"
grep -Eq '^  lifecycle:$' "$WORKFLOW"
grep -Fq 'LAZYBUDDY_VERIFY_SUITE: core' "$WORKFLOW"
grep -Fq 'LAZYBUDDY_VERIFY_SUITE: lifecycle' "$WORKFLOW"
grep -Fq 'continue-on-error: true' "$WORKFLOW"
grep -Fq 'LAZYBUDDY_VERIFY_SUITE: all' "$REPOSITORY_ROOT/.github/workflows/release.yml"

printf 'PASS CI separates deterministic and lifecycle regression suites\n'
