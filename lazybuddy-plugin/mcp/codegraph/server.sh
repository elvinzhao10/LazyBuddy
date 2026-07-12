#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
TOOLING="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TARGET_ROOT="${CWD:-$(pwd -P)}"
TOOLING_ROOT="${LAZYBUDDY_TOOLING_ROOT:-}"

if [ -z "$TOOLING_ROOT" ]; then
    printf '%s\n' 'CodeGraph is unavailable: LAZYBUDDY_TOOLING_ROOT is required for the explicit package-owned capability.' >&2
    exit 2
fi

STATUS="$(bash "$TOOLING" codegraph-status --target "$TARGET_ROOT" --tooling-root "$TOOLING_ROOT")"
if ! grep -qx 'STATE: ready' <<<"$STATUS"; then
    printf '%s\n' "$STATUS" >&2
    exit 2
fi

BINARY="$(sed -n 's/^PROVIDER: codegraph owned //p' <<<"$STATUS")"
[ -n "$BINARY" ] && [ -f "$BINARY" ] && [ ! -L "$BINARY" ] && [ -x "$BINARY" ] || {
    printf '%s\n' 'CodeGraph is unavailable: verified owned binary is missing.' >&2
    exit 2
}

cd "$TARGET_ROOT"
RUNTIME_ROOT="$TOOLING_ROOT/.lazybuddy-codegraph-runtime"
[ -d "$RUNTIME_ROOT" ] && [ ! -L "$RUNTIME_ROOT" ] || {
    printf '%s\n' 'CodeGraph is unavailable: verified owned runtime state is missing or unsafe.' >&2
    exit 2
}
exec env \
    HOME="$RUNTIME_ROOT/home" \
    XDG_CONFIG_HOME="$RUNTIME_ROOT/config" \
    XDG_CACHE_HOME="$RUNTIME_ROOT/cache" \
    CODEGRAPH_NO_DOWNLOAD=1 \
    CODEGRAPH_TELEMETRY=0 \
    CODEGRAPH_INSTALL_DIR="$RUNTIME_ROOT/install" \
    "$BINARY" serve --mcp
