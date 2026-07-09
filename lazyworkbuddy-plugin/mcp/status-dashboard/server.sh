#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<<"$INPUT" || echo "")
ID=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',0))" 2>/dev/null <<<"$INPUT" || echo "0")
CWD="${CWD:-.}"
reply() { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"result\":$1}"; }
err()  { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"error\":{\"code\":-32603,\"message\":\"$1\"}}"; }
param_raw() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('params',{}).get('$1',''))" 2>/dev/null <<<"$INPUT"; }
resolve_run() {
  local rid="${1:-$(bash "$CWD/scripts/state/latest-run.sh" 2>/dev/null || echo "")}"
  [ -z "$rid" ] && { err "no run_id and no active runs"; exit 1; }
  [ ! -f "$CWD/scripts/state/$rid/state.json" ] && { err "state file not found"; exit 1; }
  echo "$CWD/scripts/state/$rid/state.json"
}
case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"status-dashboard","version":"0.8.0"}}'
    ;;
  tools/list)
    reply '{"tools":[
      {"name":"show_run_status","description":"Show current run status","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}}}},
      {"name":"show_task_graph","description":"Show task dependency graph","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
      {"name":"show_verification_matrix","description":"Show verification gate results","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
      {"name":"show_parity_coverage","description":"Show parity method coverage counts","inputSchema":{"type":"object","properties":{}}},
      {"name":"show_pending_approvals","description":"Show pending human gates and reviews","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}}}}
    ]}'
    ;;
  show_run_status)
    SF=$(resolve_run "$(param_raw "run_id")") || exit 0
    RESULT=$(python3 "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); t=s.get('tasks',[]); d=sum(1 for x in t if x.get('status')=='done')
g=s.get('verification_gates',[]); gd=sum(1 for x in g if x.get('status')=='passed')
r={'status':s.get('status',''),'objective':s.get('objective',''),'tasks_done':d,'tasks_total':len(t),'verification_gates':f'{gd}/{len(g)}','review_status':s.get('review_status',''),'iteration_count':s.get('iteration_count',0),'last_checkpoint':s.get('last_checkpoint',''),'run_id':s.get('run_id','')}; print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  show_task_graph)
    SF=$(resolve_run "$(param_raw "run_id")") || exit 0
    RESULT=$(python3 "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); t=s.get('tasks',[]); n=[{'id':x.get('id',''),'title':x.get('title',''),'status':x.get('status','')} for x in t]; e=[{'from':d,'to':x.get('id','')} for x in t for d in x.get('depends_on',[])]; print(json.dumps({'nodes':n,'edges':e}))
PYEOF
)
    reply "$RESULT"
    ;;
  show_verification_matrix)
    SF=$(resolve_run "$(param_raw "run_id")") || exit 0
    RESULT=$(python3 "$SF" <<'PYEOF'
import json,sys
with open(sys.argv[1]) as f: s=json.load(f); g=[{'name':x.get('name',''),'status':x.get('status',''),'result':x.get('result','')} for x in s.get('verification_gates',[])]; print(json.dumps(g))
PYEOF
)
    reply "$RESULT"
    ;;
  show_parity_coverage)
    F="$CWD/docs/lazyworkbuddy-parity-ledger.md"
    [ ! -f "$F" ] && { err "parity ledger not found: $F"; exit 0; }
    RESULT=$(python3 "$F" <<'PYEOF'
import json,sys,re
with open(sys.argv[1]) as f: lines=f.readlines()
c={'matched':0,'adapted':0,'skipped':0,'added':0}
for l in lines:
    s=l.strip()
    if s.startswith('|') and '---' not in s:
        cs=[x.strip().lower() for x in s.split('|')]
        if not any(h in ''.join(cs[:2]) for h in ('method','status')):
            for k in c:
                if k in cs: c[k]+=1
c['total']=sum(c.values())
print(json.dumps(c))
PYEOF
)
    reply "$RESULT"
    ;;
  show_pending_approvals)
    SF=$(resolve_run "$(param_raw "run_id")") || exit 0
    RESULT=$(python3 "$SF" <<'PYEOF'
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
