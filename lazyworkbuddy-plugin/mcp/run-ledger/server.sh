#!/usr/bin/env bash
# run-ledger MCP server — wraps v0.7 state scripts as JSON-RPC tools
# communicates via stdin/stdout JSON-RPC 2.0
set -euo pipefail

INPUT=$(cat)
METHOD=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('method',''))" 2>/dev/null <<< "$INPUT" || echo "")
ID=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',0))" 2>/dev/null <<< "$INPUT" || echo "0")

CWD="${CWD:-.}"
PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATEDIR="$CWD/.lazyworkbuddy"

reply() { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"result\":$1}"; }
err() { echo "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"error\":{\"code\":-32603,\"message\":\"$1\"}}"; }

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

case "$METHOD" in
  initialize)
    reply '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"run-ledger","version":"0.8.0"}}'
    ;;
  tools/list)
    reply "$TOOL_LIST"
    ;;
  tools/call)
    TOOL=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d['params']['name'])" 2>/dev/null <<< "$INPUT")
    ARGS=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['params'].get('arguments',{})))" 2>/dev/null <<< "$INPUT")

    run_st() {
      local script="$PLUGIN_ROOT/scripts/state/$1"
      [ -x "$script" ] || { err "state script not found: $1"; return; }
      reply "$(CWD="$CWD" bash "$script" "${@:2}" 2>&1 | python3 -c "import sys,json; json.dumps({'output':sys.stdin.read().strip()})" 2>/dev/null || echo '{}')"
    }

    run_ev() {
      local script="$PLUGIN_ROOT/scripts/state/append-event.sh"
      local run_id=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run_id',''))" 2>/dev/null)
      local evtype=$(echo "$ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('event_type',''))" 2>/dev/null)
      local payload=$(echo "$ARGS" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('payload',{})))" 2>/dev/null)
      CWD="$CWD" bash "$script" "$run_id" "$evtype" "$payload" 2>&1 >/dev/null
      reply '{"status":"ok","event_appended":true}'
    }

    case "$TOOL" in
      create_run)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        OBJ=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['objective'])")
        CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/create-run.sh" "$RID" "$OBJ" 2>&1 >/dev/null
        reply '{"status":"ok","run_id":"'$RID'"}'
        ;;
      list_runs)
        OUT=$(CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/list-runs.sh" 2>/dev/null | tail -n +3 | awk '{print $1}' | tr '\n' ',' | sed 's/,$//')
        reply "{\"runs\":[$(echo "$OUT" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/')],\"count\":$(echo "$OUT" | tr ',' '\n' | grep -c .)}"
        ;;
      latest_run) run_st latest-run.sh ;;
      read_state)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        if [ -f "$STATEDIR/runs/$RID/state.json" ]; then
          reply "$(python3 -c "import json; json.dumps(json.load(open('$STATEDIR/runs/$RID/state.json')))" 2>/dev/null || echo '{}')"
        else
          err "run not found: $RID"
        fi
        ;;
      summarize_run)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        SUMMARY=$(CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/summarize-run.sh" "$RID" 2>/dev/null | grep -v '^===' | sed 's/^/"/;s/$/"/' | tr '\n' ',' | sed 's/,$//')
        reply "{\"summary\":[$(echo "$SUMMARY" | sed 's/",""$/"/')]}"
        ;;
      append_event) run_ev ;;
      update_task)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        TID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['task_id'])")
        TSTAT=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
        CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/update-task.sh" "$RID" "$TID" "$TSTAT" 2>&1 >/dev/null
        reply '{"status":"ok","task_id":"'$TID'","new_status":"'$TSTAT'"}'
        ;;
      create_checkpoint)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        CP=$(CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/checkpoint.sh" "$RID" 2>/dev/null)
        reply "{\"status\":\"ok\",\"checkpoint\":\"$CP\"}"
        ;;
      recover_run)
        RID=$(echo "$ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run_id'])")
        CWD="$CWD" bash "$PLUGIN_ROOT/scripts/state/recover-run.sh" "$RID" 2>&1 >/dev/null && reply '{"status":"ok","recovered":true}' || err "recovery failed for $RID"
        ;;
      *) err "unknown tool: $TOOL" ;;
    esac
    ;;
  *)
    err "unsupported method: $METHOD"
    ;;
esac
