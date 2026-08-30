#!/usr/bin/env bash
# load-run.sh — Read and print state.json for a run.
# Usage: load-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

if [ -z "$RUN_ID" ]; then
    echo "Usage: load-run.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"

state_recover_transaction "$STATE_RUN_DIR" || exit 1
state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

cat "$STATE_FILE"
