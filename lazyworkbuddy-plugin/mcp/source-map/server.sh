#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<<"$INPUT" || echo "")
ID=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',0))" 2>/dev/null <<<"$INPUT" || echo "0")
CWD="${CWD:-.}"
reply() { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"result\":$1}"; }
err()  { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"error\":{\"code\":-32603,\"message\":\"$1\"}}"; }
param_raw() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('params',{}).get('$1',''))" 2>/dev/null <<<"$INPUT"; }

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"source-map","version":"0.8.0"}}'
    ;;
  tools/list)
    reply '{"tools":[
      {"name":"index_repo","description":"Index SKILL.md files in a directory","inputSchema":{"type":"object","properties":{"path":{"type":"string"}}}},
      {"name":"search_method_evidence","description":"Search for evidence in reference/ and docs/","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
      {"name":"read_evidence_excerpt","description":"Read lines from a file","inputSchema":{"type":"object","properties":{"file_path":{"type":"string"},"start_line":{"type":"integer"},"line_count":{"type":"integer"}},"required":["file_path"]}},
      {"name":"list_source_paths","description":"List top-level structure of reference/ and docs/","inputSchema":{"type":"object","properties":{}}},
      {"name":"compute_file_hash","description":"Compute md5 hash and size of a file","inputSchema":{"type":"object","properties":{"file_path":{"type":"string"}},"required":["file_path"]}}
    ]}'
    ;;
  index_repo)
    P=$(param_raw "path"); P="${P:-reference/lazycodex/plugins/omo/skills/}"
    RESULT=$(find "$CWD/$P" -name "SKILL.md" -type f 2>/dev/null | sort | python3 <<'PYEOF'
import json,os,sys; cwd=os.environ['CWD']; r=[]
for f in (l.strip() for l in sys.stdin if l.strip()):
    r.append({'path':os.path.relpath(f,cwd),'size':os.path.getsize(f)})
print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  search_method_evidence)
    Q=$(param_raw "query"); [ -z "$Q" ] && { err "query required"; exit 0; }
    RESULT=$(python3 - "$Q" <<'PYEOF'
import json,subprocess,os,sys
cwd=os.environ['CWD']; q=sys.argv[1]; r=[]
for d in ['reference/lazycodex','docs']:
    dp=os.path.join(cwd,d)
    if not os.path.isdir(dp): continue
    try:
        out=subprocess.check_output(['grep','-rnI','--',q,dp],stderr=subprocess.DEVNULL,text=True)
        for ln in out.strip().split('\n')[:50]:
            p=ln.split(':',2)
            if len(p)<3: continue
            fp=p[0]; fp=fp[len(cwd)+1:] if fp.startswith(cwd+'/') else fp
            r.append({'file':fp,'line':int(p[1]),'preview':p[2][:100]})
    except: pass
print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  read_evidence_excerpt)
    FP=$(param_raw "file_path"); SL=$(param_raw "start_line"); SL="${SL:-1}"
    LC=$(param_raw "line_count"); LC="${LC:-20}"
    [ -z "$FP" ] && { err "file_path required"; exit 0; }
    [ ! -f "$CWD/$FP" ] && { err "file not found: $FP"; exit 0; }
    C=$(tail -n "+$SL" "$CWD/$FP" | head -n "$LC" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")
    reply "{\"file\":\"$FP\",\"start\":$SL,\"count\":$LC,\"content\":$C}"
    ;;
  list_source_paths)
    RESULT=$(python3 <<'PYEOF'
import json,os; cwd=os.environ['CWD']
def tree(d):
    p=os.path.join(cwd,d)
    if not os.path.isdir(p): return []
    return [{'name':n,'type':'dir' if os.path.isdir(os.path.join(p,n)) else 'file'} for n in sorted(os.listdir(p))]
r={'reference':{'lazycodex':{'plugins':{'omo':tree('reference/lazycodex/plugins/omo')}}},'docs':tree('docs')}
print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  compute_file_hash)
    FP=$(param_raw "file_path"); [ -z "$FP" ] && { err "file_path required"; exit 0; }
    [ ! -f "$CWD/$FP" ] && { err "file not found: $FP"; exit 0; }
    H=$(md5 -q "$CWD/$FP" 2>/dev/null || md5sum "$CWD/$FP" 2>/dev/null | cut -d' ' -f1)
    S=$(wc -c <"$CWD/$FP" | tr -d ' ')
    reply "{\"hash\":\"$H\",\"size\":$S}"
    ;;
  *)
    err "unknown method: $METHOD"
    ;;
esac
