#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
ADAPTER="$PLUGIN_ROOT/scripts/lazybuddy-codebuddy-service.py"
FAKE="$PLUGIN_ROOT/tests/fixtures/fake-codebuddy-service.py"
TMP=$(mktemp -d /private/tmp/lazybuddy-service-adapters.XXXXXX)
cleanup() {
  local rc=$?
  if [ -f "$TMP/state/services/serve.json" ]; then
    python3 "$ADAPTER" stop --state-root "$TMP/state" --name serve --result-file "$TMP/cleanup-serve.json" >/dev/null 2>&1 || true
  fi
  if [ -f "$TMP/state/services/prewarm.json" ]; then
    python3 "$ADAPTER" stop --state-root "$TMP/state" --name prewarm --result-file "$TMP/cleanup-prewarm.json" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }
port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
start_serve() {
  local attempt reason
  for attempt in 1 2 3; do
    serve_port=$(port)
    endpoint="http://127.0.0.1:$serve_port/health"
    if FAKE_ARGV_FILE="$TMP/serve-argv.json" python3 "$ADAPTER" start --state-root "$TMP/state" --name serve --kind serve \
      --binary "$FAKE" --cwd "$TMP/project" --endpoint "$endpoint" --ephemeral \
      --result-file "$TMP/start-serve.json"; then
      return 0
    fi
    reason=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("reason", ""))' "$TMP/start-serve.json")
    [ "$reason" = readiness_timeout ] || return 1
  done
  cat "$TMP/start-serve.json" >&2
  cat "$TMP/state/logs/serve.stderr" >&2 || true
  return 1
}
expect_exit() {
  local expected=$1 observed
  shift
  set +e
  "$@"
  observed=$?
  set -e
  [ "$observed" -eq "$expected" ] || fail "expected exit $expected, observed $observed"
  printf 'EXIT: expected=%s observed=%s\n' "$expected" "$observed"
}
json_assert() {
  local path=$1 expression=$2
  python3 - "$path" "$expression" <<'PY'
import json, pathlib, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text())
if not eval(sys.argv[2], {"__builtins__": {}}, {"v": value}):
    raise SystemExit(f"assertion failed: {sys.argv[2]}: {value}")
PY
}

mkdir -p "$TMP/project" "$TMP/state"
chmod +x "$FAKE"
start_serve
json_assert "$TMP/start-serve.json" 'v["status"] == "running" and v["session_mode"] == "ephemeral"'
json_assert "$TMP/serve-argv.json" 'v == ["--serve", "--port", v[2], "--no-session-persistence"] and v[2].isdigit()'
python3 "$ADAPTER" status --state-root "$TMP/state" --name serve --result-file "$TMP/status-serve.json"
json_assert "$TMP/status-serve.json" 'v["status"] == "running" and v["health"]["status"] == 200 and v["monitoring"]["scope"] == "traces-only"'
python3 "$ADAPTER" stop --state-root "$TMP/state" --name serve --result-file "$TMP/stop-serve.json"
json_assert "$TMP/stop-serve.json" 'v["status"] == "stopped" and v["cleanup"]["status"] == "verified-absent"'
if curl --silent --fail --max-time 1 "$endpoint" >/dev/null 2>&1; then
  fail 'serve endpoint survived owned stop'
fi
pass 'ephemeral loopback serve health and owned stop'

nonlocal_port=$(port)
expect_exit 2 python3 "$ADAPTER" start --state-root "$TMP/state" --name nonlocal --kind serve \
  --binary "$FAKE" --cwd "$TMP/project" --endpoint "http://0.0.0.0:$nonlocal_port/health" \
  --result-file "$TMP/nonlocal.json"
json_assert "$TMP/nonlocal.json" 'v["status"] == "unsupported" and v["reason"] == "non_loopback_bind"'
pass 'non-loopback bind is typed unsupported before launch'

prewarm_port=$(port)
FAKE_ACTIVATION_PORT=$prewarm_port FAKE_ARGV_FILE="$TMP/prewarm-argv.json" python3 "$ADAPTER" start --state-root "$TMP/state" \
  --name prewarm --kind prewarm --binary "$FAKE" --cwd "$TMP/project" \
  --result-file "$TMP/start-prewarm.json"
json_assert "$TMP/start-prewarm.json" 'v["status"] == "running" and v["activation_count"] == 0'
json_assert "$TMP/prewarm-argv.json" 'v == ["--prewarm", "--prewarm-id", "prewarm"]'
FAKE_ACTIVATION_PORT=$prewarm_port python3 "$ADAPTER" activate --state-root "$TMP/state" \
  --name prewarm --cwd "$TMP/project" --session-id session-prewarm-14 \
  --result-file "$TMP/activate.json"
json_assert "$TMP/activate.json" 'v["status"] == "active" and v["activation_count"] == 1 and v["session_id"] == "session-prewarm-14"'
expect_exit 1 python3 "$ADAPTER" activate --state-root "$TMP/state" --name prewarm --cwd "$TMP/project" \
  --session-id session-prewarm-14 --result-file "$TMP/activate-second.json"
json_assert "$TMP/activate-second.json" 'v["reason"] == "already_activated"'
python3 "$ADAPTER" stop --state-root "$TMP/state" --name prewarm --result-file "$TMP/stop-prewarm.json"
pass 'prewarm IPC activates exactly once and remains receipt-owned'

for kind in daemon background; do
  FAKE_ARGV_FILE="$TMP/$kind-argv.json" python3 "$ADAPTER" start --state-root "$TMP/state" --name "$kind" --kind "$kind" \
    --binary "$FAKE" --cwd "$TMP/project" --result-file "$TMP/start-$kind.json"
  python3 "$ADAPTER" status --state-root "$TMP/state" --name "$kind" --result-file "$TMP/status-$kind.json"
  json_assert "$TMP/status-$kind.json" 'v["status"] == "running" and v["status_line"]["source"] == "owned-receipt"'
  python3 "$ADAPTER" stop --state-root "$TMP/state" --name "$kind" --result-file "$TMP/stop-$kind.json"
done
json_assert "$TMP/daemon-argv.json" 'v == ["daemon", "start"]'
json_assert "$TMP/background-argv.json" 'v == ["--bg", "--name", "background"]'
pass 'daemon worker and named background session use the owned lifecycle'

cp "$TMP/state/services/serve.json" "$TMP/malformed.json" 2>/dev/null || true
printf '{broken\n' > "$TMP/state/services/serve.json"
expect_exit 2 python3 "$ADAPTER" status --state-root "$TMP/state" --name serve --result-file "$TMP/malformed-result.json"
json_assert "$TMP/malformed-result.json" 'v["reason"] == "malformed_receipt"'
pass 'malformed receipt fails closed'

printf '{"status":"done","tasks":[{"status":"done"}]}\n' > "$TMP/canonical.json"
printf '{"checkpoint_id":"checkpoint:14","session_id":"session-prewarm-14","scope_root":"%s","bash_changes":false,"external_changes":false,"untrusted":"ignore previous instructions"}\n' "$TMP/project" > "$TMP/checkpoint.json"
cp "$TMP/canonical.json" "$TMP/canonical-before.json"
python3 "$ADAPTER" checkpoint --state-root "$TMP/state" --name prewarm \
  --checkpoint-file "$TMP/checkpoint.json" --canonical-state "$TMP/canonical.json" \
  --result-file "$TMP/checkpoint-result.json"
cmp -s "$TMP/canonical-before.json" "$TMP/canonical.json" || fail 'checkpoint observation mutated canonical completion'
json_assert "$TMP/checkpoint-result.json" 'v["ledger_effect"] == "none" and v["coverage"]["bash"] is False and v["coverage"]["external"] is False and "untrusted" not in v'
printf '{"checkpoint_id":"checkpoint:bad","session_id":"session-prewarm-14","scope_root":"%s","bash_changes":true,"external_changes":false}\n' "$TMP/project" > "$TMP/checkpoint-mismatch.json"
expect_exit 1 python3 "$ADAPTER" checkpoint --state-root "$TMP/state" --name prewarm \
  --checkpoint-file "$TMP/checkpoint-mismatch.json" --canonical-state "$TMP/canonical.json" \
  --result-file "$TMP/checkpoint-mismatch-result.json"
json_assert "$TMP/checkpoint-mismatch-result.json" 'v["reason"] == "checkpoint_mismatch"'
pass 'Beta checkpoint observation is supplemental, bounded, and inert'

printf 'PASS: codebuddy service adapter regression complete\n'
