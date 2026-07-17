#!/usr/bin/env bash
# classify-failure.sh — Classify a task failure and record it.
# Usage: classify-failure.sh <run_id> <task_id> "<error_message>"
set -euo pipefail

RUN_ID="${1:-}"
TASK_ID="${2:-}"
ERROR_MSG="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../state/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi
if [ -z "$TASK_ID" ] || [ -z "$ERROR_MSG" ]; then
    echo "Usage: classify-failure.sh <run_id> <task_id> <error_message>" >&2
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"

state_require_safe_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Classify: check error message against known patterns (case-insensitive)
ERROR_LOWER=$(python3 - "$ERROR_MSG" <<'PYEOF'
import sys
print(sys.argv[1].lower())
PYEOF
)
CLASSIFICATION="human-needed"

if python3 - "$ERROR_LOWER" <<'PYEOF'
import sys
msg = sys.argv[1]
if any(kw in msg for kw in ('permission denied','access denied','eacces','forbidden','unauthorized')):
    raise SystemExit(10)
if any(kw in msg for kw in ('timeout','timed out','connection refused','econnrefused','etimedout')):
    raise SystemExit(20)
if any(kw in msg for kw in ('not found','does not exist','enoent','no such file','missing')):
    raise SystemExit(30)
PYEOF
then
    :
else
    case $? in
        10) CLASSIFICATION="ask-user" ;;
        20) CLASSIFICATION="retry" ;;
        30) CLASSIFICATION="fallback" ;;
    esac
fi

# Set task status to failed
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
python3 - "$STATE_FILE" "$TMP_FILE" "$TASK_ID" "$CLASSIFICATION" "$ERROR_MSG" "$NOW" <<'PYEOF'
import json
import sys
state_file, tmp_file, task_id, classification, error_msg, now = sys.argv[1:]
d = json.load(open(state_file))
for t in d.get('tasks', []):
    if t['id'] == task_id:
        t['status'] = 'failed'
        t['classification'] = classification
        t['error'] = error_msg
        break
d['updated_at'] = now
with open(tmp_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
mv "$TMP_FILE" "$STATE_FILE"

# Append task_failed event
python3 - "$NOW" "$RUN_ID" "$TASK_ID" "$CLASSIFICATION" "$ERROR_MSG" "$EVENTS_FILE" <<'PYEOF'
import json
import sys
now, run_id, task_id, classification, error_msg, events_file = sys.argv[1:]
event = {'ts': now, 'run_id': run_id, 'event': 'task_failed', 'task_id': task_id, 'classification': classification, 'error': error_msg}
with open(events_file, 'a') as f:
    f.write(json.dumps(event) + '\n')
PYEOF

echo "$CLASSIFICATION"
