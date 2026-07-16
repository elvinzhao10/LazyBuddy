#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="0.17.0"
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
grep -q "v$EXPECTED_VERSION" "$PLUGIN_ROOT/CHANGELOG.md"
if grep -Eq '\]\((\./)*\.\./docs/' "$PLUGIN_ROOT/README.md"; then
  printf 'FAIL package README must not link to removed repository-root docs/\n' >&2
  exit 1
fi
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

for relative in (
    "tooling/package-lock.json",
    "tooling/lsp/typescript/package-lock.json",
    "tooling/lsp/python/package-lock.json",
):
    value = json.loads((root / relative).read_text(encoding="utf-8"))
    assert value["version"] == expected, f"{relative} reported {value['version']!r}"
    assert value["packages"][""]["version"] == expected, f"{relative} root package reported {value['packages']['']['version']!r}"

contract = json.loads((root / "contracts/automatic-tooling-contract.v1.json").read_text(encoding="utf-8"))
assert contract["provenance"]["release"] == expected, f"automatic tooling contract reported {contract['provenance']['release']!r}"

marketplace_path = root.parent / ".codebuddy-plugin/marketplace.json"
if marketplace_path.is_file():
    marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))
    entry = next(item for item in marketplace["plugins"] if item["name"] == "lazybuddy")
    assert entry["version"] == expected, f"marketplace reported {entry['version']!r}"
PY
printf 'v0.17 runtime version regression: PASS\n'
