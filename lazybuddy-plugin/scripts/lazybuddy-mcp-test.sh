#!/usr/bin/env bash
# Exercises initialize + tools/list on every server, plus one safe representative
# tool call per server. Reports pass/fail per server + tool. Exit 0 = all pass.
#
# Usage: bash lazybuddy-mcp-test.sh [plugin-root-or-repo-root]
set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN="$CODEBUDDY_PLUGIN_ROOT"
elif [ "$#" -gt 0 ] && [ -d "$1/.mcp.json" ]; then
    PLUGIN="$1"
elif [ "$#" -gt 0 ] && [ -d "$1/lazybuddy-plugin" ]; then
    PLUGIN="$1/lazybuddy-plugin"
else
    PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
fi
PLUGIN="$(cd "$PLUGIN" 2>/dev/null && pwd)" || {
    echo "MCP test: FAIL (plugin root is missing: ${CODEBUDDY_PLUGIN_ROOT:-$PLUGIN})" >&2
    exit 1
}
[ -f "$PLUGIN/.mcp.json" ] || {
    echo "MCP test: FAIL (missing ${PLUGIN}/.mcp.json)" >&2
    exit 1
}
export CODEBUDDY_PLUGIN_ROOT="$PLUGIN"
export CWD="${CWD:-$(pwd -P)}"

PASS=0
FAIL=0
PASS_LIST=()
FAIL_LIST=()

check() {
    # check <label> <expected_substring> <actual_json>
    local label="$1" needle="$2" hay="$3"
    if echo "$hay" | grep -qi "$needle"; then
        PASS=$((PASS+1)); PASS_LIST+=("$label")
    else
        FAIL=$((FAIL+1)); FAIL_LIST+=("$label")
        echo "  FAIL: $label (expected '$needle')" >&2
    fi
}

rpc() {
    # rpc <server> <json> -> stdout
    local server="$1" json="$2"
    printf '%s' "$json" | bash "$PLUGIN/mcp/$server/server.sh" 2>/dev/null || echo '{}'
}

check_stream_protocol() {
    local server="$1"
    if python3 - "$PLUGIN" "$server" "$CWD" <<'PYEOF'
import json
import os
import subprocess
import sys

plugin, server, cwd = sys.argv[1:]
requests = "\n".join((
    "{bad json",
    "null",
    json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}),
    json.dumps({"jsonrpc": "2.0", "id": 41, "method": "initialize"}),
    json.dumps({"jsonrpc": "2.0", "id": 42, "method": "tools/list"}),
)) + "\n"
environment = os.environ.copy()
environment["CWD"] = cwd
environment["CODEBUDDY_PLUGIN_ROOT"] = plugin
try:
    completed = subprocess.run(
        ["bash", os.path.join(plugin, "mcp", server, "server.sh")],
        input=requests,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=environment,
        timeout=10,
        check=False,
    )
except subprocess.TimeoutExpired as error:
    raise SystemExit(f"{server}: stream process timed out and was cleaned up") from error
if completed.returncode != 0:
    raise SystemExit(f"{server}: stream process exited {completed.returncode}; stderr={completed.stderr}")
try:
    responses = [json.loads(line) for line in completed.stdout.splitlines() if line]
except json.JSONDecodeError as error:
    raise SystemExit(f"{server}: stdout was not newline-delimited JSON: {error}") from error
if len(responses) != 4:
    raise SystemExit(f"{server}: expected four responses (notification is silent), got {len(responses)}: {responses}")
assert responses[0]["jsonrpc"] == "2.0"
assert responses[0]["id"] is None
assert responses[0]["error"]["code"] == -32700
assert responses[1]["jsonrpc"] == "2.0"
assert responses[1]["id"] is None
assert responses[1]["error"]["code"] == -32600
assert responses[2]["id"] == 41 and isinstance(responses[2]["result"]["serverInfo"]["name"], str)
assert responses[3]["id"] == 42 and isinstance(responses[3]["result"]["tools"], list)
PYEOF
    then
        PASS=$((PASS+1)); PASS_LIST+=("$server/stream-protocol")
    else
        FAIL=$((FAIL+1)); FAIL_LIST+=("$server/stream-protocol")
        echo "  FAIL: $server/stream-protocol" >&2
    fi
}

check_invalid_tool_params() {
    if CWD="$CWD" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" bash "$PLUGIN/tests/v017-mcp-params-regression.sh"; then
        PASS=$((PASS+1)); PASS_LIST+=("tools/call-invalid-params")
    else
        FAIL=$((FAIL+1)); FAIL_LIST+=("tools/call-invalid-params")
        echo "  FAIL: tools/call-invalid-params" >&2
    fi
}

tools_call() {
    python3 - "$1" <<'PYEOF'
import json
import sys

print(json.dumps({
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {"name": "symbols", "arguments": {"path": sys.argv[1]}},
}))
PYEOF
}

echo "=== LazyBuddy MCP integration test (6 declared servers + optional LSP endpoint) ==="
echo "Plugin root: $PLUGIN"
echo ""

OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "run-ledger/initialize" "run-ledger" "$OUT"
OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "run-ledger/tools-list" "create_run" "$OUT"
OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_runs","arguments":{}}}')
check "run-ledger/list_runs" "runs" "$OUT"

OUT=$(rpc verification '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "verification/initialize" "verification" "$OUT"
OUT=$(rpc verification '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "verification/tools-list" "discover_checks\|summarize" "$OUT"

OUT=$(rpc status-dashboard '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "status-dashboard/initialize" "status-dashboard" "$OUT"
OUT=$(rpc status-dashboard '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "status-dashboard/tools-list" "show_run_status" "$OUT"

OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "context-graph/initialize" "context-graph" "$OUT"
OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "context-graph/tools-list" "blast_radius\|symbol_search" "$OUT"
OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"symbol_refs","arguments":{"symbol":"lazybuddy","limit":3}}}')
check "context-graph/symbol_refs" "symbol_refs\|hits" "$OUT"

OUT=$(rpc code-intel '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "code-intel/initialize" "code-intel" "$OUT"
OUT=$(rpc code-intel '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "code-intel/tools-list" "diagnostics\|goto_definition" "$OUT"
CODE_INTEL_PATH="${LAZYBUDDY_MCP_TEST_CODE_PATH:-README.md}"
OUT=$(rpc code-intel "$(tools_call "$CODE_INTEL_PATH")")
if [ -f "$CWD/$CODE_INTEL_PATH" ]; then
    check "code-intel/symbols" "symbols\|def " "$OUT"
else
    check "code-intel/no-project-file" "file not found" "$OUT"
fi

OUT=$(rpc docs '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "docs/initialize" "docs" "$OUT"
OUT=$(rpc docs '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "docs/tools-list" "get_library_docs" "$OUT"
OUT=$(rpc docs '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_supported_registries","arguments":{}}}')
check "docs/list_registries" "npm\|pypi" "$OUT"

for server in run-ledger verification status-dashboard context-graph code-intel docs lsp; do
    check_stream_protocol "$server"
done
check_invalid_tool_params

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
    echo "Failed items: ${FAIL_LIST[*]}"
    echo "MCP test: FAIL"
    exit 1
fi
echo "MCP test: ALL PASS"
