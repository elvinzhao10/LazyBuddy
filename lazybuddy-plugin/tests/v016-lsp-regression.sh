#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-lsp.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
expect() {
    local label="$1" expected="$2"
    shift 2
    local output status
    if output=$("$@" 2>&1); then status=0; else status=$?; fi
    printf '%s\n' "$output" > "$TMP/$label.out"
    [ "$status" = "$expected" ] || fail "$label (exit $status, expected $expected): $output"
    pass "$label"
}
fingerprint() {
    find "$1" -type f -print0 | sort -z | xargs -0 shasum
}

TS_TARGET="$TMP/typescript"
PY_TARGET="$TMP/python"
OTHER_TARGET="$TMP/other"
mkdir -p "$TS_TARGET" "$PY_TARGET" "$OTHER_TARGET"
printf '{"compilerOptions":{"strict":true}}\n' > "$TS_TARGET/tsconfig.json"
printf 'export const answer: number = 42;\n' > "$TS_TARGET/source.ts"
printf '[project]\nname = "fixture"\nversion = "0.0.0"\n' > "$PY_TARGET/pyproject.toml"
printf 'answer: int = 42\n' > "$PY_TARGET/source.py"

fingerprint "$TS_TARGET" > "$TMP/ts-before"
expect "missing provider is non-blocking" 0 bash "$LIFECYCLE" lsp-status --target "$TS_TARGET" --tooling-root "$TMP/missing-root"
grep -Fxq 'STATE: missing' "$TMP/missing provider is non-blocking.out" || fail 'missing provider state'
fingerprint "$TS_TARGET" > "$TMP/ts-after"
cmp -s "$TMP/ts-before" "$TMP/ts-after" || fail 'missing status mutated TypeScript target'
pass 'missing status preserves TypeScript target'

expect "unsupported language is non-blocking" 0 bash "$LIFECYCLE" lsp-status --target "$OTHER_TARGET" --tooling-root "$TMP/missing-root"
grep -Fxq 'STATE: unsupported' "$TMP/unsupported language is non-blocking.out" || fail 'unsupported language state'

expect "bridge reports unavailable before provision" 0 bash -c "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"lsp_status\",\"arguments\":{}}}' | CWD='$TS_TARGET' LAZYBUDDY_TOOLING_ROOT='$TMP/missing-root' bash '$PLUGIN_ROOT/mcp/lsp/server.sh'"
grep -q 'STATE\\": \\"missing' "$TMP/bridge reports unavailable before provision.out" || fail 'bridge missing provider response'

expect "bridge translates status timeout" 0 bash -c "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"lsp_status\",\"arguments\":{}}}' | CWD='$TS_TARGET' LAZYBUDDY_TOOLING_ROOT='$TMP/missing-root' LAZYBUDDY_LSP_TIMEOUT_SECONDS=0 bash '$PLUGIN_ROOT/mcp/lsp/server.sh'"
grep -q 'status inspection exceeded bounded timeout' "$TMP/bridge translates status timeout.out" || fail 'bridge timeout response'
if grep -q 'Traceback' "$TMP/bridge translates status timeout.out"; then
    fail 'bridge timeout leaked traceback'
fi

TS_ROOT="$TMP/typescript-tools"
PY_ROOT="$TMP/python-tools"
ISOLATED_ROOT="$TMP/isolated-tools"
CALLER_HOME="$TMP/caller-home"
CALLER_CONFIG="$TMP/caller-config"
CALLER_TMP="$TMP/caller-tmp"
CALLER_NODE_CACHE="$TMP/caller-node-cache"
FAKE_BIN="$TMP/fake-bin"
mkdir "$TS_ROOT" "$PY_ROOT" "$ISOLATED_ROOT" "$CALLER_HOME" "$CALLER_CONFIG" "$CALLER_TMP" "$CALLER_NODE_CACHE" "$FAKE_BIN"
CALLER_SENTINEL="$CALLER_HOME/npm-state-written"
REAL_NPM="$(command -v npm)"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' "if [ \"\${HOME:-}\" = \"$CALLER_HOME\" ] || [ \"\${XDG_CONFIG_HOME:-}\" = \"$CALLER_CONFIG\" ]; then" "  touch \"$CALLER_SENTINEL\"" 'fi' "exec \"$REAL_NPM\" \"\$@\"" > "$FAKE_BIN/npm"
chmod +x "$FAKE_BIN/npm"
printf 'import { answer } from "./source";\nconsole.log(answer);\n' > "$TS_TARGET/use.ts"
printf 'from source import answer\nprint(answer)\n' > "$PY_TARGET/use.py"
fingerprint "$TS_TARGET" > "$TMP/ts-before-install"
fingerprint "$PY_TARGET" > "$TMP/py-before-install"
expect "LSP install isolates caller npm state" 0 env PATH="$FAKE_BIN:$PATH" HOME="$CALLER_HOME" XDG_CONFIG_HOME="$CALLER_CONFIG" TMPDIR="$CALLER_TMP" NODE_COMPILE_CACHE="$CALLER_NODE_CACHE" bash "$LIFECYCLE" lsp-install --target "$TS_TARGET" --tooling-root "$ISOLATED_ROOT"
[ ! -e "$CALLER_SENTINEL" ] || fail 'LSP install inherited caller npm runtime state'
[ -d "$ISOLATED_ROOT/.lazybuddy-lsp-npm-runtime/home" ] && [ -d "$ISOLATED_ROOT/.lazybuddy-lsp-npm-runtime/cache" ] && [ -d "$ISOLATED_ROOT/.lazybuddy-lsp-npm-runtime/config" ] && [ -d "$ISOLATED_ROOT/.lazybuddy-lsp-npm-runtime/tmp" ] || fail 'LSP install did not create receipt-owned npm runtime'
expect "owned LSP runtime ignores caller environment" 0 env HOME="$CALLER_HOME" XDG_CONFIG_HOME="$CALLER_CONFIG" TMPDIR="$CALLER_TMP" NODE_COMPILE_CACHE="$CALLER_NODE_CACHE" python3 - "$ISOLATED_ROOT" "$PLUGIN_ROOT/mcp/lsp" <<'PY'
import sys
from pathlib import Path

tooling_root, module_root = sys.argv[1:]
sys.path.insert(0, module_root)
from session import provider_environment

provider = Path(tooling_root) / "lsp" / "typescript" / "node_modules" / ".bin" / "typescript-language-server"
environment = provider_environment(str(provider))
runtime = Path(tooling_root) / ".lazybuddy-lsp-npm-runtime"
if environment["HOME"] != str(runtime / "home") or environment["XDG_CONFIG_HOME"] != str(runtime / "config") or environment["TMPDIR"] != str(runtime / "tmp") or environment["NODE_COMPILE_CACHE"] != str(runtime / "cache" / "node-compile-cache"):
    raise SystemExit("owned LSP runtime inherited caller environment")
PY
expect "uninstall isolated LSP provider" 0 bash "$LIFECYCLE" lsp-uninstall --target "$TS_TARGET" --tooling-root "$ISOLATED_ROOT"
expect "install locked TypeScript provider" 0 bash "$LIFECYCLE" lsp-install --target "$TS_TARGET" --tooling-root "$TS_ROOT"
expect "install locked Python provider" 0 bash "$LIFECYCLE" lsp-install --target "$PY_TARGET" --tooling-root "$PY_ROOT"
expect "TypeScript provider status" 0 bash "$LIFECYCLE" lsp-status --target "$TS_TARGET" --tooling-root "$TS_ROOT"
expect "Python provider status" 0 bash "$LIFECYCLE" lsp-status --target "$PY_TARGET" --tooling-root "$PY_ROOT"
grep -Fxq 'STATE: ready' "$TMP/TypeScript provider status.out" || fail 'TypeScript provider ready state'
grep -Fxq 'STATE: ready' "$TMP/Python provider status.out" || fail 'Python provider ready state'
fingerprint "$TS_TARGET" > "$TMP/ts-after-install"
fingerprint "$PY_TARGET" > "$TMP/py-after-install"
cmp -s "$TMP/ts-before-install" "$TMP/ts-after-install" || fail 'TypeScript lifecycle mutated target'
cmp -s "$TMP/py-before-install" "$TMP/py-after-install" || fail 'Python lifecycle mutated target'
pass 'LSP lifecycle preserves target fingerprints'

bridge_checks() {
    local target="$1" tooling_root="$2" source="$3" usage="$4"
    python3 - "$target" "$tooling_root" "$PLUGIN_ROOT/mcp/lsp/server.sh" "$source" "$usage" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

target, tooling_root, server, source, usage = sys.argv[1:]
character = 13 if usage.endswith(".ts") else 7
requests = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "definition", "arguments": {"path": usage, "line": 1, "character": character}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "references", "arguments": {"path": usage, "line": 1, "character": character}}},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "symbols", "arguments": {"path": source}}},
    {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "hover", "arguments": {"path": usage, "line": 1, "character": character}}},
    {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "diagnostics", "arguments": {"path": usage}}},
    {"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {"name": "rename", "arguments": {"path": usage, "line": 1, "character": character}}},
]
environment = os.environ.copy()
environment["CWD"] = target
environment["LAZYBUDDY_TOOLING_ROOT"] = tooling_root
process = subprocess.run(
    ["bash", server],
    input="".join(json.dumps(request) + "\n" for request in requests),
    text=True,
    capture_output=True,
    env=environment,
    timeout=45,
    check=False,
)
if process.returncode:
    raise SystemExit(process.stderr or process.stdout)
responses = [json.loads(line) for line in process.stdout.splitlines() if line]
if len(responses) != len(requests):
    raise SystemExit("bridge did not return one response per request")
for response in responses[:7]:
    if "error" in response:
        raise SystemExit(json.dumps(response))
definition_text = responses[2]["result"]["content"][0]["text"]
if Path(target, source).resolve().as_uri() not in definition_text:
    raise SystemExit("freshly opened cross-file definition did not resolve to the declaration file")
tools = {tool["name"] for tool in responses[1]["result"]["tools"]}
if not {"definition", "references", "symbols", "hover", "diagnostics"}.issubset(tools):
    raise SystemExit("bridge did not expose advertised read-only operations")
if "error" not in responses[7] or "rename is intentionally unsupported" not in responses[7]["error"]["message"]:
    raise SystemExit("rename was not refused")
PY
}

expect "TypeScript bridge real read-only operations" 0 bridge_checks "$TS_TARGET" "$TS_ROOT" source.ts use.ts
expect "Python bridge real read-only operations" 0 bridge_checks "$PY_TARGET" "$PY_ROOT" source.py use.py
expect "TypeScript direct session cross-file definition" 0 python3 - "$TS_TARGET" "$TS_ROOT" "$PLUGIN_ROOT/mcp/lsp" <<'PY'
import sys
from pathlib import Path

target, tooling_root, module_root = sys.argv[1:]
sys.path.insert(0, module_root)
from session import LspSession

project = Path(target)
provider = Path(tooling_root) / "lsp" / "typescript" / "node_modules" / ".bin" / "typescript-language-server"
session = LspSession(str(provider), "typescript", project, 8)
try:
    session.initialize()
    source = project / "use.ts"
    session.open_file(source)
    result = session.request("textDocument/definition", {"textDocument": {"uri": source.as_uri()}, "position": {"line": 1, "character": 13}})
    if project.joinpath("source.ts").as_uri() not in str(result):
        raise SystemExit("direct freshly opened cross-file definition did not resolve to source.ts")
finally:
    session.close()
PY
expect "bridge rejects malformed JSON" 0 bash -c "printf '%s\\n' '{not-json' | CWD='$TS_TARGET' LAZYBUDDY_TOOLING_ROOT='$TS_ROOT' bash '$PLUGIN_ROOT/mcp/lsp/server.sh'"
grep -q '"code":-32700' "$TMP/bridge rejects malformed JSON.out" || fail 'malformed request rejection'

cp "$TS_ROOT/.lazybuddy-lsp-receipt.json" "$TMP/ts-receipt-original.json"
printf '\n' >> "$TS_ROOT/.lazybuddy-lsp-receipt.json"
expect "edited LSP receipt blocks uninstall" 2 bash "$LIFECYCLE" lsp-uninstall --target "$TS_TARGET" --tooling-root "$TS_ROOT"
[ -d "$TS_ROOT" ] || fail 'edited LSP receipt root preserved'
rm "$TS_ROOT/.lazybuddy-lsp-receipt.json"
cp "$TMP/ts-receipt-original.json" "$TS_ROOT/.lazybuddy-lsp-receipt.json"
expect "uninstall TypeScript owned provider" 0 bash "$LIFECYCLE" lsp-uninstall --target "$TS_TARGET" --tooling-root "$TS_ROOT"
expect "uninstall Python owned provider" 0 bash "$LIFECYCLE" lsp-uninstall --target "$PY_TARGET" --tooling-root "$PY_ROOT"
[ ! -e "$TS_ROOT" ] && [ ! -e "$PY_ROOT" ] || fail 'receipt-owned LSP roots removed'
pass 'receipt-owned LSP roots removed'

printf 'PASS baseline LSP missing and unsupported behavior\n'
