#!/usr/bin/env bash
# subagent-start: advisory lifecycle recording, never a completion verdict.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/../state/legacy_hook.py" subagent_start buddy || true
exit 0
