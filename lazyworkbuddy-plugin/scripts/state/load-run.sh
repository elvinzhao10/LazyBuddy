#!/usr/bin/env bash
# load-run.sh — Read and print state.json for a run.
# Usage: load-run.sh <run_id>
set -euo pipefail

RUN_ID="${1:-}"

if [ -z "$RUN_ID" ]; then
    echo "Usage: load-run.sh <run_id>" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

cat "$STATE_FILE"
