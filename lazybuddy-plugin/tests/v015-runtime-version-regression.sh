#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="0.15.0-alpha.2"
REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

for server in "$PLUGIN_ROOT"/mcp/*/server.sh; do
  response="$(printf '%s\n' "$REQUEST" | CWD="$PLUGIN_ROOT/.." CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$server")"
  version="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["serverInfo"]["version"])' <<<"$response")"
  [ "$version" = "$EXPECTED_VERSION" ] || {
    printf 'FAIL %s reported %s\n' "${server#$PLUGIN_ROOT/}" "$version" >&2
    exit 1
  }
done

grep -q "lazybuddy-docs/$EXPECTED_VERSION" "$PLUGIN_ROOT/mcp/docs/server.py"
grep -q "LazyBuddy v$EXPECTED_VERSION" "$PLUGIN_ROOT/mcp/status-dashboard/dashboard.html"
printf 'v0.15 runtime version regression: PASS\n'
