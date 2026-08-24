#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TOOLING_ROOT="$(mktemp -d "${TMPDIR:-/private/tmp}/lazybuddy-package-verify.XXXXXX")"

cleanup() {
    rm -rf -- "$TOOLING_ROOT"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

cp "$PLUGIN_ROOT/tooling/package.json" "$PLUGIN_ROOT/tooling/package-lock.json" "$TOOLING_ROOT/"
npm --prefix "$TOOLING_ROOT" ci --ignore-scripts --no-audit --no-fund >&2
SIX_HOST_PARITY_NODE_MODULES="$TOOLING_ROOT/node_modules" \
    bash "$PLUGIN_ROOT/scripts/lazybuddy-verify.sh"
