#!/usr/bin/env bash
# context-graph MCP server wrapper — execs the python implementation.
# WorkBuddy-native codegraph substitute (see server.py for tools).
set -euo pipefail
CWD="${CWD:-.}"
export CWD
DIR="$(cd "$(dirname "$0")" && pwd)"
while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  printf '%s' "$INPUT" | python3 "$DIR/server.py"
done
