#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-mcp-params.XXXXXX")"
PROJECT="$TMP/project"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$PROJECT"

python3 - "$PLUGIN" "$PROJECT" <<'PYEOF'
import json
import os
import select
import subprocess
import sys

plugin, project = sys.argv[1:]
servers = (
    "run-ledger",
    "verification",
    "status-dashboard",
    "context-graph",
    "code-intel",
    "docs",
    "lsp",
)
environment = {
    **os.environ,
    "CODEBUDDY_PLUGIN_ROOT": plugin,
    "CWD": project,
}


def read_response(process, server, request_id):
    readable, _, _ = select.select([process.stdout], [], [], 1.5)
    assert readable, f"{server} did not respond to {request_id}"
    response = json.loads(process.stdout.readline())
    assert response["jsonrpc"] == "2.0", response
    assert response["id"] == request_id, response
    return response


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
        for suffix, params in (
            ("null", None),
            ("array", []),
            ("missing-name", {}),
            ("non-string-name", {"name": 7}),
            ("bad-arguments", {"name": "anything", "arguments": []}),
        ):
            request_id = f"{server}-invalid-{suffix}"
            process.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": "tools/call",
                        "params": params,
                    }
                )
                + "\n"
            )
            process.stdin.flush()
            response = read_response(process, server, request_id)
            assert response["error"]["code"] == -32602, response

        process.stdin.write(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": None,
                }
            )
            + "\n"
        )
        process.stdin.flush()
        readable, _, _ = select.select([process.stdout], [], [], 0.2)
        assert not readable, f"{server} replied to invalid-params notification"

        request_id = f"{server}-survives-invalid-params"
        process.stdin.write(
            json.dumps({"jsonrpc": "2.0", "id": request_id, "method": "tools/list"})
            + "\n"
        )
        process.stdin.flush()
        response = read_response(process, server, request_id)
        assert isinstance(response["result"]["tools"], list), response

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

print("PASS: all MCP servers reject malformed tools/call params without ending the session")
PYEOF
