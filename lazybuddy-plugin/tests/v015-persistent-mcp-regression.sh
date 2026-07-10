#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-persistent-mcp.XXXXXX")"
PROJECT="$TMP/project"
INSTALLED="$PROJECT/installed/extensions/lazybuddy-copy"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$PROJECT/installed/extensions"
cp -R "$PLUGIN" "$INSTALLED"

python3 - "$INSTALLED" "$PROJECT" <<'PYEOF'
import json
import os
import select
import subprocess
import sys

plugin, project = sys.argv[1:]
servers = ["verification", "run-ledger", "source-map", "parity", "status-dashboard", "code-intel", "context-graph", "docs"]
environment = {
    **os.environ,
    "CODEBUDDY_PLUGIN_ROOT": plugin,
    "CWD": project,
}

for server in servers:
    process = subprocess.Popen(
        ["bash", f"{plugin}/mcp/{server}/server.sh"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )
    try:
        for request_id, method in (
            (f"{server}-persistent-init", "initialize"),
            (f"{server}-persistent-list", "tools/list"),
            (f"{server}-persistent-error", "not/a/real/method"),
        ):
            process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method}) + "\n")
            process.stdin.flush()
            readable, _, _ = select.select([process.stdout], [], [], 1.5)
            assert readable, f"{server} did not respond before stdin closed for {method}"
            response_line = process.stdout.readline()
            response = json.loads(response_line)
            assert response["id"] == request_id, (server, method, response)
            if method == "not/a/real/method":
                assert "error" in response, (server, method, response)
            else:
                assert "result" in response, (server, method, response)
        process.stdin.close()
        trailing = process.stdout.read()
        stderr = process.stderr.read()
        returncode = process.wait(timeout=3)
        assert returncode == 0, (server, returncode, stderr)
        assert not trailing, (server, trailing)
        assert not stderr, (server, stderr)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

def assert_project_doc_errors(server, tool_names):
    process = subprocess.Popen(
        ["bash", f"{plugin}/mcp/{server}/server.sh"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )
    try:
        for tool_name in tool_names:
            request_id = f"{server}-{tool_name}-missing-project-doc"
            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": {}},
            }
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
            readable, _, _ = select.select([process.stdout], [], [], 1.5)
            assert readable, f"{server}/{tool_name} did not respond before stdin closed"
            response = json.loads(process.stdout.readline())
            assert response["id"] == request_id, response
            assert "error" in response, response
        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": f"{server}-session-survives", "method": "tools/list"}) + "\n")
        process.stdin.flush()
        readable, _, _ = select.select([process.stdout], [], [], 1.5)
        assert readable, f"{server} did not survive a missing project document"
        response = json.loads(process.stdout.readline())
        assert "result" in response, response
        process.stdin.close()
        trailing = process.stdout.read()
        stderr = process.stderr.read()
        returncode = process.wait(timeout=3)
        assert returncode == 0, (server, returncode, stderr)
        assert not trailing, (server, trailing)
        assert not stderr, (server, stderr)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

assert_project_doc_errors("parity", ["list_methods", "generate_gap_report"])
assert_project_doc_errors("verification", ["discover_checks"])

print("PASS: persistent shell MCP sessions return one JSON response per request")
PYEOF

if (
    cd "$PROJECT"
    unset CWD
    unset LAZYBUDDY_MCP_TEST_CODE_PATH
    CODEBUDDY_PLUGIN_ROOT="$INSTALLED" bash "$INSTALLED/scripts/lazybuddy-mcp-test.sh"
); then
    echo "PASS: copied plugin root MCP smoke uses installed files"
else
    echo "FAIL: copied plugin root MCP smoke" >&2
    exit 1
fi
