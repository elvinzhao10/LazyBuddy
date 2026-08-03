#!/usr/bin/env bash
# docs MCP server wrapper — execs the python implementation.
# WorkBuddy-native context7 substitute (see server.py for tools).
set -euo pipefail
die() {
  printf 'LazyBuddy MCP launcher: %s\n' "$1" >&2
  exit 2
}

SOURCE_PATH="${BASH_SOURCE[0]}"
case "$SOURCE_PATH" in
  /*) ;;
  *) SOURCE_PATH="$PWD/$SOURCE_PATH" ;;
esac
SCRIPT_DIR="$(cd -P -- "$(dirname -- "$SOURCE_PATH")" 2>/dev/null && pwd -P)" || die "cannot locate launcher"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd -P -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd -P)}"
case "$PLUGIN_ROOT" in
  /*) ;;
  *) die "plugin root must be absolute: $PLUGIN_ROOT" ;;
esac
[ -d "$PLUGIN_ROOT" ] || die "plugin root not found: $PLUGIN_ROOT"
source "$PLUGIN_ROOT/mcp/profile-gate.sh"
lazybuddy_require_mcp_profile "docs"
SERVER_DIR="$PLUGIN_ROOT/mcp/docs"
[ -f "$SERVER_DIR/server.py" ] || die "MCP server implementation not found: $SERVER_DIR/server.py"
RAW_CWD="${CWD:-${CODEBUDDY_PROJECT_DIR:-}}"
[ -n "$RAW_CWD" ] || die "project CWD is required: set CWD or CODEBUDDY_PROJECT_DIR"
case "$RAW_CWD" in
  /*) ;;
  *) RAW_CWD="$PWD/$RAW_CWD" ;;
esac
[ -d "$RAW_CWD" ] && [ ! -L "$RAW_CWD" ] || die "project CWD is unavailable: $RAW_CWD"
CWD="$(cd -P -- "$RAW_CWD" 2>/dev/null && pwd -P)" || die "cannot resolve project CWD: $RAW_CWD"
export CWD
while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  printf '%s' "$INPUT" | python3 -B "$SERVER_DIR/server.py"
done
