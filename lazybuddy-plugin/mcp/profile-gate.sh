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

# Validate stdio executable/argv declarations and bundled launcher paths.
# Executable paths may contain spaces. HTTP transports require a URL.
# Validation is local and never launches a server or changes host settings.
lazybuddy_validate_mcp_commands() {
    local plugin_root="${LAZYBUDDY_PLUGIN_ROOT:-}"
    if [ -z "$plugin_root" ]; then
        plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    fi
    "${LAZYBUDDY_PYTHON:-python3}" "${plugin_root}/scripts/lazybuddy-mcp-profile.py" --validate-commands
}
