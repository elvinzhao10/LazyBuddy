#!/bin/bash
# lazyworkbuddy-verify.sh — Master verification runner (v0.9)
#
# Runs all health-check scripts in sequence and emits a compact JSON summary.
# Exit code 0 when all_pass is true; exit code 1 otherwise.
#
# Usage: ./scripts/lazyworkbuddy-verify.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

SCRIPTS_DIR="${PLUGIN_ROOT}/scripts"
ALL_PASS=true
DOCTOR_RESULT="skipped (script not found or not executable)"
SMOKE_RESULT="skipped (script not found or not executable)"
DOCS_RESULT="skipped (script not found or not executable)"
PARITY_RESULT="skipped (script not found or not executable)"
SECURITY_RESULT="skipped (script not found or not executable)"

run_check() {
    local label="$1"
    local script="$2"
    local result_var="$3"
    if [ -x "$script" ]; then
        if output=$("$script" 2>&1); then
            eval "${result_var}=pass"
        else
            eval "${result_var}=fail"
            ALL_PASS=false
        fi
    fi
}

run_check "doctor"         "${SCRIPTS_DIR}/lazyworkbuddy-plugin-doctor.sh"  DOCTOR_RESULT
run_check "smoke_test"     "${SCRIPTS_DIR}/lazyworkbuddy-smoke-test.sh"     SMOKE_RESULT
run_check "docs_check"     "${SCRIPTS_DIR}/lazyworkbuddy-docs-check.sh"     DOCS_RESULT
run_check "parity_check"   "${SCRIPTS_DIR}/lazyworkbuddy-parity-check.sh"   PARITY_RESULT
run_check "security_check" "${SCRIPTS_DIR}/lazyworkbuddy-security-check.sh" SECURITY_RESULT

# Build compact JSON summary
json="{\"doctor\":\"${DOCTOR_RESULT}\",\"smoke_test\":\"${SMOKE_RESULT}\",\"docs_check\":\"${DOCS_RESULT}\",\"parity_check\":\"${PARITY_RESULT}\",\"security_check\":\"${SECURITY_RESULT}\",\"all_pass\":${ALL_PASS}}"

echo "$json"

# Auto-append verification event to active run's events.jsonl (v0.11 dogfood fix)
LATEST_RUN=""
if [ -x "${SCRIPTS_DIR}/state/latest-run.sh" ]; then
    LATEST_RUN="$("${SCRIPTS_DIR}/state/latest-run.sh" 2>/dev/null || echo "")"
fi
if [ -n "$LATEST_RUN" ]; then
    EVENTS_FILE="${CWD:-.}/.lazyworkbuddy/runs/$LATEST_RUN/events.jsonl"
    if [ -f "$EVENTS_FILE" ]; then
        NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$LATEST_RUN', 'event': 'verification_passed' if ${ALL_PASS} else 'verification_failed', 'all_pass': ${ALL_PASS}}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
" 2>/dev/null || true
    fi
fi

if [ "$ALL_PASS" = true ]; then
    exit 0
else
    exit 1
fi
