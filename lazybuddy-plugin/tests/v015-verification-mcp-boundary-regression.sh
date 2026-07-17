#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-verification-mcp.XXXXXX")"
PROJECT="$TMP/project"
OUTSIDE="$TMP/outside"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$PROJECT/.lazybuddy/runs/safe" "$PROJECT/.lazybuddy/runs" "$OUTSIDE"
printf '%s\n' '{"run_id":"safe","status":"active","tasks":[{"id":"T1","title":"quoted field fixture","status":"queued"}],"verification_gates":[{"name":"in-root","status":"passed"}]}' > "$PROJECT/.lazybuddy/runs/safe/state.json"
printf '%s\n' '{"event":"safe"}' > "$PROJECT/.lazybuddy/runs/safe/events.jsonl"
printf '%s\n' '{"run_id":"outside","status":"escaped","tasks":[{"status":"failed"}],"verification_gates":[{"name":"outside-secret","status":"passed"}]}' > "$OUTSIDE/state.json"
printf '%s\n' '{"event":"outside-secret"}' > "$OUTSIDE/events.jsonl"
ln -s "$OUTSIDE" "$PROJECT/.lazybuddy/runs/link"

request() {
    local method="$1" run_id="$2"
    python3 - "$method" "$run_id" <<'PYEOF'
import json
import sys

print(json.dumps({
    "jsonrpc": "2.0",
    "id": 15,
    "method": "tools/call",
    "params": {"name": sys.argv[1], "arguments": {"run_id": sys.argv[2]}},
}))
PYEOF
}

rpc() {
    local method="$1" run_id="$2"
    request "$method" "$run_id" | CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" bash "$PLUGIN/mcp/verification/server.sh" 2>"$TMP/stderr"
}

record_gate() {
    python3 <<'PYEOF' | CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" bash "$PLUGIN/mcp/verification/server.sh" 2>"$TMP/stderr"
import json

print(json.dumps({
    "jsonrpc": "2.0",
    "id": 16,
    "method": "tools/call",
    "params": {
        "name": "record_gate_result",
        "arguments": {
            "run_id": "safe",
            "gate_name": "mcp-boundary",
            "status": "passed",
            "result": "regression",
        },
    },
}))
PYEOF
}

check_error() {
    local label="$1" output="$2"
    if python3 - "$output" <<'PYEOF'
import json
import sys

response = json.loads(sys.argv[1])
assert response["jsonrpc"] == "2.0"
assert response["id"] == 15
assert "error" in response
assert "outside-secret" not in sys.argv[1]
PYEOF
    then
        PASS=$((PASS + 1))
        echo "PASS: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        printf '%s\n' "$output" >&2
    fi
}

check_result() {
    local label="$1" output="$2"
    if python3 - "$output" <<'PYEOF'
import json
import sys

raw = sys.argv[1]
response = json.loads(raw)
assert response["jsonrpc"] == "2.0"
assert response["id"] == 15
assert "error" not in response
assert "in-root" in raw or '"run_id": "safe"' in raw
PYEOF
    then
        PASS=$((PASS + 1))
        echo "PASS: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        printf '%s\n' "$output" >&2
    fi
}

for method in list_gate_results summarize_verification; do
    check_error "$method rejects traversal run_id" "$(rpc "$method" '../../../outside')"
    check_error "$method rejects absolute run_id" "$(rpc "$method" "$OUTSIDE")"
    check_error "$method rejects symlinked run directory" "$(rpc "$method" 'link')"
    check_result "$method returns in-root run state" "$(rpc "$method" 'safe')"
done

record_output="$(record_gate)"
if python3 - "$record_output" "$PROJECT/.lazybuddy/runs/safe/events.jsonl" <<'PYEOF'
import json
import sys

response = json.loads(sys.argv[1])
assert response["jsonrpc"] == "2.0"
assert response["id"] == 16
assert response["result"]["status"] == "ok"
assert '"mcp-boundary"' in open(sys.argv[2]).read()
PYEOF
then
    PASS=$((PASS + 1))
    echo "PASS: record_gate_result writes to the validated run"
else
    FAIL=$((FAIL + 1))
    echo "FAIL: record_gate_result writes to the validated run" >&2
    printf '%s\n' "$record_output" >&2
fi

if python3 - "$PLUGIN" "$PROJECT" <<'PYEOF'
import json
import subprocess
import sys

plugin, project = sys.argv[1:]
request_id = 'id-"line\n雪'
base_env = {"CWD": project, "CODEBUDDY_PLUGIN_ROOT": plugin}

def call(request):
    process = subprocess.run(
        ["bash", plugin + "/mcp/verification/server.sh"],
        input=json.dumps(request, ensure_ascii=False),
        text=True,
        capture_output=True,
        env={**__import__("os").environ, **base_env},
        check=False,
    )
    assert process.returncode == 0, (request, process.stderr)
    assert process.stdout.count("\n") == 1, (request, process.stdout)
    response = json.loads(process.stdout)
    assert response["id"] == request_id, response
    return response

cases = [
    {"jsonrpc": "2.0", "id": request_id, "method": "initialize"},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": "record_gate_result", "arguments": {"run_id": "safe", "gate_name": 'gate-"line\n雪', "status": "passed", "result": 'result-"line\n雪'}}},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": "list_gate_results", "arguments": {"run_id": "safe"}}},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": "summarize_verification", "arguments": {"run_id": "safe"}}},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": "run_check", "arguments": {"run_id": "safe", "task_id": "T1", "error_message": 'timeout "line\n雪'}}},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": "create_repair_task", "arguments": {"run_id": "safe", "failed_task_id": "T1", "classification": "retry"}}},
    {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": 'unknown-"line\n雪', "arguments": {}}},
    {"jsonrpc": "2.0", "id": request_id, "method": 'unknown-"line\n雪'},
]

for request in cases:
    response = call(request)
    assert "result" in response or "error" in response, response
PYEOF
then
    PASS=$((PASS + 1))
    echo "PASS: all verification responses serialize quoted IDs and user fields"
else
    FAIL=$((FAIL + 1))
    echo "FAIL: all verification responses serialize quoted IDs and user fields" >&2
fi

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
