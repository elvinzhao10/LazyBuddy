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

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

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

python3 -c 'import signal, sys, time; signal.signal(signal.SIGTERM, lambda *_: sys.exit(143)); time.sleep(30)' &
LIVE_PID=$!
sleep 30 &
STALE_PID=$!
sleep 30 &
UNRELATED_PID=$!
sleep 30 &
DECOY_PID=$!
python3 -c 'import signal, time; signal.signal(signal.SIGTERM, lambda *_: None); time.sleep(30)' &
STUBBORN_CHILD_PID=$!
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
    [ "$count" -le 4 ] && parent="$LAZYBUDDY_PID_FIXTURE_LIVE"
    [ "$count" -le 61 ] || return 0
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

rm -f "$FIXTURE_STATE"
env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    LAZYBUDDY_PID_FIXTURE_STATE="$FIXTURE_STATE" \
    bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET_ROOT"
[ ! -e "$FIXTURE_STATE" ] || fail 'caller PATH replaced the trusted production ps inspector'
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
    bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes --test-process-snapshot "$4"' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET_ROOT" "$FAKE_BIN/ps"; then
    fail 'production ownership helper rejected controlled fixture'
fi

kill -0 "$STALE_PID" 2>/dev/null || fail 'identity-changed PID was signalled'
kill -0 "$UNRELATED_PID" 2>/dev/null || fail 'unrelated process was signalled'
kill -0 "$DECOY_PID" 2>/dev/null || fail 'exact-binary-and-target decoy driver was signalled'
if wait "$LIVE_PID" 2>/dev/null; then
    fail 'owned process unexpectedly exited cleanly instead of receiving TERM'
fi
LIVE_PID=""
if wait "$STUBBORN_CHILD_PID" 2>/dev/null; then
    fail 'TERM-ignoring owned descendant unexpectedly exited cleanly instead of receiving SIGKILL'
fi
STUBBORN_CHILD_PID=""
pass 'changed PID identity is dropped before signalling'
pass 'exact package-owned CodeGraph launcher is terminated'
pass 'unrelated process and exact-binary-and-target decoy driver survive'
pass 'TERM-ignoring owned descendant is escalated after parent exit'

[ "$(cat "$FIXTURE_STATE")" -ge 4 ] || fail 'fixture did not exercise revalidation and completion checks'
pass 'no owned process remains and fixture cleanup owns all temporary PIDs'
printf 'PASS: CodeGraph uninstall PID identity revalidation is safe\n'
