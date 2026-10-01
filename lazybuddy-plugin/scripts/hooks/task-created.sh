#!/usr/bin/env bash
# task-created: advisory lifecycle recording, never a completion verdict.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/../state/legacy_hook.py" task_created buddy || true
exit 0
