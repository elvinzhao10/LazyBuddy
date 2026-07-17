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
export HOME="$RUNTIME_ROOT/home"
export XDG_CONFIG_HOME="$RUNTIME_ROOT/config"
export XDG_CACHE_HOME="$RUNTIME_ROOT/cache"
export CODEGRAPH_NO_DOWNLOAD=1
export CODEGRAPH_TELEMETRY=0
export CODEGRAPH_NO_WATCHDOG=1
export CODEGRAPH_INSTALL_DIR="$RUNTIME_ROOT/install"
OWNER_MARKER='--lazybuddy-codegraph-mcp-owner=v1'
exec python3 -B -c '
import os
import signal
import subprocess
import sys

owner_marker, binary, target_root, runtime_root = sys.argv[1:]
if owner_marker != "--lazybuddy-codegraph-mcp-owner=v1":
    raise SystemExit("invalid LazyBuddy CodeGraph launcher ownership marker")
environment = os.environ | {
    "HOME": f"{runtime_root}/home",
    "XDG_CONFIG_HOME": f"{runtime_root}/config",
    "XDG_CACHE_HOME": f"{runtime_root}/cache",
    "CODEGRAPH_NO_DOWNLOAD": "1",
    "CODEGRAPH_TELEMETRY": "0",
    "CODEGRAPH_NO_WATCHDOG": "1",
    "CODEGRAPH_INSTALL_DIR": f"{runtime_root}/install",
}
process = subprocess.Popen(
    [binary, "serve", "--mcp"],
    cwd=target_root,
    env=environment,
    start_new_session=True,
)

def forward_signal(_signal, _frame):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, forward_signal)
signal.signal(signal.SIGINT, forward_signal)
raise SystemExit(process.wait())
' "$OWNER_MARKER" "$BINARY" "$TARGET_ROOT" "$RUNTIME_ROOT"
