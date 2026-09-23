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

python3 - "$PLUGIN" "$PROJECT" <<'PYEOF'
import json
import os
import select
import subprocess
import sys

plugin, project = sys.argv[1:]
src = os.path.join(project, "src")
os.makedirs(os.path.join(src, "nested"))
os.makedirs(os.path.join(src, "duplicate"))

sources = {
    "alpha.js": "export const alpha = 1;\n",
    "beta.js": "import { alpha } from './alpha.js';\n",
    "nested/consumer.js": "import { alpha } from '../alpha';\n",
    "reexport.js": "export { alpha } from './alpha.js';\n",
    "cjs-target.js": "module.exports = 1;\n",
    "cjs-consumer.js": "const target = require('./cjs-target.js');\n",
    "alpha.h": "#define ALPHA 1\n",
    "native.cc": "#include \"alpha.h\"\n",
    "duplicate/alpha.js": "export const duplicate = 1;\n",
    "duplicate-consumer.js": "import { duplicate } from './duplicate/alpha.js';\n",
}
for relative, content in sources.items():
    with open(os.path.join(src, relative), "w", encoding="utf-8") as handle:
        handle.write(content)

environment = {
    **os.environ,
    "CODEBUDDY_PLUGIN_ROOT": plugin,
    "CWD": project,
    "LAZYBUDDY_MCP_MODE": "orchestrated",
}
process = subprocess.Popen(
    ["bash", f"{plugin}/mcp/context-graph/server.sh"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env=environment,
)


def blast_radius(request_id, path):
    process.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {"name": "blast_radius", "arguments": {"path": path}},
    }) + "\n")
    process.stdin.flush()
    readable, _, _ = select.select([process.stdout], [], [], 1.5)
    assert readable, f"context-graph did not respond for {path}"
    response = json.loads(process.stdout.readline())
    return response["result"]["content"][0]["text"]


try:
    alpha = blast_radius(1, "src/alpha.js")
    assert "(3 dependents)" in alpha, alpha
    for consumer in ("src/beta.js", "src/nested/consumer.js", "src/reexport.js"):
        assert consumer in alpha, alpha
    assert "src/duplicate-consumer.js" not in alpha, alpha

    commonjs = blast_radius(2, "src/cjs-target.js")
    assert "(1 dependents)" in commonjs, commonjs
    assert "src/cjs-consumer.js" in commonjs, commonjs

    native = blast_radius(3, "src/alpha.h")
    assert "(1 dependents)" in native, native
    assert "src/native.cc" in native, native

    duplicate = blast_radius(4, "src/duplicate/alpha.js")
    assert "(1 dependents)" in duplicate, duplicate
    assert "src/duplicate-consumer.js" in duplicate, duplicate

    process.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {"name": "repo_overview", "arguments": {"limit": 1}},
    }) + "\n")
    process.stdin.flush()
    readable, _, _ = select.select([process.stdout], [], [], 1.5)
    assert readable, "context-graph did not respond for repo_overview"
    overview = json.loads(process.stdout.readline())["result"]["content"][0]["text"]
    assert "top 1 of 3 by incoming refs (truncated)" in overview, overview
    assert "src/alpha.js" in overview, overview
finally:
    process.stdin.close()
    stderr = process.stderr.read()
    returncode = process.wait(timeout=3)
    assert returncode == 0, (returncode, stderr)

print("PASS: context-graph resolves literal imports and reports bounded incoming-reference rankings")
PYEOF

python3 - "$PLUGIN" "$PROJECT" <<'PYEOF'
import json
import os
import select
import subprocess
import sys

plugin, project = sys.argv[1:]
environment = {
    **os.environ,
    "CODEBUDDY_PLUGIN_ROOT": plugin,
    "CWD": project,
    "LAZYBUDDY_MCP_MODE": "orchestrated",
    "PATH": "/usr/bin:/bin",
}
process = subprocess.Popen(
    ["/bin/bash", f"{plugin}/mcp/context-graph/server.sh"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env=environment,
)
try:
    process.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {"name": "repo_overview", "arguments": {"limit": 1}},
    }) + "\n")
    process.stdin.flush()
    readable, _, _ = select.select([process.stdout], [], [], 1.5)
    assert readable, "context-graph fallback did not respond for repo_overview"
    overview = json.loads(process.stdout.readline())["result"]["content"][0]["text"]
    assert "top 1 of 3 by incoming refs (truncated)" in overview, overview
    assert "src/alpha.js" in overview, overview
finally:
    process.stdin.close()
    stderr = process.stderr.read()
    returncode = process.wait(timeout=3)
    assert returncode == 0, (returncode, stderr)

print("PASS: context-graph repo_overview supports the grep fallback")
PYEOF
