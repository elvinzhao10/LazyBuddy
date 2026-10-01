#!/usr/bin/env bash
# run-cycle.sh — Claim a task under the run transaction lock.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"
RUN_ID="${1:-}"
state_require_safe_run_id "$RUN_ID" || exit 1
state_require_run_dir "${CWD:-.}" "$RUN_ID" || exit 1
state_require_existing_run_file "$STATE_RUN_DIR/state.json" "state.json" || exit 1
exec python3 "$SCRIPT_DIR/../state/run_controller.py" cycle "$STATE_RUN_DIR"
