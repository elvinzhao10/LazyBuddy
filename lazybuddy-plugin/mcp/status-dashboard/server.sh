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

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "error": {"code": int(sys.argv[2]), "message": sys.argv[3]}}))
PYEOF
}
param_raw() { python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('params',{}); a=p.get('arguments',p); print(a.get('$1',''))" 2>/dev/null <<<"$INPUT"; }
resolve_run() {
  local rid="${1:-$(CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/latest-run.sh" 2>/dev/null || echo "")}"
  [ -n "$rid" ] || return 1
  state_require_run_dir "$CWD" "$rid" || return 1
  state_require_existing_run_file "$STATE_RUN_DIR/state.json" "state file" || return 1
  echo "$STATE_RUN_DIR/state.json"
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

if [ "$METHOD" = "tools/call" ]; then
    if ! METHOD=$(python3 -c "import json,sys; params=json.load(sys.stdin).get('params'); assert isinstance(params, dict); assert isinstance(params.get('name'), str); assert isinstance(params.get('arguments', {}), dict); print(params['name'])" 2>/dev/null <<<"$INPUT"); then
        err -32602 "tools/call requires object params with string name and object arguments"
        continue
    fi
fi

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"status-dashboard","version":"1.0.1"}}'
    ;;
  tools/list)
    reply '{"tools":[
      {"name":"show_run_status","description":"Show current run status","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}}}},
      {"name":"show_task_graph","description":"Show task dependency graph","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
      {"name":"show_verification_matrix","description":"Show verification gate results","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
      {"name":"show_pending_approvals","description":"Show pending human gates and reviews","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}}}}
    ]}'
    ;;
  show_run_status)
    SF=$(resolve_run "$(param_raw "run_id")") || { err "invalid or unsafe run_id"; continue; }
    RESULT=$(python3 - "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); t=s.get('tasks',[]); d=sum(1 for x in t if x.get('status')=='done')
g=s.get('verification_gates',[]); gd=sum(1 for x in g if x.get('status')=='passed')
r={'status':s.get('status',''),'objective':s.get('objective',''),'tasks_done':d,'tasks_total':len(t),'verification_gates':f'{gd}/{len(g)}','review_status':s.get('review_status',''),'iteration_count':s.get('iteration_count',0),'last_checkpoint':s.get('last_checkpoint',''),'run_id':s.get('run_id','')}; print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  show_task_graph)
    SF=$(resolve_run "$(param_raw "run_id")") || { err "invalid or unsafe run_id"; continue; }
    RESULT=$(python3 - "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); t=s.get('tasks',[]); n=[{'id':x.get('id',''),'title':x.get('title',''),'status':x.get('status','')} for x in t]; e=[{'from':d,'to':x.get('id','')} for x in t for d in x.get('depends_on',[])]; print(json.dumps({'nodes':n,'edges':e}))
PYEOF
)
    reply "$RESULT"
    ;;
  show_verification_matrix)
    SF=$(resolve_run "$(param_raw "run_id")") || { err "invalid or unsafe run_id"; continue; }
    RESULT=$(python3 - "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); g=[{'name':x.get('name',''),'status':x.get('status',''),'result':x.get('result','')} for x in s.get('verification_gates',[])]; print(json.dumps(g))
PYEOF
)
    reply "$RESULT"
    ;;
  show_pending_approvals)
    SF=$(resolve_run "$(param_raw "run_id")") || { err "invalid or unsafe run_id"; continue; }
    RESULT=$(python3 - "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); p=[g for g in s.get('human_gates',[]) if g.get('status','')=='pending']
if s.get('review_status','')=='pending': p.append({'name':'review','status':'pending','result':''})
print(json.dumps(p))
PYEOF
)
    reply "$RESULT"
    ;;
  *)
    err "unknown method: $METHOD"
    ;;
esac
done
