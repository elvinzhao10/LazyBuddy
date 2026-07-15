#!/usr/bin/env bash
# verification MCP server — newline-delimited JSON-RPC over stdin/stdout
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
  python3 - "$ID_JSON" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "error": {"code": -32603, "message": sys.argv[2]}}))
PYEOF
}
invalid_params() {
  [ "$NOTIFICATION" = 1 ] && return 0
  python3 - "$ID_JSON" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "error": {"code": -32602, "message": sys.argv[2]}}))
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

TOOL_LIST='{"tools":[
  {"name":"discover_checks","description":"Read the package-owned verification contract and return checks as JSON","inputSchema":{"type":"object","properties":{"section":{"type":"string"}}}},
  {"name":"run_check","description":"Classify a task failure and record the event","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"task_id":{"type":"string"},"error_message":{"type":"string"}},"required":["run_id","task_id","error_message"]}},
  {"name":"record_gate_result","description":"Record gate result to events.jsonl","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"gate_name":{"type":"string"},"status":{"type":"string","enum":["passed","failed"]},"result":{"type":"string"}},"required":["run_id","gate_name","status"]}},
  {"name":"list_gate_results","description":"Read verification gates from state.json","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
  {"name":"create_repair_task","description":"Create repair task for a failed task","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"failed_task_id":{"type":"string"},"classification":{"type":"string"}},"required":["run_id","failed_task_id","classification"]}},
  {"name":"summarize_verification","description":"Summarize verification from state.json + events.jsonl","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}}
]}'

arg() { echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
arg_req() { echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])" 2>/dev/null; }
run_script() { CWD="$CWD" bash "$PLUGIN_ROOT/scripts/$1" "$RID" "${@:2}" 2>/dev/null; }
resolve_run_state() {
  state_require_run_dir "$CWD" "$1" || return 1
  state_require_existing_run_file "$STATE_RUN_DIR/state.json" "state file" || return 1
  printf '%s\n' "$STATE_RUN_DIR/state.json"
}
require_run_events() {
  state_require_run_dir "$CWD" "$1" || return 1
  state_require_existing_run_file "$STATE_RUN_DIR/state.json" "state file" || return 1
  state_require_existing_run_file "$STATE_RUN_DIR/events.jsonl" "events file"
}

py_discover() {
  local matrix="$PLUGIN_ROOT/docs/verification-matrix.md"
  [ -f "$matrix" ] || return 1
  SECTION="$1" MATRIX="$matrix" python3 << 'PYEOF'
import json, os; cwd = os.environ.get('CWD', '.'); sect = os.environ.get('SECTION', '')
text = open(os.environ['MATRIX']).read()
checks, cur = [], ''
for line in text.split('\n'):
    if line.startswith('## '): cur = line.strip('# ').strip()
    if line.startswith('| ') and 'Verification Step' not in line and '---' not in line:
        cols = [c.strip() for c in line.split('|')[1:-1]]
        if cols and cols[0]: checks.append(dict(section=cur, step=cols[0], command=cols[1] if len(cols)>1 else '', expected=cols[2] if len(cols)>2 else '', artifact=cols[3] if len(cols)>3 else ''))
if sect and sect != 'all':
    checks = [c for c in checks if c['section'].lower().replace(' ','-').find(sect.lower().replace(' ','-')) >= 0]
print(json.dumps(checks))
PYEOF
}

while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  case "$(request_kind)" in
    parse) protocol_error -32700 "Parse error"; continue ;;
    invalid) protocol_error -32600 "Invalid Request"; continue ;;
    notification) NOTIFICATION=1 ;;
    request) NOTIFICATION=0 ;;
  esac
  METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<<"$INPUT" || echo "")
  ID_JSON=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('id',None)))" 2>/dev/null <<<"$INPUT" || echo "null")

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"verification","version":"0.17.0"}}' ;;
  tools/list) reply "$TOOL_LIST" ;;
  tools/call)
    if ! python3 -c "import json, sys; params=json.load(sys.stdin).get('params'); assert isinstance(params, dict) and isinstance(params.get('name'), str) and isinstance(params.get('arguments', {}), dict)" 2>/dev/null <<<"$INPUT"; then
      invalid_params "tools/call requires object params with string name and object arguments"
      continue
    fi
    TNAME=$(python3 -c "import sys,json; print(json.load(sys.stdin)['params']['name'])" 2>/dev/null <<<"$INPUT")
    ARGS=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['params'].get('arguments',{})))" 2>/dev/null <<<"$INPUT")
    RID=$(arg run_id)
    case "$TNAME" in
      discover_checks)
        SECT=$(arg section)
        if ! CHECKS=$(py_discover "$SECT" 2>/dev/null); then
          err "package verification contract is missing"
          continue
        fi
        reply "$CHECKS" ;;
      run_check)
        resolve_run_state "$RID" >/dev/null || { err "invalid or unsafe run_id"; continue; }
        TID=$(arg_req task_id); EMSG=$(arg_req error_message)
        CLASS=$(run_script loop/classify-failure.sh "$TID" "$EMSG")
        reply "$(result_object status ok classification "$CLASS")" ;;
      record_gate_result)
        resolve_run_state "$RID" >/dev/null || { err "invalid or unsafe run_id"; continue; }
        require_run_events "$RID" || { err "invalid or unsafe run_id"; continue; }
        export STATE_RUN_DIR
        GNAME=$(arg_req gate_name); GST=$(arg_req status); GRES=$(arg result); NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        export RID GNAME GST GRES NOW
        python3 -c "
import json, os; cwd=os.environ['CWD']; rid=os.environ['RID']
ev=dict(ts=os.environ['NOW'], run_id=rid, event='gate_result', gate=os.environ['GNAME'], status=os.environ['GST'], result=os.environ.get('GRES',''))
with open(os.environ['STATE_RUN_DIR'] + '/events.jsonl','a') as f: f.write(json.dumps(ev)+'\n')
"
        reply "$(result_object status ok gate "$GNAME" gate_result "$GST")" ;;
      list_gate_results)
        SF=$(resolve_run_state "$RID") || { err "invalid or unsafe run_id"; continue; }
        reply "$(python3 -c "import json; d=json.load(open('$SF')); print(json.dumps(d.get('verification_gates',[])))")" ;;
      create_repair_task)
        resolve_run_state "$RID" >/dev/null || { err "invalid or unsafe run_id"; continue; }
        FTID=$(arg_req failed_task_id); CLS=$(arg_req classification)
        NEWID=$(run_script loop/create-repair-task.sh "$FTID" "$CLS")
        reply "$(result_object status ok repair_task_id "$NEWID")" ;;
      summarize_verification)
        SF=$(resolve_run_state "$RID") || { err "invalid or unsafe run_id"; continue; }
        require_run_events "$RID" || { err "invalid or unsafe run_id"; continue; }
        export RID CWD SF STATE_RUN_DIR
        reply "$(python3 << 'PYEOF'
import json, os; cwd=os.environ.get('CWD','.'); rid=os.environ['RID']
sf=os.environ['SF']
ef=os.environ['STATE_RUN_DIR'] + '/events.jsonl'
state=json.load(open(sf)); events=[]
if os.path.exists(ef):
    with open(ef) as f:
        for line in f:
            if line.strip():
                try: events.append(json.loads(line))
                except: pass
tasks=state.get('tasks',[])
s=dict(run_id=rid, status=state.get('status','unknown'), task_count=len(tasks),
    completed_tasks=sum(1 for t in tasks if t.get('status')=='completed'),
    failed_tasks=sum(1 for t in tasks if t.get('status')=='failed'),
    event_count=len(events), gates=state.get('verification_gates',[]), updated_at=state.get('updated_at',''))
print(json.dumps(s))
PYEOF
)" ;;
      *) err "unknown tool: $TNAME" ;;
    esac ;;
  *) err "unsupported method: $METHOD" ;;
esac
done
