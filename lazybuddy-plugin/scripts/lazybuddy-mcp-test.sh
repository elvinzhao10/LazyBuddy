#!/usr/bin/env bash
# lazybuddy-mcp-test.sh — integration test for all 8 MCP servers.
# Exercises initialize + tools/list on every server, plus one safe representative
# tool call per server. Reports pass/fail per server + tool. Exit 0 = all pass.
#
# Usage: bash lazybuddy-mcp-test.sh [repo-root]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
PLUGIN="$ROOT/lazybuddy-plugin"
export CWD="$ROOT"

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

echo "=== LazyBuddy MCP integration test (8 servers) ==="
echo ""

# ── Per-server: initialize + tools/list + one safe tool call ──

# 1. run-ledger
OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "run-ledger/initialize" "run-ledger" "$OUT"
OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "run-ledger/tools-list" "create_run" "$OUT"
OUT=$(rpc run-ledger '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_runs","arguments":{}}}')
check "run-ledger/list_runs" "runs" "$OUT"

# 2. parity
OUT=$(rpc parity '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "parity/initialize" "parity" "$OUT"
OUT=$(rpc parity '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "parity/tools-list" "list_methods" "$OUT"
OUT=$(rpc parity '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_methods","arguments":{}}}')
check "parity/list_methods" "method\|matched\|adapted" "$OUT"

# 3. verification
OUT=$(rpc verification '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "verification/initialize" "verification" "$OUT"
OUT=$(rpc verification '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "verification/tools-list" "discover_checks\|summarize" "$OUT"

# 4. source-map
OUT=$(rpc source-map '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "source-map/initialize" "source-map" "$OUT"
OUT=$(rpc source-map '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "source-map/tools-list" "list_source_paths\|index_repo" "$OUT"
OUT=$(rpc source-map '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_source_paths","arguments":{}}}')
check "source-map/list_source_paths" "reference\|source\|path" "$OUT"

# 5. status-dashboard
OUT=$(rpc status-dashboard '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "status-dashboard/initialize" "status-dashboard" "$OUT"
OUT=$(rpc status-dashboard '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "status-dashboard/tools-list" "show_parity_coverage\|show_run_status" "$OUT"

# 6. context-graph
OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "context-graph/initialize" "context-graph" "$OUT"
OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "context-graph/tools-list" "blast_radius\|symbol_search" "$OUT"
OUT=$(rpc context-graph '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"symbol_refs","arguments":{"symbol":"lazybuddy","limit":3}}}')
check "context-graph/symbol_refs" "symbol_refs\|hits" "$OUT"

# 7. code-intel
OUT=$(rpc code-intel '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "code-intel/initialize" "code-intel" "$OUT"
OUT=$(rpc code-intel '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "code-intel/tools-list" "diagnostics\|goto_definition" "$OUT"
OUT=$(rpc code-intel '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"symbols","arguments":{"path":"lazybuddy-plugin/mcp/code-intel/server.py"}}}')
check "code-intel/symbols" "symbols\|def " "$OUT"

# 8. docs
OUT=$(rpc docs '{"jsonrpc":"2.0","id":1,"method":"initialize"}')
check "docs/initialize" "docs" "$OUT"
OUT=$(rpc docs '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "docs/tools-list" "get_library_docs" "$OUT"
OUT=$(rpc docs '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_supported_registries","arguments":{}}}')
check "docs/list_registries" "npm\|pypi" "$OUT"

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
