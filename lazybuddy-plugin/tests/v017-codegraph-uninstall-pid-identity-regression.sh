#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph-pid-identity.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
LIVE_PID=""
STALE_PID=""
UNRELATED_PID=""
DECOY_PID=""
STUBBORN_CHILD_PID=""
TERMINATED_FIXTURE_PID=""
LIVE_WRAPPER_PID=""
STUBBORN_WRAPPER_PID=""
LIVE_READY="$TMP/live-fixture-ready"
STUBBORN_READY="$TMP/stubborn-fixture-ready"
TERMINATED_READY="$TMP/terminated-fixture-ready"
LIVE_PID_PATH="$TMP/live-fixture-pid"
STUBBORN_PID_PATH="$TMP/stubborn-fixture-pid"
LIVE_STATUS="$TMP/live-fixture-status"
STUBBORN_STATUS="$TMP/stubborn-fixture-status"
TERMINATED_STATUS="$TMP/terminated-fixture-status"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

wait_for_fixture_ready() {
    local ready_path="$1"
    for _ in $(seq 1 200); do
        [ -e "$ready_path" ] && return 0
        sleep 0.01
    done
    fail "fixture process did not become ready: $ready_path"
}

stop_child() {
    local pid="$1"
    case "$pid" in ''|*[!0-9]*) return 0 ;; esac
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.1
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

cleanup() {
    stop_child "$LIVE_PID"
    stop_child "$STALE_PID"
    stop_child "$UNRELATED_PID"
    stop_child "$DECOY_PID"
    stop_child "$STUBBORN_CHILD_PID"
    stop_child "$TERMINATED_FIXTURE_PID"
    stop_child "$LIVE_WRAPPER_PID"
    stop_child "$STUBBORN_WRAPPER_PID"
    if [ "${LAZYBUDDY_KEEP_TEST_FIXTURES:-}" = 1 ]; then
        printf 'KEEP fixture: %s\n' "$TMP" >&2
        return
    fi
    rm -rf "$TMP"
}
trap cleanup EXIT

TOOLING_ROOT="$TMP/tools"
TARGET_ROOT="$TMP/project"
FAKE_BIN="$TMP/bin"
FIXTURE_STATE="$TMP/ps-count"
mkdir "$TOOLING_ROOT" "$TARGET_ROOT" "$FAKE_BIN"

(
    python3 -c 'import signal, sys, time; signal.signal(signal.SIGTERM, lambda *_: sys.exit(143)); open(sys.argv[1], "w").close(); time.sleep(30)' "$LIVE_READY" &
    child_pid=$!
    printf '%s\n' "$child_pid" > "$LIVE_PID_PATH"
    if wait "$child_pid"; then child_status=0; else child_status=$?; fi
    printf '%s\n' "$child_status" > "$LIVE_STATUS"
    exit "$child_status"
) &
LIVE_WRAPPER_PID=$!
for ready_path in "$LIVE_READY" "$LIVE_PID_PATH"; do
    wait_for_fixture_ready "$ready_path"
done
LIVE_PID="$(cat "$LIVE_PID_PATH")"
sleep 30 &
STALE_PID=$!
sleep 30 &
UNRELATED_PID=$!
sleep 30 &
DECOY_PID=$!
(
    python3 -c 'import signal, sys, time; signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM}); open(sys.argv[1], "w").close(); time.sleep(30)' "$STUBBORN_READY" &
    child_pid=$!
    printf '%s\n' "$child_pid" > "$STUBBORN_PID_PATH"
    if wait "$child_pid"; then child_status=0; else child_status=$?; fi
    printf '%s\n' "$child_status" > "$STUBBORN_STATUS"
    exit "$child_status"
) &
STUBBORN_WRAPPER_PID=$!
for ready_path in "$STUBBORN_READY" "$STUBBORN_PID_PATH"; do
    wait_for_fixture_ready "$ready_path"
done
STUBBORN_CHILD_PID="$(cat "$STUBBORN_PID_PATH")"
[ "$STALE_PID" -gt "$LIVE_PID" ] || fail 'fixture could not order snapshot candidates'

RUNTIME_ROOT="$TOOLING_ROOT/.lazybuddy-codegraph-runtime"
OWNER_MARKER="--lazybuddy-codegraph-mcp-owner=v1"
case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) CODEGRAPH_BINARY="$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-darwin-arm64/bin/codegraph" ;;
    Darwin-x86_64) CODEGRAPH_BINARY="$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-darwin-x64/bin/codegraph" ;;
    Linux-aarch64|Linux-arm64) CODEGRAPH_BINARY="$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-linux-arm64/bin/codegraph" ;;
    Linux-x86_64) CODEGRAPH_BINARY="$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-linux-x64/bin/codegraph" ;;
    Windows_NT-x86_64|MINGW64_NT-*) CODEGRAPH_BINARY="$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-win32-x64/bin/codegraph" ;;
    *) fail 'unsupported fixture platform' ;;
esac

cat > "$FAKE_BIN/ps" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

count=0
if [ -f "$LAZYBUDDY_PID_FIXTURE_STATE" ]; then
    count="$(cat "$LAZYBUDDY_PID_FIXTURE_STATE")"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$LAZYBUDDY_PID_FIXTURE_STATE"

launcher_source() {
    printf '%s' 'owner_marker, binary, target_root, runtime_root = sys.argv[1:]\012if owner_marker != "--lazybuddy-codegraph-mcp-owner=v1":\012    raise SystemExit("invalid LazyBuddy CodeGraph launcher ownership marker")\012process = subprocess.Popen(\012    [binary, "serve", "--mcp"],\012    cwd=target_root,\012    start_new_session=True,\012)'
}
live() {
    local source
    [ ! -e "$LAZYBUDDY_PID_FIXTURE_LIVE_STATUS" ] || return 0
    source="$(launcher_source)"
    printf "%s %s %s Mon Jan 1 00:00:00 2024 PyThOn3 -B -c %s %s %s %s %s\n" \
        "$LAZYBUDDY_PID_FIXTURE_LIVE" 1 1 "$source" "$LAZYBUDDY_PID_FIXTURE_MARKER" "$LAZYBUDDY_PID_FIXTURE_BINARY" "$LAZYBUDDY_PID_FIXTURE_TARGET" "$LAZYBUDDY_PID_FIXTURE_RUNTIME"
}
stale_initial() {
    local source
    source="$(launcher_source)"
    printf "%s %s %s Mon Jan 1 00:00:00 2024 PyThOn3 -B -c %s %s %s %s %s\n" \
        "$LAZYBUDDY_PID_FIXTURE_STALE" 1 1 "$source" "$LAZYBUDDY_PID_FIXTURE_MARKER" "$LAZYBUDDY_PID_FIXTURE_BINARY" "$LAZYBUDDY_PID_FIXTURE_TARGET" "$LAZYBUDDY_PID_FIXTURE_RUNTIME"
}
stale_reused() {
    printf '%s %s %s Tue Jan 2 00:00:00 2024 python unrelated-process %s\n' \
        "$LAZYBUDDY_PID_FIXTURE_STALE" 2 2 "$LAZYBUDDY_PID_FIXTURE_TARGET"
}
decoy_driver() {
    printf '%s %s %s Mon Jan 1 00:00:00 2024 python decoy-driver %s %s\n' \
        "$LAZYBUDDY_PID_FIXTURE_DECOY" 1 1 "$LAZYBUDDY_PID_FIXTURE_BINARY" "$LAZYBUDDY_PID_FIXTURE_TARGET"
}
stubborn_child() {
    local parent=1
    [ ! -e "$LAZYBUDDY_PID_FIXTURE_STUBBORN_STATUS" ] || return 0
    [ "$count" -le 4 ] && parent="$LAZYBUDDY_PID_FIXTURE_LIVE"
    printf '%s %s %s Mon Jan 1 00:00:00 2024 python stubborn-child\n' \
        "$LAZYBUDDY_PID_FIXTURE_STUBBORN" "$parent" 1
}

case "$count" in
    1) live; stale_initial; decoy_driver; stubborn_child ;;
    2|3|4) live; stale_reused; decoy_driver; stubborn_child ;;
    *) stale_reused; decoy_driver; stubborn_child ;;
esac
SH
chmod +x "$FAKE_BIN/ps"

# Given a fixture process identity that has already terminated,
# when the controlled snapshot is read, then it must not keep advertising the
# stale numeric PID as the original owned identity.
python3 -c 'import sys, time; open(sys.argv[1], "w").close(); time.sleep(30)' "$TERMINATED_READY" &
TERMINATED_FIXTURE_PID=$!
wait_for_fixture_ready "$TERMINATED_READY"
stop_child "$TERMINATED_FIXTURE_PID"
: > "$TERMINATED_STATUS"
TERMINATED_SNAPSHOT="$(env \
    LAZYBUDDY_PID_FIXTURE_STATE="$FIXTURE_STATE" \
    LAZYBUDDY_PID_FIXTURE_LIVE="$LIVE_PID" \
    LAZYBUDDY_PID_FIXTURE_STALE="$STALE_PID" \
    LAZYBUDDY_PID_FIXTURE_DECOY="$DECOY_PID" \
    LAZYBUDDY_PID_FIXTURE_MARKER="$OWNER_MARKER" \
    LAZYBUDDY_PID_FIXTURE_STUBBORN="$TERMINATED_FIXTURE_PID" \
    LAZYBUDDY_PID_FIXTURE_BINARY="$CODEGRAPH_BINARY" \
    LAZYBUDDY_PID_FIXTURE_TARGET="$TARGET_ROOT" \
    LAZYBUDDY_PID_FIXTURE_RUNTIME="$RUNTIME_ROOT" \
    LAZYBUDDY_PID_FIXTURE_LIVE_STATUS="$LIVE_STATUS" \
    LAZYBUDDY_PID_FIXTURE_STUBBORN_STATUS="$TERMINATED_STATUS" \
    "$FAKE_BIN/ps" -axo "pid=,ppid=,pgid=,lstart=,command=")" \
    || fail 'controlled snapshot could not inspect a terminated fixture identity'
if awk -v pid="$TERMINATED_FIXTURE_PID" '$1 == pid { found = 1 } END { exit !found }' <<<"$TERMINATED_SNAPSHOT"; then
    fail 'controlled snapshot retained a terminated fixture identity'
fi
TERMINATED_FIXTURE_PID=""
rm -f "$FIXTURE_STATE"
pass 'controlled snapshot drops a terminated fixture identity'
[ ! -e "$LIVE_STATUS" ] || fail 'live fixture terminated before ownership helper validation'
[ ! -e "$STUBBORN_STATUS" ] || fail 'stubborn fixture terminated before ownership helper validation'

# Given a trusted process snapshot executable that cannot inspect processes,
# when the production ownership helper runs, then uninstall must fail closed
# instead of treating missing output as proof that no owned process exists.
cat > "$FAKE_BIN/ps-unavailable" <<'SH'
#!/usr/bin/env bash
exit 73
SH
chmod +x "$FAKE_BIN/ps-unavailable"
if INSPECTION_FAILURE_OUTPUT="$(env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes --test-process-snapshot "$4"' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET_ROOT" "$FAKE_BIN/ps-unavailable" 2>&1)"; then
    fail 'failed trusted process inspection was treated as an empty successful snapshot'
fi
grep -Fq 'CODEGRAPH_PROCESS_INSPECTION_UNAVAILABLE' <<<"$INSPECTION_FAILURE_OUTPUT" \
    || fail 'failed trusted process inspection did not return the typed refusal'
pass 'failed trusted process inspection blocks uninstall'

rm -f "$FIXTURE_STATE"
if TRUSTED_INSPECTION_OUTPUT="$(env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    LAZYBUDDY_PID_FIXTURE_STATE="$FIXTURE_STATE" \
    bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET_ROOT" 2>&1)"; then
    :
else
    grep -Fq 'CODEGRAPH_PROCESS_INSPECTION_UNAVAILABLE' <<<"$TRUSTED_INSPECTION_OUTPUT" \
        || fail 'trusted production process inspection failed without the typed refusal'
    printf 'UNSUPPORTED: trusted production process inspection is unavailable; ownership remains fail-closed\n'
fi
[ ! -e "$FIXTURE_STATE" ] || fail 'caller PATH replaced the trusted production ps inspector'
[ ! -e "$LIVE_STATUS" ] || fail 'trusted production inspection signalled the live controlled fixture'
[ ! -e "$STUBBORN_STATUS" ] || fail 'trusted production inspection signalled the stubborn controlled fixture'
pass 'caller PATH cannot replace the trusted production ps inspector'

if ! env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    LAZYBUDDY_PID_FIXTURE_STATE="$FIXTURE_STATE" \
    LAZYBUDDY_PID_FIXTURE_LIVE="$LIVE_PID" \
    LAZYBUDDY_PID_FIXTURE_STALE="$STALE_PID" \
    LAZYBUDDY_PID_FIXTURE_DECOY="$DECOY_PID" \
    LAZYBUDDY_PID_FIXTURE_MARKER="$OWNER_MARKER" \
    LAZYBUDDY_PID_FIXTURE_STUBBORN="$STUBBORN_CHILD_PID" \
    LAZYBUDDY_PID_FIXTURE_BINARY="$CODEGRAPH_BINARY" \
    LAZYBUDDY_PID_FIXTURE_TARGET="$TARGET_ROOT" \
    LAZYBUDDY_PID_FIXTURE_RUNTIME="$RUNTIME_ROOT" \
    LAZYBUDDY_PID_FIXTURE_LIVE_STATUS="$LIVE_STATUS" \
    LAZYBUDDY_PID_FIXTURE_STUBBORN_STATUS="$STUBBORN_STATUS" \
    bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes --test-process-snapshot "$4"' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET_ROOT" "$FAKE_BIN/ps"; then
    fail 'production ownership helper rejected controlled fixture'
fi

kill -0 "$STALE_PID" 2>/dev/null || fail 'identity-changed PID was signalled'
kill -0 "$UNRELATED_PID" 2>/dev/null || fail 'unrelated process was signalled'
kill -0 "$DECOY_PID" 2>/dev/null || fail 'exact-binary-and-target decoy driver was signalled'
if wait "$LIVE_WRAPPER_PID" 2>/dev/null; then
    fail 'owned process unexpectedly exited cleanly instead of receiving TERM'
fi
[ "$(cat "$LIVE_STATUS")" = 143 ] || fail 'owned process did not record the expected TERM exit status'
LIVE_PID=""
LIVE_WRAPPER_PID=""
if wait "$STUBBORN_WRAPPER_PID" 2>/dev/null; then
    fail 'TERM-ignoring owned descendant unexpectedly exited cleanly instead of receiving SIGKILL'
fi
[ "$(cat "$STUBBORN_STATUS")" = 137 ] || fail 'TERM-ignoring owned descendant did not record the expected SIGKILL exit status'
STUBBORN_CHILD_PID=""
STUBBORN_WRAPPER_PID=""
pass 'changed PID identity is dropped before signalling'
pass 'exact package-owned CodeGraph launcher is terminated'
pass 'unrelated process and exact-binary-and-target decoy driver survive'
pass 'TERM-ignoring owned descendant is escalated after parent exit'

[ "$(cat "$FIXTURE_STATE")" -ge 4 ] || fail 'fixture did not exercise revalidation and completion checks'
pass 'no owned process remains and fixture cleanup owns all temporary PIDs'
printf 'PASS: CodeGraph uninstall PID identity revalidation is safe\n'
