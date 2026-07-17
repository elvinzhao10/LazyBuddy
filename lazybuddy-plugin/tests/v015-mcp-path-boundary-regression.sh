#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-mcp-path.XXXXXX")"
PROJECT="$TMP/project"
OUTSIDE="$TMP/outside"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$PROJECT/.lazybuddy/runs/safe" "$PROJECT/scripts/state" "$PROJECT/skills" "$OUTSIDE"
printf 'IN-ROOT-CONTENT\n' > "$PROJECT/inside.txt"
printf 'def in_root_symbol():\n    pass\n' > "$PROJECT/inside.py"
printf 'import "inside-package"\n' > "$PROJECT/main.js"
printf 'def outside_symbol():\n    pass\n' > "$OUTSIDE/secret.py"
printf 'import "outside-package"\n' > "$OUTSIDE/secret.js"
printf 'TOP-SECRET-MCP-PATH-ESCAPE\n' > "$OUTSIDE/secret.txt"
printf '# outside skill\n' > "$OUTSIDE/SKILL.md"
printf '# in-root skill\n' > "$PROJECT/skills/SKILL.md"
printf '{"run_id":"safe","status":"active","tasks":[]}' > "$PROJECT/.lazybuddy/runs/safe/state.json"
mkdir -p "$PROJECT/.lazybuddy/outside" "$PROJECT/scripts/outside"
printf '{"run_id":"escaped","status":"active","tasks":[]}' > "$PROJECT/.lazybuddy/outside/state.json"
printf '{"run_id":"escaped","status":"active","tasks":[]}' > "$PROJECT/scripts/outside/state.json"
ln -s "$OUTSIDE/secret.txt" "$PROJECT/link-secret.txt"
ln -s "$OUTSIDE/secret.py" "$PROJECT/link-secret.py"
ln -s "$OUTSIDE/secret.js" "$PROJECT/link-secret.js"
ln -s "$OUTSIDE" "$PROJECT/.lazybuddy/runs/link"
ln -s "$PROJECT/scripts/outside" "$PROJECT/scripts/state/link"

rpc_sh() {
    local server="$1" request="$2"
    printf '%s' "$request" | CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" bash "$PLUGIN/mcp/$server/server.sh"
}

rpc_py() {
    local server="$1" request="$2"
    printf '%s' "$request" | CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN" python3 "$PLUGIN/mcp/$server/server.py"
}

path_request() {
    local id="$1" tool="$2" key="$3" path="$4"
    python3 - "$id" "$tool" "$key" "$path" <<'PYEOF'
import json, sys
print(json.dumps({"jsonrpc": "2.0", "id": int(sys.argv[1]), "method": "tools/call", "params": {"name": sys.argv[2], "arguments": {sys.argv[3]: sys.argv[4]}}}))
PYEOF
}

check_rejected() {
    local label="$1" output="$2"
    if printf '%s' "$output" | grep -Eq 'outside project root|invalid or unsafe run_id'; then
        PASS=$((PASS + 1))
        echo "PASS: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        printf '%s\n' "$output" >&2
    fi
}

check_contains() {
    local label="$1" needle="$2" output="$3"
    if printf '%s' "$output" | grep -q "$needle"; then
        PASS=$((PASS + 1))
        echo "PASS: $label"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL: $label" >&2
        printf '%s\n' "$output" >&2
    fi
}

CODE_ABS="$OUTSIDE/secret.py"
check_rejected 'code-intel rejects traversal symbols' "$(rpc_py code-intel '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"symbols","arguments":{"path":"../outside/secret.py"}}}')"
check_rejected 'code-intel rejects absolute symbols' "$(rpc_py code-intel "$(path_request 7 symbols path "$CODE_ABS")")"
check_rejected 'code-intel rejects symlink symbols' "$(rpc_py code-intel '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"symbols","arguments":{"path":"link-secret.py"}}}')"
check_contains 'code-intel allows in-root symbols' 'in_root_symbol' "$(rpc_py code-intel '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"symbols","arguments":{"path":"inside.py"}}}')"
check_rejected 'code-intel rejects traversal diagnostics path' "$(rpc_py code-intel '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"diagnostics","arguments":{"path":"../outside/secret.py"}}}')"

GRAPH_ABS="$OUTSIDE/secret.js"
check_rejected 'context-graph rejects traversal file deps' "$(rpc_py context-graph '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"file_deps","arguments":{"path":"../outside/secret.js"}}}')"
check_rejected 'context-graph rejects absolute file deps' "$(rpc_py context-graph "$(path_request 11 file_deps path "$GRAPH_ABS")")"
check_rejected 'context-graph rejects symlink file deps' "$(rpc_py context-graph '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"file_deps","arguments":{"path":"link-secret.js"}}}')"
check_contains 'context-graph allows in-root file deps' 'inside-package' "$(rpc_py context-graph '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"file_deps","arguments":{"path":"main.js"}}}')"

check_rejected 'run-ledger rejects traversal state read' "$(rpc_sh run-ledger '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"read_state","arguments":{"run_id":"../outside"}}}')"
check_rejected 'run-ledger rejects symlink state read' "$(rpc_sh run-ledger '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"read_state","arguments":{"run_id":"link"}}}')"
check_contains 'run-ledger allows safe state read' '"run_id": "safe"' "$(rpc_sh run-ledger '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"read_state","arguments":{"run_id":"safe"}}}')"

check_rejected 'status-dashboard rejects traversal run id' "$(rpc_sh status-dashboard '{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"show_run_status","arguments":{"run_id":"../outside"}}}')"
check_rejected 'status-dashboard rejects symlink run id' "$(rpc_sh status-dashboard '{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"show_run_status","arguments":{"run_id":"link"}}}')"
check_contains 'status-dashboard allows safe run id' '"run_id": "safe"' "$(rpc_sh status-dashboard '{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"show_run_status","arguments":{"run_id":"safe"}}}')"

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
