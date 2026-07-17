#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-run-ledger-rpc.XXXXXX")"
PROJECT="$TMP/project"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
mkdir -p "$PROJECT"

request() {
    local id="$1" tool="$2" arguments="$3"
    python3 - "$id" "$tool" "$arguments" <<'PYEOF'
import json
import sys

print(json.dumps({
    "jsonrpc": "2.0",
    "id": json.loads(sys.argv[1]),
    "method": "tools/call",
    "params": {"name": sys.argv[2], "arguments": json.loads(sys.argv[3])},
}))
PYEOF
}

rpc() {
    local payload="$1"
    printf '%s' "$payload" | CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" \
        bash "$PLUGIN/mcp/run-ledger/server.sh" 2>"$TMP/stderr"
}

expect_error() {
    local label="$1" payload="$2" output
    output="$(rpc "$payload" || true)"
    if python3 - "$output" <<'PYEOF'
import json
import sys

lines = sys.argv[1].splitlines()
assert len(lines) == 1, lines
reply = json.loads(lines[0])
assert reply["jsonrpc"] == "2.0", reply
assert "error" in reply and "result" not in reply, reply
assert reply["error"]["code"] == -32603, reply
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

expect_result() {
    local label="$1" payload="$2" required_key="$3" output
    output="$(rpc "$payload")"
    if python3 - "$output" "$required_key" <<'PYEOF'
import json
import sys

lines = sys.argv[1].splitlines()
assert len(lines) == 1, lines
reply = json.loads(lines[0])
assert reply["jsonrpc"] == "2.0", reply
assert "result" in reply and "error" not in reply, reply
assert sys.argv[2] in reply["result"], reply
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

expect_error 'create_run returns JSON-RPC error for invalid run id' "$(request '"create-error"' create_run '{"run_id":"../../bad","objective":"objective"}')"
expect_error 'append_event returns JSON-RPC error when the run is absent' "$(request 2 append_event '{"run_id":"missing","event_type":"note"}')"
expect_error 'update_task returns JSON-RPC error when the run is absent' "$(request 3 update_task '{"run_id":"missing","task_id":"task","status":"done"}')"
expect_error 'create_checkpoint returns JSON-RPC error when the run is absent' "$(request 4 create_checkpoint '{"run_id":"missing"}')"
expect_error 'unknown quoted tool name remains valid JSON-RPC' "$(request '"quoted-id"' 'bad"tool' '{}')"

expect_result 'create_run returns a well-formed result' "$(request 6 create_run '{"run_id":"safe","objective":"Quote: \"safe\""}')" run_id
expect_result 'append_event returns a well-formed result' "$(request 7 append_event '{"run_id":"safe","event_type":"note","payload":{"message":"Quote: \"safe\""}}')" event_appended
expect_result 'create_checkpoint returns a non-empty checkpoint result' "$(request 8 create_checkpoint '{"run_id":"safe"}')" checkpoint
python3 - "$PROJECT/.lazybuddy/runs/safe/state.json" <<'PYEOF'
import json
import sys

path = sys.argv[1]
with open(path) as handle:
    state = json.load(handle)
state["tasks"] = [{"id": "task\"safe", "status": "todo"}]
with open(path, "w") as handle:
    json.dump(state, handle)
PYEOF
expect_result 'update_task serializes quoted result values' "$(request 9 update_task '{"run_id":"safe","task_id":"task\"safe","status":"done\"safe"}')" new_status

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
