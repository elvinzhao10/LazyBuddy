#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="0.16.0-alpha.1"
REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

for server in run-ledger verification status-dashboard context-graph code-intel docs lsp; do
  server="$PLUGIN_ROOT/mcp/$server/server.sh"
  response="$(printf '%s\n' "$REQUEST" | CWD="$PLUGIN_ROOT/.." CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$server")"
  version="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["serverInfo"]["version"])' <<<"$response")"
  [ "$version" = "$EXPECTED_VERSION" ] || {
    printf 'FAIL %s reported %s\n' "${server#$PLUGIN_ROOT/}" "$version" >&2
    exit 1
  }
done

grep -q "lazybuddy-docs/$EXPECTED_VERSION" "$PLUGIN_ROOT/mcp/docs/server.py"
grep -q "LazyBuddy v$EXPECTED_VERSION" "$PLUGIN_ROOT/mcp/status-dashboard/dashboard.html"
grep -q "LazyBuddy v$EXPECTED_VERSION" "$PLUGIN_ROOT/scripts/hooks/session-start.sh"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/scripts/lazybuddy-verify.sh"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/README.md"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/../README.md"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/../AGENTS.md"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/../docs/handoff.md"
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/../lazybuddy-evaluation.md"
python3 - "$PLUGIN_ROOT" "$EXPECTED_VERSION" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
expected = sys.argv[2]
for relative in (
    ".codebuddy-plugin/plugin.json",
    ".workbuddy-plugin/plugin.json",
    "tooling/package.json",
    "tooling/lsp/typescript/package.json",
    "tooling/lsp/python/package.json",
):
    value = json.loads((root / relative).read_text(encoding="utf-8"))
    assert value["version"] == expected, f"{relative} reported {value['version']!r}"

marketplace = json.loads((root.parent / ".codebuddy-plugin/marketplace.json").read_text(encoding="utf-8"))
entry = next(item for item in marketplace["plugins"] if item["name"] == "lazybuddy")
assert entry["version"] == expected, f"marketplace reported {entry['version']!r}"
PY
printf 'v0.16 runtime version regression: PASS\n'
