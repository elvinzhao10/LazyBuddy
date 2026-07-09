#!/usr/bin/env bash
# classify-failure.sh — Classify a task failure and record it.
# Usage: classify-failure.sh <run_id> <task_id> "<error_message>"
set -euo pipefail

RUN_ID="${1:-}"
TASK_ID="${2:-}"
ERROR_MSG="${3:-}"

if [ -z "$RUN_ID" ] || [ -z "$TASK_ID" ] || [ -z "$ERROR_MSG" ]; then
    echo "Usage: classify-failure.sh <run_id> <task_id> \"<error_message>\"" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/state.json"
EVENTS_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/events.jsonl"

if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

# Classify: check error message against known patterns (case-insensitive)
ERROR_LOWER=$(python3 -c "print('''$ERROR_MSG'''.lower())")
CLASSIFICATION="human-needed"

if python3 -c "
msg = '''$ERROR_LOWER'''
if any(kw in msg for kw in ('permission denied','access denied','eacces','forbidden','unauthorized')):
    raise SystemExit(10)
if any(kw in msg for kw in ('timeout','timed out','connection refused','econnrefused','etimedout')):
    raise SystemExit(20)
if any(kw in msg for kw in ('not found','does not exist','enoent','no such file','missing')):
    raise SystemExit(30)
"; then
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
TMP_FILE="$STATE_FILE.tmp.$$"
python3 -c "
import json
d = json.load(open('$STATE_FILE'))
for t in d.get('tasks', []):
    if t['id'] == '$TASK_ID':
        t['status'] = 'failed'
        t['classification'] = '$CLASSIFICATION'
        t['error'] = '''$ERROR_MSG'''
        break
d['updated_at'] = '$NOW'
with open('$TMP_FILE', 'w') as f:
    json.dump(d, f, indent=2)
"
mv "$TMP_FILE" "$STATE_FILE"

# Append task_failed event
python3 -c "
import json
event = {'ts': '$NOW', 'run_id': '$RUN_ID', 'event': 'task_failed', 'task_id': '$TASK_ID', 'classification': '$CLASSIFICATION', 'error': '''$ERROR_MSG'''}
with open('$EVENTS_FILE', 'a') as f:
    f.write(json.dumps(event) + '\n')
"

echo "$CLASSIFICATION"
