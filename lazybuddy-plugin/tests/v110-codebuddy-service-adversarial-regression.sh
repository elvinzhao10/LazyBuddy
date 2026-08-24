#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
ADAPTER="$PLUGIN_ROOT/scripts/lazybuddy-codebuddy-service.py"
FAKE="$PLUGIN_ROOT/tests/fixtures/fake-codebuddy-service.py"
TMP=$(mktemp -d /private/tmp/lazybuddy-service-adversarial.XXXXXX)
active_names=""
cleanup() {
  local rc=$? name
  for name in $active_names; do
    python3 "$ADAPTER" stop --state-root "$TMP/state" --name "$name" --result-file "$TMP/cleanup-$name.json" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }
port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
start_changed_serve() {
  local attempt reason
  for attempt in 1 2 3; do
    changed_port=$(port)
    changed_endpoint="http://127.0.0.1:$changed_port/health"
    printf '%s\n' "$changed_endpoint" > "$TMP/endpoint.txt"
    if FAKE_ENDPOINT_FILE="$TMP/endpoint.txt" python3 "$ADAPTER" start --state-root "$TMP/state" --name changed --kind serve \
      --binary "$FAKE" --cwd "$TMP/project" --endpoint "$changed_endpoint" --result-file "$TMP/start-changed.json"; then
      return 0
    fi
    reason=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("reason", ""))' "$TMP/start-changed.json")
    [ "$reason" = readiness_timeout ] || return 1
  done
  return 1
}
assert_reason() {
  python3 - "$1" "$2" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value.get("reason") == sys.argv[2], value
PY
}
start_plain() {
  local name=$1 kind=$2
  python3 "$ADAPTER" start --state-root "$TMP/state" --name "$name" --kind "$kind" \
    --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/start-$name.json"
  active_names="$active_names $name"
}
stop_name() {
  local name=$1
  python3 "$ADAPTER" stop --state-root "$TMP/state" --name "$name" --result-file "$TMP/stop-$name.json"
}

mkdir -p "$TMP/project" "$TMP/state/sockets" "$TMP/outside"

touch "$TMP/state/sockets/codebuddy-prewarm-stale.sock"
if python3 "$ADAPTER" start --state-root "$TMP/state" --name stale --kind prewarm \
  --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/stale-socket.json"; then
  fail 'stale prewarm socket unexpectedly launched'
fi
assert_reason "$TMP/stale-socket.json" stale_socket
pass 'stale socket refuses before process launch'

activation_port=$(port)
FAKE_ACTIVATE_DELAY=2 FAKE_ACTIVATION_PORT=$activation_port python3 "$ADAPTER" start --state-root "$TMP/state" \
  --name intact --kind prewarm --binary "$FAKE" --cwd "$TMP/project" \
  --result-file "$TMP/start-interrupted-activation.json"
active_names="$active_names intact"
python3 "$ADAPTER" activate --state-root "$TMP/state" --name intact --cwd "$TMP/project" \
  --session-id interrupted-session --result-file "$TMP/interrupted-activation.json" &
activation_adapter_pid=$!
sleep 0.1
kill -TERM "$activation_adapter_pid"
wait "$activation_adapter_pid" 2>/dev/null || true
python3 - "$TMP/state/services/intact.json" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value["activation_count"] == 0 and value["session_id"] is None, value
PY
stop_name intact
pass 'interrupted one-shot activation cannot publish a false activation receipt'

FAKE_MODE=output-flood python3 "$ADAPTER" start --state-root "$TMP/state" --name flood --kind daemon \
  --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/start-flood.json"
active_names="$active_names flood"
if python3 "$ADAPTER" status --state-root "$TMP/state" --name flood --result-file "$TMP/status-flood.json"; then
  fail 'oversized service log unexpectedly passed status'
fi
assert_reason "$TMP/status-flood.json" output_limit_exceeded
if grep -q 'ignore previous instructions' "$TMP/status-flood.json"; then fail 'untrusted log text escaped status output'; fi
stop_name flood
pass 'oversized and prompt-injection logs are capped and inert'

FAKE_MODE=resistant python3 "$ADAPTER" start --state-root "$TMP/state" --name resistant --kind daemon \
  --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/start-resistant.json"
active_names="$active_names resistant"
python3 "$ADAPTER" stop --state-root "$TMP/state" --name resistant --result-file "$TMP/stop-resistant.json"
python3 - "$TMP/stop-resistant.json" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value["cleanup"]["status"] == "verified-absent", value
PY
pass 'resistant daemon receives bounded exact-group teardown'

start_plain killed background
child_pid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["child_pid"])' "$TMP/start-killed.json")
kill -TERM "$child_pid"
for _attempt in {1..100}; do
  state=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["state"])' "$TMP/state/controls/killed/status.json")
  [ "$state" = exited ] && break
  sleep 0.02
done
if python3 "$ADAPTER" status --state-root "$TMP/state" --name killed --result-file "$TMP/status-killed.json"; then
  fail 'killed worker unexpectedly reported running'
fi
assert_reason "$TMP/status-killed.json" killed_worker
stop_name killed
pass 'killed worker cannot be replaced by misleading supervisor success'

start_plain identity background
cp "$TMP/state/services/identity.json" "$TMP/identity-receipt.json"
python3 - "$TMP/state/services/identity.json" <<'PY'
import json, pathlib, sys
path=pathlib.Path(sys.argv[1]); value=json.loads(path.read_text()); value["status"]="stopped"; value["cleanup"]={"status":"verified-absent","tracked_pids":[],"detail":"forged success"}; path.write_text(json.dumps(value)+"\n")
PY
if python3 "$ADAPTER" status --state-root "$TMP/state" --name identity --result-file "$TMP/status-forged-success.json"; then
  fail 'forged stopped receipt substituted for live process state'
fi
assert_reason "$TMP/status-forged-success.json" receipt_status_mismatch
cp "$TMP/identity-receipt.json" "$TMP/state/services/identity.json"
python3 - "$TMP/state/services/identity.json" <<'PY'
import json, pathlib, sys
path=pathlib.Path(sys.argv[1]); value=json.loads(path.read_text()); value["supervisor"]["started"]="PID reuse"; path.write_text(json.dumps(value)+"\n")
PY
if python3 "$ADAPTER" status --state-root "$TMP/state" --name identity --result-file "$TMP/status-identity.json"; then
  fail 'PID identity mismatch unexpectedly reported running'
fi
assert_reason "$TMP/status-identity.json" identity_mismatch
cp "$TMP/identity-receipt.json" "$TMP/state/services/identity.json"
stop_name identity
pass 'PID reuse identity mismatch fails closed without signalling the replacement'
pass 'misleading stopped receipt cannot substitute for live process evidence'

start_changed_serve
active_names="$active_names changed"
printf 'http://127.0.0.1:1/health\n' > "$TMP/endpoint.txt"
if FAKE_ENDPOINT_FILE="$TMP/endpoint.txt" python3 "$ADAPTER" status --state-root "$TMP/state" --name changed --result-file "$TMP/status-changed.json"; then
  fail 'changed endpoint evidence unexpectedly passed'
fi
assert_reason "$TMP/status-changed.json" changed_endpoint
printf '%s\n' "$changed_endpoint" > "$TMP/endpoint.txt"
stop_name changed
pass 'changed health endpoint is detected from the live HTTP body'

start_plain stale background
cp "$TMP/state/services/stale.json" "$TMP/stale-receipt.json"
python3 - "$TMP/state/services/stale.json" <<'PY'
import json, pathlib, sys
path=pathlib.Path(sys.argv[1]); value=json.loads(path.read_text()); value["supervisor"]["pid"]=99999999; value["supervisor"]["pgid"]=99999999; path.write_text(json.dumps(value)+"\n")
PY
if python3 "$ADAPTER" status --state-root "$TMP/state" --name stale --result-file "$TMP/status-stale.json"; then
  fail 'stale PID unexpectedly reported running'
fi
assert_reason "$TMP/status-stale.json" stale_pid
cp "$TMP/stale-receipt.json" "$TMP/state/services/stale.json"
stop_name stale
pass 'stale PID receipt fails closed'

start_plain pathguard background
stop_name pathguard
cp "$TMP/state/services/pathguard.json" "$TMP/pathguard-receipt.json"
python3 - "$TMP/state/services/pathguard.json" "$TMP/outside/status.json" <<'PY'
import json, pathlib, sys
path=pathlib.Path(sys.argv[1]); value=json.loads(path.read_text()); value["controls"]["status"]=sys.argv[2]; path.write_text(json.dumps(value)+"\n")
PY
if python3 "$ADAPTER" status --state-root "$TMP/state" --name pathguard --result-file "$TMP/path-escape.json"; then
  fail 'receipt path escape unexpectedly passed'
fi
assert_reason "$TMP/path-escape.json" malformed_receipt
cp "$TMP/pathguard-receipt.json" "$TMP/state/services/pathguard.json"
python3 - "$TMP/state/services/pathguard.json" "$TMP/outside/foreign.sock" <<'PY'
import json, pathlib, sys
path=pathlib.Path(sys.argv[1]); value=json.loads(path.read_text()); value["endpoint"]={"transport":"unix","value":sys.argv[2]}; path.write_text(json.dumps(value)+"\n")
PY
if python3 "$ADAPTER" status --state-root "$TMP/state" --name pathguard --result-file "$TMP/socket-escape.json"; then
  fail 'receipt socket path escape unexpectedly passed'
fi
assert_reason "$TMP/socket-escape.json" malformed_receipt
ln -s "$TMP/state" "$TMP/state-link"
if python3 "$ADAPTER" status --state-root "$TMP/state-link" --name pathguard --result-file "$TMP/symlink-root.json"; then
  fail 'symlinked state root unexpectedly passed'
fi
assert_reason "$TMP/symlink-root.json" unsafe_state_root
pass 'receipt path escape and symlink root fail closed'

for run in 1 2 3; do
  interrupted_port=$(port)
  FAKE_MODE=delayed python3 "$ADAPTER" start --state-root "$TMP/state" --name "interrupt$run" --kind serve \
    --binary "$FAKE" --cwd "$TMP/project" --endpoint "http://127.0.0.1:$interrupted_port/health" \
    --timeout 5 --result-file "$TMP/interrupt-$run.json" &
  adapter_pid=$!
  status_file="$TMP/state/controls/interrupt$run/status.json"
  for _attempt in {1..100}; do [ -f "$status_file" ] && break; sleep 0.01; done
  supervisor_pid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["supervisor_pid"])' "$status_file")
  kill -TERM "$adapter_pid"
  wait "$adapter_pid" 2>/dev/null || true
  for _attempt in {1..100}; do kill -0 "$supervisor_pid" 2>/dev/null || break; sleep 0.02; done
  if kill -0 "$supervisor_pid" 2>/dev/null; then fail 'interrupted promotion left supervisor residue'; fi
done
pass 'repeated interrupted promotions clean unhanded process groups'

for slot in 1 2; do
  python3 "$ADAPTER" start --state-root "$TMP/state" --name contention --kind background \
    --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/contention-$slot.json" >"$TMP/contention-$slot.out" 2>&1 &
  contender[$slot]=$!
done
set +e
wait "${contender[1]}"; rc1=$?
wait "${contender[2]}"; rc2=$?
set -e
if ! { [ "$rc1" -eq 0 ] && [ "$rc2" -eq 1 ]; } && ! { [ "$rc1" -eq 1 ] && [ "$rc2" -eq 0 ]; }; then
  fail "same-name contention exits were $rc1/$rc2"
fi
active_names="$active_names contention"
stop_name contention
pass 'same-name contention permits exactly one owned promotion'

python3 "$PLUGIN_ROOT/tests/bounded-lifecycle-state-machine-regression.py" \
  "$PLUGIN_ROOT/scripts/lazybuddy_process_lifecycle.py"
pass 'typed lifecycle covers cleanup refusal, identity replacement, survivors, and inspection loss'

printf 'PASS: codebuddy service adversarial regression complete\n'
