#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd -P -- "$SCRIPT_DIR/../.." && pwd -P)}"

exec python3 "$PLUGIN_ROOT/tooling/lazybuddy_adaptive_runtime.py"
