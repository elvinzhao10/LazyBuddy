#!/usr/bin/env bash
# parity MCP server — JSON-RPC over stdin/stdout for parity-ledger + known-gaps
set -euo pipefail
CWD="${CWD:-.}"
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

TOOL_LIST='{"tools":[
  {"name":"read_canonical_method_map","description":"Read parity-ledger.md method map as JSON","inputSchema":{"type":"object","properties":{"section":{"type":"string","description":"core-workflows, agent-roles, hooks, additions, all"}}}},
  {"name":"list_methods","description":"Return array of all tracked methods with status","inputSchema":{"type":"object","properties":{}}},
  {"name":"compare_method_status","description":"Look up method by name, return parity status","inputSchema":{"type":"object","properties":{"method_name":{"type":"string"}},"required":["method_name"]}},
  {"name":"update_parity_ledger","description":"Append dated v0.8 entry to parity-ledger.md","inputSchema":{"type":"object","properties":{"method_name":{"type":"string"},"new_status":{"type":"string"},"notes":{"type":"string"}},"required":["method_name","new_status"]}},
  {"name":"generate_gap_report","description":"Read known-gaps.md, return all gaps as JSON array","inputSchema":{"type":"object","properties":{}}}
]}'

parse_map() {
  local ledger="$CWD/docs/lazybuddy-parity-ledger.md"
  [ -f "$ledger" ] || return 1
  python3 - "$ledger" << 'PYEOF'
import json, os
import sys
text = open(sys.argv[1]).read()
rows, cat = [], 'unknown'
for line in text.split('\n'):
    line = line.strip()
    if line.startswith('### '): cat = line.strip('# ').strip()
    if '|' not in line or '---' in line or not line.startswith('|'): continue
    cols = [c.strip() for c in line.split('|')[1:-1]]
    if len(cols) >= 4 and cols[0] and cols[3]:
        rows.append(dict(method=cols[0], source=cols[1] if len(cols)>1 else '',
            implementation=cols[2] if len(cols)>2 else '', status=cols[3],
            notes=cols[4] if len(cols)>4 else '', category=cat))
print(json.dumps(rows))
PYEOF
}

parse_gaps() {
  local gaps="$CWD/docs/lazybuddy-known-gaps.md"
  [ -f "$gaps" ] || return 1
  python3 - "$gaps" << 'PYEOF'
import json, re, sys
text = open(sys.argv[1]).read()
gaps = []
for m in re.finditer(r'### (G-\d+): (.+?)\n\n([\s\S]+?)(?=\n### G-|\n---|\n\Z)', text):
    gid, title, body = m.group(1), m.group(2), m.group(3).strip()
    imp = re.search(r'\*\*Impact:\*\*\s*(.+)', body)
    tgt = re.search(r'\*\*Target version:\*\*\s*(.+)', body) or re.search(r'\*\*Mitigation:\*\*\s*(.+)', body)
    gaps.append(dict(id=gid, title=title, impact=imp.group(1) if imp else '', target=tgt.group(1) if tgt else ''))
print(json.dumps(gaps))
PYEOF
}

while IFS= read -r INPUT || [ -n "$INPUT" ]; do
  METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<< "$INPUT" || echo "")
  ID_JSON=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('id',0)))" 2>/dev/null <<< "$INPUT" || echo "0")

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"parity","version":"0.15.0-alpha.2"}}'
    ;;
  tools/list) reply "$TOOL_LIST" ;;
  tools/call)
    TNAME=$(python3 -c "import sys,json; print(json.load(sys.stdin)['params']['name'])" 2>/dev/null <<< "$INPUT")
    ARGS=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['params'].get('arguments',{})))" 2>/dev/null <<< "$INPUT")

    case "$TNAME" in
      read_canonical_method_map|list_methods)
        SECT=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('section','all'))" 2>/dev/null || echo "all")
        if ! MAP=$(parse_map 2>/dev/null); then
          err "parity ledger not found in project docs"
          continue
        fi
        [ "$SECT" = "all" ] && reply "$MAP" || reply "$(echo "$MAP" | SECT="$SECT" python3 -c "import sys,json,os; rows=json.load(sys.stdin); s=os.environ['SECT'].lower().replace(' ','-'); print(json.dumps([r for r in rows if r['category'].lower().replace(' ','-').startswith(s)]))")"
        ;;
      compare_method_status)
        MN=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['method_name'])" 2>/dev/null)
        if ! MAP=$(parse_map 2>/dev/null); then
          err "parity ledger not found in project docs"
          continue
        fi
        reply "$(echo "$MAP" | MN="$MN" python3 -c "import sys,json,os; rows=json.load(sys.stdin); n=os.environ['MN'].lower(); f=[r for r in rows if n in '|'.join(r.values()).lower()]; print(json.dumps(f[0] if f else {'error':'method not found'}))")"
        ;;
      update_parity_ledger)
        MN=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['method_name'])" 2>/dev/null)
        NS=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['new_status'])" 2>/dev/null)
        NT=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('notes',''))" 2>/dev/null)
        NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        LEDGER="$CWD/docs/lazybuddy-parity-ledger.md"
        [ -f "$LEDGER" ] || { err "parity ledger not found in project docs"; continue; }
        if ! printf '\n| %s | v0.8 | %s | %s | %s |\n' "$MN" "$NS" "$NOW" "$NT" >> "$LEDGER"; then
          err "failed to update parity ledger"
          continue
        fi
        reply "$(python3 - "$MN" "$NS" "$NOW" <<'PYEOF'
import json
import sys

print(json.dumps({"status": "ok", "method_name": sys.argv[1], "new_status": sys.argv[2], "timestamp": sys.argv[3]}))
PYEOF
)"
        ;;
      generate_gap_report)
        if ! GAPS=$(parse_gaps 2>/dev/null); then
          err "known gaps file not found in project docs"
          continue
        fi
        reply "$GAPS"
        ;;
      *) err "unknown tool: $TNAME" ;;
    esac
    ;;
  *) err "unsupported method: $METHOD" ;;
esac
done
