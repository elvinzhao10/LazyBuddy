#!/usr/bin/env bash
# task-completed: advisory lifecycle recording, never a completion verdict.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/../state/legacy_hook.py" task_completed buddy || true
exit 0
