#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PLUGIN_ROOT/scripts/state"
TMP="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

CWD="$TMP/project" bash "$STATE_DIR/create-run.sh" run-1 'validate ordinary host task state' >/dev/null

python3 - "$TMP/project/.lazybuddy/runs/run-1/state.json" <<'PY'
import json
import sys

state_file = sys.argv[1]
with open(state_file) as handle:
    state = json.load(handle)
state['tasks'] = [{'id': 'task-1', 'title': 'ordinary host task', 'status': 'queued'}]
with open(state_file, 'w') as handle:
    json.dump(state, handle)
PY

CWD="$TMP/project" bash "$STATE_DIR/validate-state.sh" run-1 >/dev/null

printf '%s\n' 'PASS: ordinary host task state validates'
