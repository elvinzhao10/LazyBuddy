#!/usr/bin/env bash

lazybuddy_require_mcp_profile() {
    local server="$1"
    local mode="${LAZYBUDDY_MCP_MODE:-orchestrated}"
    case "$mode" in
        direct) selected='run-ledger verification status-dashboard' ;;
        assisted) selected='run-ledger verification status-dashboard context-graph code-intel' ;;
        planned) selected='run-ledger verification status-dashboard context-graph docs' ;;
        orchestrated|long-horizon) selected='run-ledger verification status-dashboard context-graph code-intel docs' ;;
        *) printf 'MCP_PROFILE_INVALID mode=%s\n' "$mode" >&2; return 2 ;;
    esac
    case " $selected " in
        *" $server "*) return 0 ;;
        *) printf 'MCP_PROFILE_DEFERRED server=%s mode=%s\n' "$server" "$mode" >&2; return 3 ;;
    esac
}
