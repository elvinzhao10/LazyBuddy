#!/usr/bin/env bash
# verification MCP server — JSON-RPC over stdin/stdout, wraps v0.7 loop scripts
set -euo pipefail; INPUT=$(cat)
METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<<"$INPUT" || echo "")
ID=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',0))" 2>/dev/null <<<"$INPUT" || echo "0")
CWD="${CWD:-.}"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
reply() { printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$ID" "$1"; }
err() { printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32603,"message":"%s"}}\n' "$ID" "$1"; }

TOOL_LIST='{"tools":[
  {"name":"discover_checks","description":"Read verification-matrix.md, return checks as JSON","inputSchema":{"type":"object","properties":{"section":{"type":"string"}}}},
  {"name":"run_check","description":"Classify a task failure and record the event","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"task_id":{"type":"string"},"error_message":{"type":"string"}},"required":["run_id","task_id","error_message"]}},
  {"name":"record_gate_result","description":"Record gate result to events.jsonl","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"gate_name":{"type":"string"},"status":{"type":"string","enum":["passed","failed"]},"result":{"type":"string"}},"required":["run_id","gate_name","status"]}},
  {"name":"list_gate_results","description":"Read verification gates from state.json","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}},
  {"name":"create_repair_task","description":"Create repair task for a failed task","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"},"failed_task_id":{"type":"string"},"classification":{"type":"string"}},"required":["run_id","failed_task_id","classification"]}},
  {"name":"summarize_verification","description":"Summarize verification from state.json + events.jsonl","inputSchema":{"type":"object","properties":{"run_id":{"type":"string"}},"required":["run_id"]}}
]}'

arg() { echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
arg_req() { echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])" 2>/dev/null; }
run_script() { CWD="$CWD" bash "$PLUGIN_ROOT/scripts/$1" "$RID" "${@:2}" 2>/dev/null; }

py_discover() {
  SECTION="$1" python3 << 'PYEOF'
import json, os; cwd = os.environ.get('CWD', '.'); sect = os.environ.get('SECTION', '')
text = open(os.path.join(cwd, 'docs/lazyworkbuddy-verification-matrix.md')).read()
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

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"verification","version":"0.8.0"}}' ;;
  tools/list) reply "$TOOL_LIST" ;;
  tools/call)
    TNAME=$(python3 -c "import sys,json; print(json.load(sys.stdin)['params']['name'])" 2>/dev/null <<<"$INPUT")
    ARGS=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['params'].get('arguments',{})))" 2>/dev/null <<<"$INPUT")
    RID=$(arg run_id)
    case "$TNAME" in
      discover_checks)
        SECT=$(arg section); reply "$(py_discover "$SECT")" ;;
      run_check)
        TID=$(arg_req task_id); EMSG=$(arg_req error_message)
        CLASS=$(run_script loop/classify-failure.sh "$TID" "$EMSG")
        printf '{"jsonrpc":"2.0","id":%s,"result":{"status":"ok","classification":"%s"}}\n' "$ID" "$CLASS" ;;
      record_gate_result)
        GNAME=$(arg_req gate_name); GST=$(arg_req status); GRES=$(arg result); NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        mkdir -p "$CWD/.lazyworkbuddy/runs/$RID"
        python3 -c "
import json, os; cwd=os.environ['CWD']; rid=os.environ['RID']
ev=dict(ts=os.environ['NOW'], run_id=rid, event='gate_result', gate=os.environ['GNAME'], status=os.environ['GST'], result=os.environ.get('GRES',''))
with open(os.path.join(cwd,'.lazyworkbuddy/runs',rid,'events.jsonl'),'a') as f: f.write(json.dumps(ev)+'\n')
"
        printf '{"jsonrpc":"2.0","id":%s,"result":{"status":"ok","gate":"%s","gate_result":"%s"}}\n' "$ID" "$GNAME" "$GST" ;;
      list_gate_results)
        SF="$CWD/.lazyworkbuddy/runs/$RID/state.json"
        [ -f "$SF" ] && reply "$(python3 -c "import json; d=json.load(open('$SF')); print(json.dumps(d.get('verification_gates',[])))")" || err "run not found: $RID" ;;
      create_repair_task)
        FTID=$(arg_req failed_task_id); CLS=$(arg_req classification)
        NEWID=$(run_script loop/create-repair-task.sh "$FTID" "$CLS")
        printf '{"jsonrpc":"2.0","id":%s,"result":{"status":"ok","repair_task_id":"%s"}}\n' "$ID" "$NEWID" ;;
      summarize_verification)
        SF="$CWD/.lazyworkbuddy/runs/$RID/state.json"
        [ -f "$SF" ] || { err "run not found: $RID"; continue; }
        reply "$(export RID CWD; python3 << 'PYEOF'
import json, os; cwd=os.environ.get('CWD','.'); rid=os.environ['RID']
sf=os.path.join(cwd,'.lazyworkbuddy/runs',rid,'state.json')
ef=os.path.join(cwd,'.lazyworkbuddy/runs',rid,'events.jsonl')
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
