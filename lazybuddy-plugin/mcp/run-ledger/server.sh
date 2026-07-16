#!/usr/bin/env bash
set -euo pipefail

CWD="${CWD:-.}"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/scripts/state/state-paths.sh"
NOTIFICATION=0

request_kind() {
  python3 -c '
import json, math, sys
try:
    request = json.load(sys.stdin)
except json.JSONDecodeError:
    print("parse")
    raise SystemExit
valid_id = lambda value: value is None or isinstance(value, str) or (isinstance(value, int) and not isinstance(value, bool)) or (isinstance(value, float) and math.isfinite(value))
if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str) or request["method"].startswith("rpc.") or ("id" in request and not valid_id(request["id"])):
    print("invalid")
elif "id" not in request:
    print("notification")
else:
    print("request")
' <<< "$INPUT"
}

protocol_error() {
  python3 - "$1" "$2" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": int(sys.argv[1]), "message": sys.argv[2]}}))
PYEOF
}

reply() {
  [ "$NOTIFICATION" = 1 ] && return 0
  python3 - "$ID_JSON" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "result": json.loads(sys.argv[2])}))
PYEOF
}

err() {
  [ "$NOTIFICATION" = 1 ] && return 0
  local code="-32603"
  if [ "$1" = "-32602" ]; then
    code="$1"
    shift
  fi
  python3 - "$ID_JSON" "$code" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({
    "jsonrpc": "2.0",
    "id": json.loads(sys.argv[1]),
    "error": {"code": int(sys.argv[2]), "message": sys.argv[3] or "state operation failed"},
}))
PYEOF
}

result_object() {
  python3 - "$@" <<'PYEOF'
import json
import sys

pairs = sys.argv[1:]
if len(pairs) % 2:
    raise SystemExit("result_object requires key/value pairs")
print(json.dumps(dict(zip(pairs[::2], pairs[1::2]))))
PYEOF
}

lines_as_json_array() {
  python3 - "$1" <<'PYEOF'
import json
import sys

print(json.dumps([line for line in sys.argv[1].splitlines() if line]))
PYEOF
}

run_state() {
  local script="$PLUGIN_ROOT/scripts/state/$1"
  shift
  STATE_OUTPUT=""
  if [ ! -x "$script" ]; then
    err "state script not found: $(basename "$script")"
    return 1
  fi
  if ! STATE_OUTPUT=$(CWD="$CWD" bash "$script" "$@" 2>&1); then
    err "${STATE_OUTPUT:-state script failed: $(basename "$script")}"
    return 1
  fi
}

require_string_arg() {
  ARG_VALUE=""
  if ! ARG_VALUE=$(python3 - "$1" "$ARGS" <<'PYEOF'
import json
import sys

value = json.loads(sys.argv[2]).get(sys.argv[1])
if not isinstance(value, str) or not value:
    raise SystemExit(1)
print(value)
PYEOF
  ); then
    err "invalid or missing string argument: $1"
    return 1
  fi
}

require_object_arg() {
  ARG_VALUE=""
  if ! ARG_VALUE=$(python3 - "$1" "$ARGS" <<'PYEOF'
import json
import sys

value = json.loads(sys.argv[2]).get(sys.argv[1], {})
if not isinstance(value, dict):
    raise SystemExit(1)
print(json.dumps(value))
PYEOF
  ); then
    err "invalid object argument: $1"
    return 1
  fi
}

read_state_file() {
  python3 - "$1" <<'PYEOF'
import json
import sys

with open(sys.argv[1]) as state_file:
    print(json.dumps(json.load(state_file)))
PYEOF
}

TOOL_LIST='{"tools":[
  {"name":"create_run","description":"Create a new autonomous run","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"objective":{"type":"string"}},"required":["run_id","objective"]}},
  {"name":"list_runs","description":"List all runs with status","inputSchema":{"type":"object","properties":{}}},
  {"name":"latest_run","description":"Get the most recently updated active run ID","inputSchema":{"type":"object","properties":{}}},
  {"name":"read_state","description":"Read full state.json for a run","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
  {"name":"summarize_run","description":"Human-readable run summary from state only","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
  {"name":"append_event","description":"Append an event to events.jsonl","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"event_type":{"type":"string"},"payload":{"type":"object"}},"required":["run_id","event_type"]}},
  {"name":"update_task","description":"Update a task status in state.json","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"task_id":{"type":"string"},"status":{"type":"string"}},"required":["run_id","task_id","status"]}},
  {"name":"create_checkpoint","description":"Snapshot current state","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
  {"name":"recover_run","description":"Recover state from latest checkpoint","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}}
]}'

while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  case "$(request_kind)" in
    parse) protocol_error -32700 "Parse error"; continue ;;
    invalid) protocol_error -32600 "Invalid Request"; continue ;;
    notification) NOTIFICATION=1 ;;
    request) NOTIFICATION=0 ;;
  esac
  METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<< "$INPUT" || echo "")
  ID_JSON=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('id',None)))" 2>/dev/null <<< "$INPUT" || echo "null")

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"run-ledger","version":"0.18.0"}}'
    ;;
  tools/list)
    reply "$TOOL_LIST"
    ;;
  tools/call)
    if ! TOOL=$(python3 -c "import sys,json; d=json.load(sys.stdin); value=d['params']['name']; assert isinstance(value, str); print(value)" 2>/dev/null <<< "$INPUT"); then
      err -32602 "tools/call requires object params with string name and object arguments"
      continue
    fi
    if ! ARGS=$(python3 -c "import sys,json; d=json.load(sys.stdin); value=d['params'].get('arguments',{}); assert isinstance(value, dict); print(json.dumps(value))" 2>/dev/null <<< "$INPUT"); then
      err -32602 "tools/call requires object params with string name and object arguments"
      continue
    fi

    case "$TOOL" in
      create_run)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        require_string_arg objective || continue; OBJ="$ARG_VALUE"
        if run_state create-run.sh "$RID" "$OBJ"; then
          reply "$(result_object status ok run_id "$RID")"
        fi
        ;;
      list_runs)
        if run_state list-runs.sh; then
          RUN_LINES=$(printf '%s\n' "$STATE_OUTPUT" | tail -n +3 | awk '{print $1}' | grep -v '^$' || true)
          RUNS=$(lines_as_json_array "$RUN_LINES")
          COUNT=$(python3 - "$RUNS" <<'PYEOF'
import json
import sys
print(len(json.loads(sys.argv[1])))
PYEOF
)
          reply "{\"runs\":$RUNS,\"count\":$COUNT}"
        fi
        ;;
      latest_run)
        if run_state latest-run.sh; then
          reply "$(result_object output "$STATE_OUTPUT")"
        fi
        ;;
      read_state)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        if ! state_require_run_dir "$CWD" "$RID"; then
          err "invalid or unsafe run_id"
        elif ! state_require_existing_run_file "$STATE_RUN_DIR/state.json" "state file"; then
          err "run not found: $RID"
        elif ! STATE_JSON=$(read_state_file "$STATE_RUN_DIR/state.json" 2>&1); then
          err "${STATE_JSON:-failed to read run state}"
        else
          reply "$STATE_JSON"
        fi
        ;;
      summarize_run)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        if run_state summarize-run.sh "$RID"; then
          SUMMARY_LINES=$(printf '%s\n' "$STATE_OUTPUT" | grep -v '^===' || true)
          SUMMARY=$(lines_as_json_array "$SUMMARY_LINES")
          reply "{\"summary\":$SUMMARY}"
        fi
        ;;
      append_event)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        require_string_arg event_type || continue; EVENT_TYPE="$ARG_VALUE"
        require_object_arg payload || continue; PAYLOAD="$ARG_VALUE"
        if run_state append-event.sh "$RID" "$EVENT_TYPE" "$PAYLOAD"; then
          reply '{"status":"ok","event_appended":true}'
        fi
        ;;
      update_task)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        require_string_arg task_id || continue; TID="$ARG_VALUE"
        require_string_arg status || continue; TSTAT="$ARG_VALUE"
        if run_state update-task.sh "$RID" "$TID" "$TSTAT"; then
          reply "$(result_object status ok task_id "$TID" new_status "$TSTAT")"
        fi
        ;;
      create_checkpoint)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        if run_state checkpoint.sh "$RID"; then
          if [ -z "$STATE_OUTPUT" ]; then
            err "checkpoint script returned no checkpoint path"
          else
            reply "$(result_object status ok checkpoint "$STATE_OUTPUT")"
          fi
        fi
        ;;
      recover_run)
        require_string_arg run_id || continue; RID="$ARG_VALUE"
        if run_state recover-run.sh "$RID"; then
          reply '{"status":"ok","recovered":true}'
        fi
        ;;
      *) err "unknown tool: $TOOL" ;;
    esac
    ;;
  *)
    err "unsupported method: $METHOD"
    ;;
esac
done
