#!/usr/bin/env bash
# hook-pipeline-test.sh — Simulates the full WorkBuddy hook lifecycle by piping
# sample payloads through each hook in sequence. Proves the entire hook chain
# works end-to-end without requiring a live WorkBuddy session.
#
# This tests the gap: "Plugin hooks never triggered in a real WorkBuddy hook pipeline."
# While a true live test requires a fresh WorkBuddy session with the plugin enabled,
# this script proves every hook produces correct output for realistic payloads.
#
# Usage: bash hook-pipeline-test.sh
set -euo pipefail

CWD="${CWD:-$(pwd)}"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ ! -d "$PLUGIN_ROOT" ]; then
    echo "Hook pipeline test: FAIL (plugin root is missing: $PLUGIN_ROOT)" >&2
    exit 1
fi
HOOKS_DIR="$PLUGIN_ROOT/scripts/hooks"
RUNNER="$PLUGIN_ROOT/scripts/lazybuddy-bounded-run.py"
PYTHON_BIN="${LAZYBUDDY_PYTHON:-python3}"
if [ ! -d "$HOOKS_DIR" ]; then
    echo "Hook pipeline test: FAIL (hooks directory is missing: $HOOKS_DIR)" >&2
    exit 1
fi
export CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT"
SESSION_ID="hook-pipeline-test-$$"
STATE_DIR="$CWD/.lazybuddy/executor-verify-state"
PASS=0
FAIL=0
RESULTS=""

cleanup_retry_state() {
    rm -f "$STATE_DIR/${SESSION_ID}-a1.json" "$STATE_DIR/${SESSION_ID}-a2.json"
}

trap cleanup_retry_state EXIT
cleanup_retry_state

test_hook() {
    local name="$1"
    local payload="$2"
    local expect_pattern="$3"
    local output result_file
    local status
    result_file="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-hook-result.XXXXXX")"
    if output=$(printf '%s\n' "$payload" | "$PYTHON_BIN" "$RUNNER" --label "hook:${name}" --timeout "${LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-90}" --result-file "$result_file" -- bash "$HOOKS_DIR/$name"); then
        status=0
    else
        status=$?
    fi
    output="$("$PYTHON_BIN" - "$result_file" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["tail"])
PY
)"
    rm -f "$result_file"
    if [ "$status" -ne 0 ]; then
        RESULTS="${RESULTS}  [FAIL] $name — exited $status: ${output:0:80}\n"
        FAIL=$((FAIL + 1))
    elif [ -z "$expect_pattern" ]; then
        if [ -z "$output" ]; then
            RESULTS="${RESULTS}  [PASS] $name — allowed (empty output as expected)\n"
            PASS=$((PASS + 1))
        else
            RESULTS="${RESULTS}  [FAIL] $name — expected empty output, got: ${output:0:80}\n"
            FAIL=$((FAIL + 1))
        fi
    elif echo "$output" | grep -qi "$expect_pattern"; then
        RESULTS="${RESULTS}  [PASS] $name — matched expected pattern\n"
        PASS=$((PASS + 1))
    else
        RESULTS="${RESULTS}  [FAIL] $name — expected '$expect_pattern', got: ${output:0:80}\n"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== LazyBuddy Hook Pipeline Activation Test ==="
echo "Simulating full WorkBuddy hook lifecycle with realistic payloads..."
echo ""

# 1. SessionStart — should detect no active run and pass through
test_hook "session-start.sh" \
    '{"event":"session_start","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'"}' \
    "SESSIONSTART_READINESS=full"

# 2. UserPromptSubmit — should detect no keywords and pass through
test_hook "user-prompt-submit.sh" \
    '{"event":"user_prompt_submit","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","prompt":"hello world"}' \
    ""

# 3. UserPromptSubmit — should detect long-horizon keyword and suggest command
test_hook "user-prompt-submit.sh" \
    '{"event":"user_prompt_submit","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","prompt":"implement the auth flow for the app"}' \
    "TIP\|ultrawork\|ulw\|lazybuddy"

# 4. PreToolUse — should deny rm -rf
test_hook "pre-tool-use.sh" \
    '{"event":"pre_tool_use","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/test"}}' \
    "deny"

# 5. PreToolUse — should allow safe command (empty output)
test_hook "pre-tool-use.sh" \
    '{"event":"pre_tool_use","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","tool_name":"Bash","tool_input":{"command":"ls -la"}}' \
    ""

# 6. PostToolUse — should pass through (no active run)
test_hook "post-tool-use.sh" \
    '{"event":"post_tool_use","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","tool_name":"Read","tool_input":{"file_path":"README.md"}}' \
    ""

# 7. PostToolUseFailure — should pass through
test_hook "post-tool-use-failure.sh" \
    '{"event":"post_tool_use_failure","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","tool_name":"Bash","error":"command not found"}' \
    ""

# 8. PreCompact — should pass through
test_hook "pre-compact.sh" \
    '{"event":"pre_compact","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'"}' \
    ""

# 9. TaskCreated — should pass through
test_hook "task-created.sh" \
    '{"event":"task_created","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","task_id":"T1"}' \
    ""

# 10. TaskCompleted — should pass through
test_hook "task-completed.sh" \
    '{"event":"task_completed","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","task_id":"T1"}' \
    ""

# 11. SubagentStart — should pass through
test_hook "subagent-start.sh" \
    '{"event":"subagent_start","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","agent_id":"a1","agent_type":"explorer"}' \
    ""

# 12. StopFailure — should pass through
test_hook "stop-failure.sh" \
    '{"event":"stop_failure","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'"}' \
    "lazy-start-work"

# 13. Stop — no active run, should allow (empty output)
test_hook "stop-gate.sh" \
    '{"event":"stop","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","stop_hook_active":false,"transcript_path":"/dev/null"}' \
    ""

# 14. Stop with context pressure — should pass through
test_hook "stop-gate.sh" \
    '{"event":"stop","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","stop_hook_active":false,"transcript_path":"/dev/null","prompt":"context compacted"}' \
    ""

# 15. SubagentStop — non-implementer, should allow
test_hook "subagent-stop.sh" \
    '{"event":"subagent_stop","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","agent_id":"a1","agent_type":"reviewer","last_assistant_message":"review done","transcript_path":"/dev/null"}' \
    ""

# 16. SubagentStop — implementer with no evidence, should block
test_hook "subagent-stop.sh" \
    '{"event":"subagent_stop","cwd":"'"$CWD"'","session_id":"'"$SESSION_ID"'","agent_id":"a2","agent_type":"implementer","last_assistant_message":"done","transcript_path":"/dev/null"}' \
    "continue.*false\|block"

result_file="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-lifecycle-result.XXXXXX")"
if "$PYTHON_BIN" "$RUNNER" --label "hook:lifecycle-event-boundary" --timeout "${LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-90}" --result-file "$result_file" -- node --test "$PLUGIN_ROOT/tests/hook-lifecycle-pipeline.test.js" >/dev/null 2>&1; then
    RESULTS="${RESULTS}  [PASS] lifecycle-event.js — all 13 added events normalized\n"
    PASS=$((PASS + 1))
else
    output="$("$PYTHON_BIN" - "$result_file" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["tail"])
PY
)"
    RESULTS="${RESULTS}  [FAIL] lifecycle-event.js — ${output:0:80}\n"
    FAIL=$((FAIL + 1))
fi
rm -f "$result_file"

echo -e "$RESULTS"
echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""
if [ "$FAIL" -eq 0 ]; then
    echo "Hook pipeline test: ALL PASS"
    echo ""
    echo "All 25 hook events produce correct output for realistic payloads."
    echo "Package-level hook behavior passed; live host registration remains unchecked."
    exit 0
else
    echo "Hook pipeline test: $FAIL FAILURES"
    exit 1
fi
