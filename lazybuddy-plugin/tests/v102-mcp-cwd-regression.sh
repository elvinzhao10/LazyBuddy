#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-mcp-cwd.XXXXXX")"
CALLER="$TMP/caller dir"
PROJECT="$TMP/consumer project with spaces"
MOVED_PLUGIN="$TMP/moved release/lazybuddy-plugin"
NO_CONTEXT_CALLER="$TMP/no project context caller"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$CALLER" "$PROJECT/src" "$NO_CONTEXT_CALLER" "$(dirname -- "$MOVED_PLUGIN")"
printf 'def consumer_marker():\n    return "consumer-only"\n' > "$PROJECT/src/consumer.py"
printf 'from .consumer import consumer_marker\n' > "$PROJECT/src/main.py"
printf 'export const consumer_marker = true;\n' > "$PROJECT/src/consumer.js"
printf 'import "./consumer.js";\n' > "$PROJECT/src/main.js"
printf 'gitdir: /path/that/does/not/exist\n' > "$PROJECT/.git"
cp -R "$PLUGIN" "$MOVED_PLUGIN"

SERVERS=(run-ledger verification status-dashboard context-graph code-intel docs)

pass_case() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail_case() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

if python3 - "$PLUGIN/.mcp.json" <<'PYEOF'
import json, sys
config = json.load(open(sys.argv[1]))
servers = config["mcpServers"]
assert tuple(servers) == ("run-ledger", "verification", "status-dashboard", "context-graph", "code-intel", "docs"), servers
for name, entry in servers.items():
    assert entry["cwd"] == "${CODEBUDDY_PROJECT_DIR}", (name, entry)
    assert entry["args"] == [f"${{CODEBUDDY_PLUGIN_ROOT}}/mcp/{name}/server.sh"], (name, entry)
PYEOF
then pass_case 'all six declarations use project CWD and plugin-root launchers'; else fail_case 'all six declarations use project CWD and plugin-root launchers'; fi

assert_jsonrpc_initialize() {
    local label="$1" server="$2" output
    output="$(
        cd -- "$CALLER"
        env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
            bash "$server" <<'EOF'
{"jsonrpc":"2.0","id":"init","method":"initialize","params":{}}
EOF
    )" || { fail_case "$label (launcher failed)"; return; }
    if python3 - "$output" <<'PYEOF'
import json, sys
lines = sys.argv[1].splitlines()
assert len(lines) == 1, lines
response = json.loads(lines[0])
assert response.get("jsonrpc") == "2.0", response
assert response.get("id") == "init", response
assert "result" in response, response
PYEOF
    then pass_case "$label"; else fail_case "$label"; fi
}

for server in "${SERVERS[@]}"; do
    assert_jsonrpc_initialize "$server self-locates without CODEBUDDY_PLUGIN_ROOT" \
        "$PLUGIN/mcp/$server/server.sh"
done

for server in "${SERVERS[@]}"; do
    no_context_out="$TMP/no-context-$server.out"
    no_context_err="$TMP/no-context-$server.err"
    if [ "$server" = run-ledger ]; then
        no_context_request='{"jsonrpc":"2.0","id":"no-context","method":"tools/call","params":{"name":"create_run","arguments":{"run_id":"no-context","objective":"must fail"}}}'
    else
        no_context_request='{"jsonrpc":"2.0","id":"no-context","method":"initialize","params":{}}'
    fi
    if (
        cd -- "$NO_CONTEXT_CALLER"
        env -u CWD -u CODEBUDDY_PROJECT_DIR -u CODEBUDDY_PLUGIN_ROOT \
            bash "$PLUGIN/mcp/$server/server.sh" <<<"$no_context_request"
    ) >"$no_context_out" 2>"$no_context_err"; then
        fail_case "$server fails without project context"
    elif grep -Eiq 'project|cwd|context|required|unavailable' "$no_context_err" \
        && ! grep -q '"result"' "$no_context_out"; then
        pass_case "$server fails without project context"
        printf 'TRACE: %s stderr=%s stdout_bytes=%s\n' "$server" "$(tr '\n' ' ' < "$no_context_err")" "$(wc -c < "$no_context_out" | tr -d ' ')"
    else
        fail_case "$server reports actionable no-context failure"
    fi
done
if [ ! -e "$NO_CONTEXT_CALLER/.lazybuddy/runs/no-context" ]; then
    pass_case 'no-context run-ledger call does not write caller state'
else
    fail_case 'no-context run-ledger call does not write caller state'
fi

project_dir_output="$(
    cd -- "$CALLER"
    env -u CWD -u CODEBUDDY_PLUGIN_ROOT CODEBUDDY_PROJECT_DIR="$PROJECT" \
        bash "$PLUGIN/mcp/code-intel/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":"project-dir","method":"tools/call","params":{"name":"symbols","arguments":{"path":"src/consumer.py"}}}
EOF
)"
if printf '%s\n' "$project_dir_output" | grep -q 'consumer_marker'; then
    pass_case 'CODEBUDDY_PROJECT_DIR supplies CWD when CWD is unset'
else
    fail_case 'CODEBUDDY_PROJECT_DIR supplies CWD when CWD is unset'
fi

code_output="$(
    cd -- "$CALLER"
    env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
        bash "$PLUGIN/mcp/code-intel/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"symbols","arguments":{"path":"src/consumer.py"}}}
EOF
)"
if printf '%s\n' "$code_output" | grep -q 'consumer_marker'; then
    pass_case 'code-intel resolves consumer project with spaces'
else
    fail_case 'code-intel resolves consumer project with spaces'
fi

graph_output="$(
    cd -- "$CALLER"
    env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
        bash "$PLUGIN/mcp/context-graph/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"file_deps","arguments":{"path":"src/main.js"}}}
EOF
)"
if printf '%s\n' "$graph_output" | grep -q 'consumer'; then
    pass_case 'context-graph resolves consumer project with spaces'
else
    fail_case 'context-graph resolves consumer project with spaces'
fi

run_output="$(
    cd -- "$CALLER"
    env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
        bash "$PLUGIN/mcp/run-ledger/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_run","arguments":{"run_id":"cwd-proof","objective":"consumer context"}}}
EOF
)"
if printf '%s\n' "$run_output" | grep -q '"run_id": "cwd-proof"' \
    && [ -f "$PROJECT/.lazybuddy/runs/cwd-proof/state.json" ] \
    && [ ! -e "$CALLER/.lazybuddy/runs/cwd-proof/state.json" ]; then
    pass_case 'run-ledger writes state under explicit consumer CWD'
else
    fail_case 'run-ledger writes state under explicit consumer CWD'
fi

moved_output="$(
    cd -- "$CALLER"
    env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
        bash "$MOVED_PLUGIN/mcp/code-intel/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":"moved","method":"initialize","params":{}}
EOF
)"
if printf '%s\n' "$moved_output" | grep -q '"id": "moved"'; then
    pass_case 'moved release self-locates from its launcher path'
else
    fail_case 'moved release self-locates from its launcher path'
fi

stale_err="$TMP/stale.err"
if (
    cd -- "$CALLER"
    env CODEBUDDY_PLUGIN_ROOT="$TMP/missing release/lazybuddy-plugin" CWD="$PROJECT" \
        bash "$PLUGIN/mcp/code-intel/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":"stale","method":"initialize","params":{}}
EOF
) >"$TMP/stale.out" 2>"$stale_err"; then
    fail_case 'stale CODEBUDDY_PLUGIN_ROOT fails safely'
elif grep -Eiq 'plugin root|not found|unavailable' "$stale_err"; then
    pass_case 'stale CODEBUDDY_PLUGIN_ROOT fails safely'
else
    fail_case 'stale CODEBUDDY_PLUGIN_ROOT has actionable diagnostic'
fi

unsafe_err="$TMP/unsafe.err"
if (
    cd -- "$CALLER"
    env -u CODEBUDDY_PLUGIN_ROOT CWD="$TMP/missing consumer" \
        bash "$PLUGIN/mcp/code-intel/server.sh" <<'EOF'
{"jsonrpc":"2.0","id":"unsafe","method":"initialize","params":{}}
EOF
) >"$TMP/unsafe.out" 2>"$unsafe_err"; then
    fail_case 'missing CWD fails safely'
elif grep -Eiq 'project|cwd|directory|not found|unavailable' "$unsafe_err" \
    && ! grep -q '"result"' "$TMP/unsafe.out"; then
    pass_case 'missing CWD fails safely'
else
    fail_case 'missing CWD has actionable diagnostic'
fi

for server in "${SERVERS[@]}"; do
    malformed_output="$(
        cd -- "$CALLER"
        env -u CODEBUDDY_PLUGIN_ROOT CWD="$PROJECT" \
            bash "$PLUGIN/mcp/$server/server.sh" <<'EOF'
{not-json
{"jsonrpc":"2.0","id":"after-malformed","method":"initialize","params":{}}
EOF
    )" || { fail_case "$server survives malformed input"; continue; }
    if python3 - "$malformed_output" <<'PYEOF'
import json, sys
lines = sys.argv[1].splitlines()
assert len(lines) == 2, lines
first, second = map(json.loads, lines)
assert first.get("error", {}).get("code") == -32700, first
assert second.get("id") == "after-malformed" and "result" in second, second
PYEOF
    then pass_case "$server survives malformed input"; else fail_case "$server survives malformed input"; fi
done

printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "$FAIL"
[ "$FAIL" -eq 0 ]
