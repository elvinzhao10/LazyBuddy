#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$PLUGIN_ROOT/scripts/hooks/post-tool-use.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

RUN_DIR="$TMP/.lazybuddy/runs/active"
mkdir -p "$RUN_DIR"
printf '{"status":"active"}\n' > "$RUN_DIR/state.json"
SENTINEL="$TMP/tool-name-code-executed"

malicious_payload="$(python3 - "$TMP" "$SENTINEL" <<'PY'
import json
import sys

print(json.dumps({
    "cwd": sys.argv[1],
    "tool_name": "Read' and __import__('pathlib').Path(" + repr(sys.argv[2]) + ").touch() is None and 'Read",
    "tool_input": {},
}))
PY
)"

printf '%s' "$malicious_payload" | bash "$HOOK"
[ ! -e "$SENTINEL" ] || fail 'malicious tool_name executed Python code'
python3 - "$RUN_DIR/events.jsonl" "$malicious_payload" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as event_file:
    event = json.loads(event_file.read())

assert event["tool"] == json.loads(sys.argv[2])["tool_name"]
PY

normal_payload="$(python3 - "$TMP" <<'PY'
import json
import sys

print(json.dumps({
    "cwd": sys.argv[1],
    "tool_name": "Write",
    "tool_input": {"file_path": ".lazybuddy/notes.md"},
}))
PY
)"

printf '%s' "$normal_payload" | bash "$HOOK"
python3 - "$RUN_DIR/events.jsonl" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as event_file:
    event = [json.loads(line) for line in event_file]

assert event[1]["tool"] == "Write"
assert event[1]["files"] == [".lazybuddy/notes.md"]
assert "boundary_warning" not in event[1]
PY

bash_payload="$(python3 - "$TMP" <<'PY'
import json
import sys

print(json.dumps({
    "cwd": sys.argv[1],
    "tool_name": "Bash",
    "tool_input": {"command": "curl -H 'Bearer TOP_SECRET_1234567890' --api-key API_SECRET_987654 https://example.test"},
}))
PY
)"

printf '%s' "$bash_payload" | bash "$HOOK"
if grep -Fq -e 'TOP_SECRET_1234567890' -e 'API_SECRET_987654' "$RUN_DIR/events.jsonl"; then
    fail 'Bash event retained a secret value'
fi
python3 - "$RUN_DIR/events.jsonl" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as event_file:
    events = [json.loads(line) for line in event_file]

assert events[2]["tool"] == "Bash"
assert "description" not in events[2]
PY

printf '{not-json' | bash "$HOOK"
[ "$(wc -l < "$RUN_DIR/events.jsonl")" -eq 3 ] || fail 'malformed payload wrote an event'

echo 'v0.18 PostToolUse injection regression: PASS'
