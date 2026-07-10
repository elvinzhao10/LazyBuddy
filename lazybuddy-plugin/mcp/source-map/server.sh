#!/usr/bin/env bash
set -euo pipefail
CWD="${CWD:-.}"
export CWD
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
reply() {
  python3 - "$ID_JSON" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "result": json.loads(sys.argv[2])}))
PYEOF
}
err() {
  python3 - "$ID_JSON" "$1" <<'PYEOF'
import json
import sys

print(json.dumps({"jsonrpc": "2.0", "id": json.loads(sys.argv[1]), "error": {"code": -32603, "message": sys.argv[2]}}))
PYEOF
}
param_raw() { python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('params',{}); a=p.get('arguments',p); print(a.get('$1',''))" 2>/dev/null <<<"$INPUT"; }
safe_path() { python3 "$PLUGIN_ROOT/mcp/path_boundary.py" "$CWD" "$1"; }

while IFS= read -r INPUT || [ -n "$INPUT" ]; do
METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<<"$INPUT" || echo "")
ID_JSON=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('id',0)))" 2>/dev/null <<<"$INPUT" || echo "0")

if [ "$METHOD" = "tools/call" ]; then
    METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('params',{}).get('name',''))" 2>/dev/null <<<"$INPUT" || echo "")
fi

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"source-map","version":"0.15.0-alpha.2"}}'
    ;;
  tools/list)
    reply '{"tools":[
      {"name":"index_repo","description":"Index SKILL.md files in a directory","inputSchema":{"type":"object","properties":{"path":{"type":"string"}}}},
      {"name":"search_method_evidence","description":"Search for evidence in dev/reference/ and docs/","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
      {"name":"read_evidence_excerpt","description":"Read lines from a file","inputSchema":{"type":"object","properties":{"file_path":{"type":"string"},"start_line":{"type":"integer"},"line_count":{"type":"integer"}},"required":["file_path"]}},
      {"name":"list_source_paths","description":"List top-level structure of dev/reference/ and docs/","inputSchema":{"type":"object","properties":{}}},
      {"name":"compute_file_hash","description":"Compute md5 hash and size of a file","inputSchema":{"type":"object","properties":{"file_path":{"type":"string"}},"required":["file_path"]}}
    ]}'
    ;;
  index_repo)
    P=$(param_raw "path"); P="${P:-dev/reference/lazycodex/plugins/omo/skills/}"
    ROOT=$(safe_path "$P") || { err "path is outside project root"; continue; }
    [ -d "$ROOT" ] || { err "directory not found: $P"; continue; }
    RESULT=$(find "$ROOT" -name "SKILL.md" -type f 2>/dev/null | sort | python3 -c "import json,os,sys; cwd=os.path.realpath(sys.argv[1]); print(json.dumps([{'path':os.path.relpath(f.strip(), cwd),'size':os.path.getsize(f.strip())} for f in sys.stdin if f.strip()]))" "$CWD")
    reply "$RESULT"
    ;;
  search_method_evidence)
    Q=$(param_raw "query"); [ -z "$Q" ] && { err "query required"; continue; }
    RESULT=$(python3 - "$Q" <<'PYEOF'
import json,subprocess,os,sys
cwd=os.environ['CWD']; q=sys.argv[1]; r=[]
for d in ['dev/reference/lazycodex','docs']:
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
    [ -z "$FP" ] && { err "file_path required"; continue; }
    FILE=$(safe_path "$FP") || { err "path is outside project root"; continue; }
    [ ! -f "$FILE" ] && { err "file not found: $FP"; continue; }
    C=$(tail -n "+$SL" "$FILE" | head -n "$LC" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")
    reply "{\"file\":\"$FP\",\"start\":$SL,\"count\":$LC,\"content\":$C}"
    ;;
  list_source_paths)
    RESULT=$(python3 <<'PYEOF'
import json,os; cwd=os.environ['CWD']
def tree(d):
    p=os.path.join(cwd,d)
    if not os.path.isdir(p): return []
    return [{'name':n,'type':'dir' if os.path.isdir(os.path.join(p,n)) else 'file'} for n in sorted(os.listdir(p))]
r={'reference':{'lazycodex':{'plugins':{'omo':tree('dev/reference/lazycodex/plugins/omo')}}},'docs':tree('docs')}
print(json.dumps(r))
PYEOF
)
    reply "$RESULT"
    ;;
  compute_file_hash)
    FP=$(param_raw "file_path"); [ -z "$FP" ] && { err "file_path required"; continue; }
    FILE=$(safe_path "$FP") || { err "path is outside project root"; continue; }
    [ ! -f "$FILE" ] && { err "file not found: $FP"; continue; }
    H=$(md5 -q "$FILE" 2>/dev/null || md5sum "$FILE" 2>/dev/null | cut -d' ' -f1)
    S=$(wc -c <"$FILE" | tr -d ' ')
    reply "{\"hash\":\"$H\",\"size\":$S}"
    ;;
  *)
    err "unknown method: $METHOD"
    ;;
esac
done
