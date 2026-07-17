#!/bin/bash
# lazybuddy-verify.sh — Master verification runner (v1.0.0)
#
# Runs all health-check scripts in sequence and emits a compact JSON summary.
# Exit code 0 when all_pass is true; exit code 1 otherwise.
#
# Usage: ./scripts/lazybuddy-verify.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

SCRIPTS_DIR="${PLUGIN_ROOT}/scripts"
RUNNER="${SCRIPTS_DIR}/lazybuddy-bounded-run.py"
PROJECT_ROOT="$(cd "${PLUGIN_ROOT}/.." && pwd)"
export CODEBUDDY_PLUGIN_ROOT="${PLUGIN_ROOT}"
export CWD="${CWD:-${PROJECT_ROOT}}"
ALL_PASS=true
DOCTOR_RESULT="fail"
SMOKE_RESULT="fail"
DOCS_RESULT="fail"
SECURITY_RESULT="fail"
MCP_RESULT="fail"
HOOK_RESULT="fail"
LOAD_RESULT="fail"
CONTRACT_RESULT="fail"
AUTOMATIC_TOOLING_REGRESSIONS_RESULT="fail"
AUTOMATIC_TOOLING_CONTRACT_PARITY_RESULT="not_applicable"
REGRESSION_INVENTORY_RESULT="fail"
REGRESSION_DEPTH="${LAZYBUDDY_VERIFY_REGRESSION_DEPTH:-0}"
VERIFY_TIMEOUT="${LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-90}"

if ! [[ "$REGRESSION_DEPTH" =~ ^[0-9]+$ ]]; then
    printf 'ERROR: LAZYBUDDY_VERIFY_REGRESSION_DEPTH must be a non-negative integer\n' >&2
    exit 2
fi
if ! [[ "$VERIFY_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
    printf 'ERROR: LAZYBUDDY_VERIFY_TIMEOUT_SECONDS must be a positive integer\n' >&2
    exit 2
fi

CHECK_DETAILS="{}"
record_check() {
    local name="$1" result_file="$2"
    CHECK_DETAILS="$(python3 - "$CHECK_DETAILS" "$name" "$result_file" <<'PY'
import json
import sys
details, name, path = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    result = json.load(handle)
payload = json.loads(details)
payload[name] = {key: result[key] for key in ("status", "reason")}
print(json.dumps(payload, separators=(",", ":")))
PY
)"
}

run_check() {
    local name="$1" script="$2" result_var="$3" result_file
    result_file="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-verify-result.XXXXXX")"
    if [ -x "$script" ]; then
        if python3 "$RUNNER" --label "$name" --timeout "$VERIFY_TIMEOUT" --result-file "$result_file" -- "$script"; then
            eval "${result_var}=pass"
        else
            eval "${result_var}=fail"
            ALL_PASS=false
        fi
    else
        python3 - "$result_file" <<'PY'
import json
import sys
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump({"status": "unavailable", "reason": "not_executable", "tail": ""}, handle)
PY
        printf 'FAIL: %s\n' "$name" >&2
        eval "${result_var}=fail"
        ALL_PASS=false
    fi
    record_check "$name" "$result_file"
    rm -f "$result_file"
}

run_hook_pipeline_check() {
    local name="$1" script="$2" result_var="$3"
    local hook_root=""
    if [ ! -x "$script" ]; then
        printf 'FAIL: %s\n' "$name" >&2
        ALL_PASS=false
        return
    fi
    hook_root=$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-hook.XXXXXX") || {
        eval "${result_var}=fail"
        ALL_PASS=false
        return
    }
    local result_file
    result_file="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-verify-result.XXXXXX")"
    if ln -s "${PLUGIN_ROOT}" "${hook_root}/lazybuddy-plugin" 2>/dev/null; then
        if CWD="${hook_root}" CODEBUDDY_PLUGIN_ROOT="${PLUGIN_ROOT}" python3 "$RUNNER" --label "$name" --timeout "$VERIFY_TIMEOUT" --result-file "$result_file" -- "$script"; then
            eval "${result_var}=pass"
        else
            eval "${result_var}=fail"
            ALL_PASS=false
        fi
    else
        eval "${result_var}=fail"
        ALL_PASS=false
    fi
    record_check "$name" "$result_file"
    rm -f "$result_file"
    rm -rf "${hook_root}"
}

run_isolated_test() {
    local next_depth=$((REGRESSION_DEPTH + 1))
    local result_file status
    result_file="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-regression-result.XXXXXX")"
    if LAZYBUDDY_VERIFY_REGRESSION_DEPTH="$next_depth" python3 "$RUNNER" --label "regression:$(basename "$1")" --timeout "$VERIFY_TIMEOUT" --result-file "$result_file" -- bash "$1"; then
        status=0
    else
        status=$?
        python3 - "$result_file" <<'PY' >&2
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
if result["tail"]:
    print(result["tail"], end="" if result["tail"].endswith("\n") else "\n")
PY
    fi
    rm -f "$result_file"
    return "$status"
}

run_regression_inventory() {
    local test_name test_path candidate inventory_failed=false
    local tests_dir="${PLUGIN_ROOT}/tests"
    # The normal release gate owns every package-local *-regression.sh. The
    # two explicit-root parity checks intentionally remain release-only.
    local standalone_tests=(
        "v015-consumer-agents-regression.sh"
        "v015-cwd-injection-regression.sh"
        "v015-finalize-sections-regression.sh"
        "v015-installed-root-loop-regression.sh"
        "v015-mcp-path-boundary-regression.sh"
        "v015-package-boundary-regression.sh"
        "v015-persistent-mcp-regression.sh"
        "v015-readiness-regression.sh"
        "v015-run-ledger-rpc-regression.sh"
        "v015-security-regression.sh"
        "v015-verification-mcp-boundary-regression.sh"
        "v016-tooling-policy-regression.sh"
        "v016-capability-broker-regression.sh"
        "v016-capability-detector-regression.sh"
        "v016-provider-lifecycle-regression.sh"
        "v016-package-onboarding-regression.sh"
        "v016-tooling-lifecycle-regression.sh"
        "v016-remote-capabilities-regression.sh"
        "v016-codegraph-regression.sh"
        "v016-lsp-regression.sh"
        "v016-runtime-version-regression.sh"
        "v017-capability-readiness-contract-regression.sh"
        "v017-capability-readiness-regression.sh"
        "v017-codegraph-fixture-cleanup-regression.sh"
        "v017-codegraph-install-timeout-regression.sh"
        "v017-codegraph-lifecycle-caller-survival-regression.sh"
        "v017-codegraph-uninstall-pid-identity-regression.sh"
        "v017-mcp-params-regression.sh"
        "v017-receipt-init-deep-regression.sh"
        "v018-verifier-regression.sh"
        "v018-docs-ssrf-regression.sh"
        "v018-init-deep-sibling-plugin-regression.sh"
        "v018-secret-target-regression.sh"
        "v018-coupled-work-contract-regression.sh"
        "v018-post-tool-use-injection-regression.sh"
    )
    local paired_only_tests=(
        "v016-automatic-tooling-contract-parity.sh"
        "v017-capability-readiness-contract-parity.sh"
        "v018-docs-manifest-parity.sh"
    )
    local publication_tests=(
        "publication-regression.sh"
    )

    contains_test() {
        local needle="$1"
        shift
        for candidate in "$@"; do
            [ "$candidate" = "$needle" ] && return 0
        done
        return 1
    }

    for test_name in "${standalone_tests[@]}" "${paired_only_tests[@]}" "${publication_tests[@]}"; do
        test_path="${tests_dir}/${test_name}"
        if [ ! -f "$test_path" ] || [ ! -s "$test_path" ] || ! bash -n "$test_path"; then
            printf 'ERROR: classified regression is missing, empty, or invalid: %s\n' "$test_name" >&2
            inventory_failed=true
        fi
    done

    while IFS= read -r test_path; do
        test_name="$(basename "$test_path")"
        if contains_test "$test_name" "${standalone_tests[@]}"; then
            :
        elif contains_test "$test_name" "${paired_only_tests[@]}"; then
            :
        elif contains_test "$test_name" "${publication_tests[@]}"; then
            :
        else
            printf 'ERROR: unclassified package-local regression: %s\n' "$test_name" >&2
            inventory_failed=true
        fi
    done < <(find "$tests_dir" -maxdepth 1 -type f -name '*-regression.sh' -print | LC_ALL=C sort)

    for test_name in "${standalone_tests[@]}"; do
        if contains_test "$test_name" "${paired_only_tests[@]}"; then
            printf 'ERROR: regression has conflicting classifications: %s\n' "$test_name" >&2
            inventory_failed=true
        fi
    done

    for test_name in "${publication_tests[@]}"; do
        if contains_test "$test_name" "${standalone_tests[@]}" || contains_test "$test_name" "${paired_only_tests[@]}"; then
            printf 'ERROR: regression has conflicting classifications: %s\n' "$test_name" >&2
            inventory_failed=true
        fi
    done

    if [ "$inventory_failed" = true ]; then
        REGRESSION_INVENTORY_RESULT="fail"
        AUTOMATIC_TOOLING_REGRESSIONS_RESULT="fail"
        ALL_PASS=false
        return
    fi
    REGRESSION_INVENTORY_RESULT="pass"

    if [ "$REGRESSION_DEPTH" -gt 0 ]; then
        AUTOMATIC_TOOLING_REGRESSIONS_RESULT="skipped-nested"
        return
    fi

    for test_name in "${standalone_tests[@]}"; do
        test_path="${tests_dir}/${test_name}"
        if ! run_isolated_test "$test_path"; then
            printf 'FAIL: standalone regression failed: %s\n' "$test_name" >&2
            AUTOMATIC_TOOLING_REGRESSIONS_RESULT="fail"
            ALL_PASS=false
        fi
    done

    if [ "$ALL_PASS" = true ]; then
        AUTOMATIC_TOOLING_REGRESSIONS_RESULT="pass"
    fi
}

run_check doctor "${SCRIPTS_DIR}/lazybuddy-plugin-doctor.sh"  DOCTOR_RESULT
run_check smoke "${SCRIPTS_DIR}/lazybuddy-smoke-test.sh"     SMOKE_RESULT
run_check docs "${SCRIPTS_DIR}/lazybuddy-docs-check.sh"     DOCS_RESULT
run_check security "${SCRIPTS_DIR}/lazybuddy-security-check.sh" SECURITY_RESULT
run_check mcp_test "${SCRIPTS_DIR}/lazybuddy-mcp-test.sh"       MCP_RESULT
run_hook_pipeline_check hook_pipeline "${SCRIPTS_DIR}/hook-pipeline-test.sh" HOOK_RESULT
run_check load_check "${SCRIPTS_DIR}/lazybuddy-load-check.sh" LOAD_RESULT
run_check automatic_tooling_contract "${SCRIPTS_DIR}/lazybuddy-contract-check.sh" CONTRACT_RESULT
run_regression_inventory

# Build compact JSON summary
json="{\"doctor\":\"${DOCTOR_RESULT}\",\"smoke\":\"${SMOKE_RESULT}\",\"docs\":\"${DOCS_RESULT}\",\"security\":\"${SECURITY_RESULT}\",\"mcp_test\":\"${MCP_RESULT}\",\"hook_pipeline\":\"${HOOK_RESULT}\",\"load_check\":\"${LOAD_RESULT}\",\"automatic_tooling_contract\":\"${CONTRACT_RESULT}\",\"regression_inventory\":\"${REGRESSION_INVENTORY_RESULT}\",\"automatic_tooling_regressions\":\"${AUTOMATIC_TOOLING_REGRESSIONS_RESULT}\",\"automatic_tooling_contract_parity\":\"${AUTOMATIC_TOOLING_CONTRACT_PARITY_RESULT}\",\"checks\":${CHECK_DETAILS},\"all_pass\":${ALL_PASS}}"

echo "$json"

# Auto-append verification event to active run's events.jsonl (v0.11 dogfood fix)
LATEST_RUN=""
if [ -x "${SCRIPTS_DIR}/state/latest-run.sh" ]; then
    LATEST_RUN="$("${SCRIPTS_DIR}/state/latest-run.sh" 2>/dev/null || echo "")"
fi
if [ -n "$LATEST_RUN" ]; then
    EVENTS_FILE=""
    if [[ "$LATEST_RUN" =~ ^[A-Za-z0-9._-]+$ ]]; then
        EVENTS_FILE="${CWD:-.}/.lazybuddy/runs/$LATEST_RUN/events.jsonl"
    fi
    if [ -n "$EVENTS_FILE" ] && [ -f "$EVENTS_FILE" ]; then
        NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        ALL_PASS_PY=False
        if [ "$ALL_PASS" = true ]; then
            ALL_PASS_PY=True
        fi
        python3 - "$CWD" "$EVENTS_FILE" "$LATEST_RUN" "$NOW" "$ALL_PASS_PY" <<'PY' 2>/dev/null || true
import json
import os
import sys

cwd, events_file, run_id, now, all_pass_raw = sys.argv[1:6]
root = os.path.realpath(os.path.join(cwd, ".lazybuddy", "runs"))
events_path = os.path.realpath(events_file)
try:
    inside_runs = os.path.commonpath([root, events_path]) == root
except ValueError:
    inside_runs = False
if not inside_runs or not events_path.endswith(os.path.join(run_id, "events.jsonl")):
    raise SystemExit(0)
all_pass = all_pass_raw == "True"
event = {"ts": now, "run_id": run_id, "event": "verification_passed" if all_pass else "verification_failed", "all_pass": all_pass}
with open(events_path, "a") as f:
    f.write(json.dumps(event) + "\n")
PY
    fi
fi

if [ "$ALL_PASS" = true ]; then
    exit 0
else
    exit 1
fi
