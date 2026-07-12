#!/bin/bash
# lazybuddy-verify.sh — Master verification runner (v0.15.0-alpha.3)
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

run_check() {
    local script="$1"
    local result_var="$2"
    if [ -x "$script" ]; then
        if output=$("$script" 2>&1); then
            eval "${result_var}=pass"
        else
            eval "${result_var}=fail"
            ALL_PASS=false
        fi
    else
        eval "${result_var}=fail"
        ALL_PASS=false
    fi
}

run_hook_pipeline_check() {
    local script="$1"
    local result_var="$2"
    local hook_root=""
    if [ ! -x "$script" ]; then
        ALL_PASS=false
        return
    fi
    hook_root=$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-hook.XXXXXX") || {
        eval "${result_var}=fail"
        ALL_PASS=false
        return
    }
    if ln -s "${PLUGIN_ROOT}" "${hook_root}/lazybuddy-plugin" 2>/dev/null; then
        if output=$(CWD="${hook_root}" CODEBUDDY_PLUGIN_ROOT="${PLUGIN_ROOT}" "$script" 2>&1); then
            eval "${result_var}=pass"
        else
            eval "${result_var}=fail"
            ALL_PASS=false
        fi
    else
        eval "${result_var}=fail"
        ALL_PASS=false
    fi
    rm -rf "${hook_root}"
}

run_check "${SCRIPTS_DIR}/lazybuddy-plugin-doctor.sh"  DOCTOR_RESULT
run_check "${SCRIPTS_DIR}/lazybuddy-smoke-test.sh"     SMOKE_RESULT
run_check "${SCRIPTS_DIR}/lazybuddy-docs-check.sh"     DOCS_RESULT
run_check "${SCRIPTS_DIR}/lazybuddy-security-check.sh" SECURITY_RESULT
run_check "${SCRIPTS_DIR}/lazybuddy-mcp-test.sh"       MCP_RESULT
run_hook_pipeline_check "${SCRIPTS_DIR}/hook-pipeline-test.sh" HOOK_RESULT
run_check "${SCRIPTS_DIR}/lazybuddy-load-check.sh" LOAD_RESULT

# Build compact JSON summary
json="{\"doctor\":\"${DOCTOR_RESULT}\",\"smoke\":\"${SMOKE_RESULT}\",\"docs\":\"${DOCS_RESULT}\",\"security\":\"${SECURITY_RESULT}\",\"mcp_test\":\"${MCP_RESULT}\",\"hook_pipeline\":\"${HOOK_RESULT}\",\"load_check\":\"${LOAD_RESULT}\",\"all_pass\":${ALL_PASS}}"

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
