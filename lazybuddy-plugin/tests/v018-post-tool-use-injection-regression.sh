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
    "tool_input": {"command": "curl -H 'Bearer BEARER_FIXTURE' --api-key API_KEY_FIXTURE https://example.test"},
}))
PY
)"

printf '%s' "$bash_payload" | bash "$HOOK"
if grep -Fq -e 'BEARER_FIXTURE' -e 'API_KEY_FIXTURE' "$RUN_DIR/events.jsonl"; then
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

# Given one corrupt candidate state before a second valid active run, when the
# hook resolves lifecycle state, then it must fail typed instead of recording
# against the wrong run.
CORRUPT_RUN="$TMP/.lazybuddy/runs/000-corrupt"
WRONG_RUN="$TMP/.lazybuddy/runs/zzz-active"
mkdir -p "$CORRUPT_RUN" "$WRONG_RUN"
printf '{bad\n' > "$CORRUPT_RUN/state.json"
printf '{"status":"active"}\n' > "$WRONG_RUN/state.json"
rm -f "$RUN_DIR/state.json"
if printf '%s' "$normal_payload" | bash "$HOOK" >"$TMP/corrupt.out" 2>"$TMP/corrupt.err"; then
    fail 'corrupt active state was treated as absence'
fi
python3 - "$TMP/corrupt.err" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    error = json.load(handle)
assert error == {"error": "active_state_corrupt"}
PY
[ ! -e "$WRONG_RUN/events.jsonl" ] || fail 'corrupt candidate caused a wrong-run lifecycle record'

rm -rf "$CORRUPT_RUN" "$WRONG_RUN"
UNREADABLE_RUN="$TMP/.lazybuddy/runs/000-unreadable"
WRONG_RUN="$TMP/.lazybuddy/runs/zzz-active"
mkdir -p "$UNREADABLE_RUN/state.json" "$WRONG_RUN"
printf '{"status":"active"}\n' > "$WRONG_RUN/state.json"
if printf '%s' "$normal_payload" | bash "$HOOK" >"$TMP/unreadable.out" 2>"$TMP/unreadable.err"; then
    fail 'unreadable active state was treated as absence'
fi
python3 - "$TMP/unreadable.err" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    error = json.load(handle)
assert error == {"error": "active_state_unreadable"}
PY
[ ! -e "$WRONG_RUN/events.jsonl" ] || fail 'unreadable candidate caused a wrong-run lifecycle record'

# Given no runs root at all, the legacy no-active-run pass-through remains
# silent and successful.
EMPTY_PROJECT="$TMP/no-runs-root"
mkdir -p "$EMPTY_PROJECT"
empty_payload="$(python3 - "$EMPTY_PROJECT" <<'PY'
import json
import sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "Read", "tool_input": {}}))
PY
)"
printf '%s' "$empty_payload" | bash "$HOOK" >"$TMP/empty.out" 2>"$TMP/empty.err"
[ ! -s "$TMP/empty.out" ] && [ ! -s "$TMP/empty.err" ] || fail 'absent runs root changed pass-through output'

echo 'v0.18 PostToolUse injection regression: PASS'
