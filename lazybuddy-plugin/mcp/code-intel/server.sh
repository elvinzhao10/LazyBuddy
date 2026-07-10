#!/usr/bin/env bash
# code-intel MCP server wrapper — execs the python implementation.
# WorkBuddy-native LSP substitute (see server.py for tools).
set -euo pipefail
CWD="${CWD:-.}"
export CWD
DIR="$(cd "$(dirname "$0")" && pwd)"
while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  printf '%s' "$INPUT" | python3 "$DIR/server.py"
done
