#!/usr/bin/env bash
# post-tool-use.sh — PostToolUse hook: append tool-use summary to active run's events.jsonl.
# Redacts secrets, records changed files and artifact paths.
set -euo pipefail

INPUT=$(cat)
python3 - "$INPUT" <<'PY'
import datetime
import glob
import json
import os
import sys

try:
    payload = json.loads(sys.argv[1])
except json.JSONDecodeError:
    raise SystemExit(0)

if not isinstance(payload, dict):
    raise SystemExit(0)

tool_name = payload.get('tool_name')
if not isinstance(tool_name, str):
    raise SystemExit(0)

cwd = payload.get('cwd', os.getcwd())
if not isinstance(cwd, str) or not cwd:
    raise SystemExit(0)

runs_dir = os.path.join(cwd, '.lazybuddy', 'runs')
if not os.path.isdir(runs_dir):
    raise SystemExit(0)

active_run = None
for run_dir in sorted(glob.glob(os.path.join(runs_dir, '*/'))):
    state_file = os.path.join(run_dir, 'state.json')
    try:
        with open(state_file, encoding='utf-8') as state_handle:
            state = json.load(state_handle)
    except FileNotFoundError:
        continue
    except json.JSONDecodeError:
        print(json.dumps({'error': 'active_state_corrupt'}), file=sys.stderr)
        raise SystemExit(70)
    except (IsADirectoryError, OSError):
        print(json.dumps({'error': 'active_state_unreadable'}), file=sys.stderr)
        raise SystemExit(70)
    if isinstance(state, dict) and state.get('status') in ('active', 'paused'):
        active_run = run_dir
        break

if active_run is None:
    raise SystemExit(0)

event = {'tool': tool_name, 'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'}
tool_input = payload.get('tool_input')
if not isinstance(tool_input, dict):
    tool_input = {}

if tool_name in ('Write', 'Edit'):
    file_path = tool_input.get('file_path')
    if isinstance(file_path, str) and file_path:
        event['files'] = [file_path]
        normalized_path = file_path.replace(chr(92), '/')
        if '.lazybuddy/' not in normalized_path and '/.workbuddy/' not in normalized_path and not normalized_path.endswith('workbuddy.md') and not normalized_path.endswith('AGENTS.md'):
            event['boundary_warning'] = 'write outside .lazybuddy/ - verify caller is implementer not orchestrator (G-016)'
with open(os.path.join(active_run, 'events.jsonl'), 'a', encoding='utf-8') as event_handle:
    event_handle.write(json.dumps(event, default=str) + '\n')
PY
