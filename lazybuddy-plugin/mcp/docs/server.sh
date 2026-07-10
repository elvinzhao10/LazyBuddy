#!/usr/bin/env bash
# docs MCP server wrapper — execs the python implementation.
# WorkBuddy-native context7 substitute (see server.py for tools).
set -euo pipefail
CWD="${CWD:-.}"
export CWD
DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$DIR/server.py"
