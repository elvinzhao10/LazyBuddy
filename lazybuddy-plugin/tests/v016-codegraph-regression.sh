#!/usr/bin/env bash
set -euo pipefail

if [ "${LAZYBUDDY_CODEGRAPH_TEST_SESSION_ISOLATED:-}" != 1 ]; then
    python3 -B - "$0" "$@" <<'PY'
import os
import signal
import subprocess
import sys
import tempfile
import time

try:
    timeout_seconds = int(os.environ.get("LAZYBUDDY_CODEGRAPH_TEST_TIMEOUT_SECONDS", "90"))
except ValueError as error:
    raise SystemExit(f"FAIL invalid CodeGraph lifecycle test timeout: {error}")
if timeout_seconds < 1:
    raise SystemExit("FAIL CodeGraph lifecycle test timeout must be at least one second")

descriptor, output_path = tempfile.mkstemp(prefix="lazybuddy-codegraph-lifecycle-", suffix=".log")
timed_out = False
try:
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        process = subprocess.Popen(
            ["bash", sys.argv[1], *sys.argv[2:]],
            start_new_session=True,
            stdout=output,
            stderr=subprocess.STDOUT,
            text=True,
            env=os.environ | {"LAZYBUDDY_CODEGRAPH_TEST_SESSION_ISOLATED": "1"},
        )
    deadline = time.monotonic() + timeout_seconds
    while process.poll() is None and time.monotonic() < deadline:
        time.sleep(0.05)
    if process.poll() is None:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
    status = process.wait()
    with open(output_path, encoding="utf-8") as output:
        sys.stdout.write(output.read())
finally:
    os.unlink(output_path)

if timed_out:
    raise SystemExit(f"FAIL CodeGraph lifecycle test exceeded {timeout_seconds}s")
if status < 0:
    raise SystemExit(f"FAIL CodeGraph lifecycle test session exited by signal {-status}")
raise SystemExit(status)
PY
    exit $?
fi

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
LIVE_HELPER_PID=""
LIVE_HELPER_IDENTITY=""
OTHER_PROCESS_PID=""
OTHER_PROCESS_IDENTITY=""

# Only signal a process that is still the exact direct child this test started.
# This prevents a stale PID in the EXIT trap from affecting a reused PID.
process_identity() {
    local pid="$1"
    ps -o ppid= -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' | sed 's/^ //'
}

stop_owned_process() {
    local pid="$1" expected_identity="$2" current_identity=""
    case "$pid" in
        ''|*[!0-9]*) return 0 ;;
    esac
    [ -n "$expected_identity" ] || return 0
    current_identity="$(process_identity "$pid")"
    [ "$current_identity" = "$expected_identity" ] || return 0
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.2
    current_identity="$(process_identity "$pid")"
    [ "$current_identity" = "$expected_identity" ] || return 0
    kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
    stop_owned_process "$LIVE_HELPER_PID" "$LIVE_HELPER_IDENTITY"
    stop_owned_process "$OTHER_PROCESS_PID" "$OTHER_PROCESS_IDENTITY"
    if [ "${LAZYBUDDY_KEEP_TEST_FIXTURES:-}" = 1 ]; then
        printf 'KEEP fixture: %s\n' "$TMP" >&2
        return
    fi
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$1"; }
expect() {
    local label="$1" expected="$2"
    shift 2
    local output status
    if output=$("$@" 2>&1); then status=0; else status=$?; fi
    printf '%s\n' "$output" > "$TMP/$label.out"
    [ "$status" = "$expected" ] || fail "$label (exit $status, expected $expected): $output"
    pass "$label"
}

TARGET="$TMP/project"
TOOLING_ROOT="$TMP/tools"
mkdir "$TARGET"
printf 'export const value = 1;\n' > "$TARGET/source.ts"

MOCK_BIN="$TMP/mock-bin"
FAKE_LOG="$TMP/fake-codegraph.log"
FAKE_SERVER_PID_FILE="$TMP/fake-codegraph-server.pid"
mkdir "$MOCK_BIN"
python3 -B - "$MOCK_BIN/npm" <<'PY'
from pathlib import Path
import sys

destination = Path(sys.argv[1])
destination.write_text(
    r"""#!/usr/bin/env python3
import os
from pathlib import Path
import platform
import stat
import sys

if sys.argv[1:] != ["ci", "--ignore-scripts", "--no-audit", "--fund=false"]:
    raise SystemExit(f"unexpected fake npm invocation: {sys.argv[1:]}")

suffixes = {
    ("Darwin", "arm64"): "darwin-arm64",
    ("Darwin", "x86_64"): "darwin-x64",
    ("Linux", "aarch64"): "linux-arm64",
    ("Linux", "arm64"): "linux-arm64",
    ("Linux", "x86_64"): "linux-x64",
}
try:
    suffix = suffixes[(platform.system(), platform.machine())]
except KeyError as error:
    raise SystemExit(f"unsupported fake CodeGraph test platform: {error.args[0]}")

binary = Path.cwd() / "node_modules" / f"@colbymchenry/codegraph-{suffix}" / "bin" / "codegraph"
binary.parent.mkdir(parents=True)
binary.write_text(
    r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

required = {
    "CODEGRAPH_NO_DOWNLOAD": "1",
    "CODEGRAPH_TELEMETRY": "0",
    "CODEGRAPH_NO_WATCHDOG": "1",
}
for key, value in required.items():
    if os.environ.get(key) != value:
        raise SystemExit(f"fake CodeGraph missing {key}={value}")

log_path = os.environ.get("LAZYBUDDY_CODEGRAPH_TEST_LOG")
if log_path:
    with open(log_path, "a", encoding="utf-8") as stream:
        stream.write(f"{sys.argv[1:]} cwd={Path.cwd()}\n")

if sys.argv[1:] == ["init"]:
    (Path.cwd() / ".codegraph").mkdir()
    raise SystemExit(0)
if sys.argv[1:] != ["serve", "--mcp"]:
    raise SystemExit(f"unexpected fake CodeGraph invocation: {sys.argv[1:]}")

pid_path = os.environ.get("LAZYBUDDY_CODEGRAPH_TEST_SERVER_PID_FILE")
if pid_path:
    Path(pid_path).write_text(f"{os.getpid()}\n", encoding="utf-8")
for line in sys.stdin:
    request = json.loads(line)
    if request.get("method") == "initialize":
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake-codegraph", "version": "test"},
            },
        }), flush=True)
''',
    encoding="utf-8",
)
binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
log_path = os.environ.get("LAZYBUDDY_CODEGRAPH_TEST_LOG")
if log_path:
    with open(log_path, "a", encoding="utf-8") as stream:
        stream.write(f"npm ci cwd={Path.cwd()}\n")
""",
    encoding="utf-8",
)
destination.chmod(destination.stat().st_mode | 0o111)
PY
export PATH="$MOCK_BIN:$PATH"
export LAZYBUDDY_CODEGRAPH_TEST_LOG="$FAKE_LOG"
export LAZYBUDDY_CODEGRAPH_TEST_SERVER_PID_FILE="$FAKE_SERVER_PID_FILE"

# Given a fresh project and absent caller-selected tooling-root pathname, when CodeGraph is
# inspected before explicit provisioning, then it is non-blocking and writes
# neither the target nor the tooling root.
expect 'CodeGraph status is disabled by default' 0 bash "$LIFECYCLE" codegraph-status --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -Fxq 'STATE: disabled' "$TMP/CodeGraph status is disabled by default.out" || fail 'default CodeGraph state'
[ ! -e "$TARGET/.codegraph" ] || fail 'default status created project index'
[ ! -e "$TOOLING_ROOT" ] || fail 'default status created tooling root'
pass 'disabled status is non-mutating'

# Given a large but uninitialized project, when CodeGraph doctor runs, then it
# recommends explicit activation without starting CodeGraph or creating an index.
for number in $(seq 1 500); do
    printf 'export const value%s = %s;\n' "$number" "$number" > "$TARGET/file-$number.ts"
done
expect 'CodeGraph doctor is recommendation-only' 0 bash "$LIFECYCLE" codegraph-doctor --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -q 'RECOMMENDATION: CodeGraph may materially improve architecture exploration' "$TMP/CodeGraph doctor is recommendation-only.out" || fail 'large project recommendation'
[ ! -e "$TARGET/.codegraph" ] || fail 'doctor created project index'
[ ! -e "$TOOLING_ROOT" ] || fail 'doctor created tooling root'
pass 'doctor is non-mutating'

SYMLINK_TARGET="$TMP/symlink-project"
ln -s "$TARGET" "$SYMLINK_TARGET"
expect 'symlinked project root is rejected' 2 bash "$LIFECYCLE" codegraph-init --target "$SYMLINK_TARGET" --tooling-root "$TOOLING_ROOT"
[ ! -e "$TARGET/.codegraph" ] || fail 'symlinked project root created an index'

CALLER_HOME="$TMP/caller-home"
mkdir "$CALLER_HOME"
printf 'preserve\n' > "$CALLER_HOME/sentinel"
expect 'CodeGraph install provisions pinned owned package without touching caller home' 0 env HOME="$CALLER_HOME" bash "$LIFECYCLE" codegraph-install --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -Fxq 'STATE: not-initialized' "$TMP/CodeGraph install provisions pinned owned package without touching caller home.out" || fail 'install waits for explicit initialization'
[ "$(cat "$CALLER_HOME/sentinel")" = preserve ] || fail 'CodeGraph install changed caller home sentinel'
[ "$(find "$CALLER_HOME" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 1 ] || fail 'CodeGraph install wrote caller home state'
expect 'CodeGraph initialize creates a receipt-owned index without touching caller home' 0 env HOME="$CALLER_HOME" bash "$LIFECYCLE" codegraph-init --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -Fxq 'STATE: initialized' "$TMP/CodeGraph initialize creates a receipt-owned index without touching caller home.out" || fail 'initialization state'
[ "$(cat "$CALLER_HOME/sentinel")" = preserve ] || fail 'CodeGraph initialization changed caller home sentinel'
[ "$(find "$CALLER_HOME" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 1 ] || fail 'CodeGraph initialization wrote caller home state'
[ -d "$TARGET/.codegraph" ] && [ ! -L "$TARGET/.codegraph" ] || fail 'initialization did not create real project index'
expect 'CodeGraph enable is explicit' 0 bash "$LIFECYCLE" codegraph-enable --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -Fxq 'STATE: ready' "$TMP/CodeGraph enable is explicit.out" || fail 'enable state'
EXPECTED_CODEGRAPH_BINARY="$(sed -n 's/^PROVIDER: codegraph owned //p' "$TMP/CodeGraph enable is explicit.out")"
[ -n "$EXPECTED_CODEGRAPH_BINARY" ] && [ -x "$EXPECTED_CODEGRAPH_BINARY" ] || fail 'CodeGraph did not use the exact package-owned selector'
grep -Fqx "PROVIDER: codegraph owned $EXPECTED_CODEGRAPH_BINARY" "$TMP/CodeGraph enable is explicit.out" || fail 'CodeGraph provider selector drifted'
expect 'CodeGraph enable is repeat-safe' 0 bash "$LIFECYCLE" codegraph-enable --target "$TARGET" --tooling-root "$TOOLING_ROOT"
expect 'CodeGraph exports a package-owned MCP configuration' 0 bash "$LIFECYCLE" codegraph-export-mcp --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -q 'mcp/codegraph/server.sh' "$TMP/CodeGraph exports a package-owned MCP configuration.out" || fail 'exported launcher path'

# Given a platform that denies the trusted process snapshot, when uninstall is
# requested, then the lifecycle must refuse explicitly and preserve every
# ownership artifact instead of claiming that an empty snapshot is safe.
if ! INSPECTION_OUTPUT="$(bash -c 'source "$1"; TOOLING_ROOT="$2"; TARGET_ROOT="$3"; stop_owned_codegraph_processes' \
    bash "$LIFECYCLE" "$TOOLING_ROOT" "$TARGET" 2>&1)"; then
    grep -Fq 'CODEGRAPH_PROCESS_INSPECTION_UNAVAILABLE' <<<"$INSPECTION_OUTPUT" \
        || fail 'trusted process inspection failed without the typed refusal'
    expect 'CodeGraph uninstall fails closed when process inspection is unavailable' 1 \
        bash "$LIFECYCLE" codegraph-uninstall --target "$TARGET" --tooling-root "$TOOLING_ROOT"
    grep -Fq 'CODEGRAPH_PROCESS_INSPECTION_UNAVAILABLE' \
        "$TMP/CodeGraph uninstall fails closed when process inspection is unavailable.out" \
        || fail 'CodeGraph uninstall omitted the typed process-inspection refusal'
    [ -d "$TARGET/.codegraph" ] || fail 'failed-closed uninstall removed the owned index'
    [ -f "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json" ] || fail 'failed-closed uninstall removed the ownership receipt'
    [ -d "$TOOLING_ROOT/.lazybuddy-codegraph-runtime" ] || fail 'failed-closed uninstall removed the runtime root'
    printf 'UNSUPPORTED: trusted process inspection is unavailable; live ownership teardown remains fail-closed\n'
    printf 'PASS CodeGraph lifecycle, MCP, and ownership boundaries\n'
    exit 0
fi

LIVE_READY="$TMP/live-mcp-ready"
python3 - "$PLUGIN_ROOT/mcp/codegraph/server.sh" "$TARGET" "$TOOLING_ROOT" "$TMP/launcher-pid" "$LIVE_READY" <<'PY' &
import json
import os
import signal
import subprocess
import sys
import time

launcher, target, tooling_root, pid_path, ready_path = sys.argv[1:]
environment = os.environ | {"CWD": target, "LAZYBUDDY_TOOLING_ROOT": tooling_root}
process = subprocess.Popen(
    ["bash", launcher],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env=environment,
)
stop_requested = False

def stop_child(_signum, _frame):
    global stop_requested
    stop_requested = True

signal.signal(signal.SIGTERM, stop_child)
signal.signal(signal.SIGINT, stop_child)
assert process.stdin is not None
assert process.stdout is not None
process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n")
process.stdin.flush()
response = json.loads(process.stdout.readline())
if response.get("id") != 1 or "result" not in response:
    raise SystemExit("missing MCP initialize response")
if os.path.exists(f"/proc/{process.pid}/environ"):
    with open(f"/proc/{process.pid}/environ", "rb") as source:
        environment_text = source.read().decode(errors="replace")
else:
    inspection = subprocess.run(["ps", "eww", "-p", str(process.pid), "-o", "command="], text=True, capture_output=True, timeout=10, check=False)
    environment_text = inspection.stdout
for expected in ("CODEGRAPH_TELEMETRY=0", "CODEGRAPH_NO_DOWNLOAD=1", "CODEGRAPH_NO_WATCHDOG=1", f"HOME={tooling_root}/.lazybuddy-codegraph-runtime/home"):
    if expected not in environment_text:
        raise SystemExit(f"CodeGraph launcher missing isolated environment: {expected}")
with open(pid_path, "w", encoding="utf-8") as destination:
    destination.write(f"{process.pid}\n")
with open(ready_path, "w", encoding="utf-8") as destination:
    destination.write("ready\n")
while process.poll() is None:
    if stop_requested:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        raise SystemExit(0)
    time.sleep(0.1)
PY
LIVE_HELPER_PID=$!
LIVE_HELPER_IDENTITY="$(process_identity "$LIVE_HELPER_PID")"
[ -n "$LIVE_HELPER_IDENTITY" ] || fail 'could not record live CodeGraph helper identity'
for _ in $(seq 1 100); do
    [ -f "$LIVE_READY" ] && break
    sleep 0.1
done
[ -f "$LIVE_READY" ] || fail 'live CodeGraph MCP did not initialize'
[ -f "$FAKE_SERVER_PID_FILE" ] || fail 'test-owned fake CodeGraph server did not start'
FAKE_SERVER_PID="$(cat "$FAKE_SERVER_PID_FILE")"
case "$FAKE_SERVER_PID" in ''|*[!0-9]*) fail 'fake CodeGraph server PID was invalid' ;; esac
grep -Fqx "['serve', '--mcp'] cwd=$TARGET" "$FAKE_LOG" || fail 'launcher did not invoke the test-owned exact binary'
pass 'CodeGraph launcher completes persistent MCP initialize'

OTHER_TARGET="$TMP/other-target"
mkdir "$OTHER_TARGET"
python3 -c 'import time; time.sleep(30)' "$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-sentinel" "$OTHER_TARGET" &
OTHER_PROCESS_PID=$!
OTHER_PROCESS_IDENTITY="$(process_identity "$OTHER_PROCESS_PID")"
[ -n "$OTHER_PROCESS_IDENTITY" ] || fail 'could not record other-target process identity'

expect 'CodeGraph uninstall removes only receipt-owned index' 0 bash "$LIFECYCLE" codegraph-uninstall --target "$TARGET" --tooling-root "$TOOLING_ROOT"
[ ! -e "$TARGET/.codegraph" ] || fail 'receipt-owned index was not removed'
expect 'CodeGraph uninstall stops the test-owned launcher' 0 python3 - "$TMP/launcher-pid" <<'PY'
import os
import subprocess
import sys
import time

pid_path = sys.argv[1]
pid = int(open(pid_path, encoding="utf-8").read().strip())
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    inspection = subprocess.run(
        ["ps", "-o", "stat=", "-p", str(pid)],
        text=True,
        capture_output=True,
        check=False,
    )
    state = inspection.stdout.strip()
    if not state or state.startswith("Z"):
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"test-owned CodeGraph launcher {pid} remained running after uninstall")
PY
expect 'CodeGraph uninstall stops the test-owned fake server' 0 python3 - "$FAKE_SERVER_PID" <<'PY'
import subprocess
import sys
import time

pid = int(sys.argv[1])
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    inspection = subprocess.run(
        ["ps", "-o", "stat=", "-p", str(pid)],
        text=True,
        capture_output=True,
        check=False,
    )
    state = inspection.stdout.strip()
    if not state or state.startswith("Z"):
        raise SystemExit(0)
    time.sleep(0.1)
raise SystemExit("test-owned fake CodeGraph server remained running after uninstall")
PY
wait "$LIVE_HELPER_PID" || true
LIVE_HELPER_PID=""
LIVE_HELPER_IDENTITY=""

expect 'uninstall preserves similarly named other-target process' 0 python3 - "$OTHER_PROCESS_PID" <<'PY'
import os
import sys

os.kill(int(sys.argv[1]), 0)
PY
kill "$OTHER_PROCESS_PID" 2>/dev/null || true
wait "$OTHER_PROCESS_PID" 2>/dev/null || true
OTHER_PROCESS_PID=""
OTHER_PROCESS_IDENTITY=""
printf 'preserve\n' > "$TOOLING_ROOT/unowned"
expect 'unowned tooling-root entry blocks uninstall' 2 bash "$LIFECYCLE" uninstall --tooling-root "$TOOLING_ROOT"
[ "$(cat "$TOOLING_ROOT/unowned")" = preserve ] || fail 'unsafe tooling uninstall changed unowned entry'
rm "$TOOLING_ROOT/unowned"
expect 'tooling uninstall removes owned package after index cleanup' 0 bash "$LIFECYCLE" uninstall --tooling-root "$TOOLING_ROOT"
[ ! -e "$TOOLING_ROOT" ] || fail 'owned tooling root was not removed'

PREEXISTING_ROOT="$TMP/preexisting-project"
PREEXISTING_TOOLS="$TMP/preexisting-tools"
mkdir "$PREEXISTING_ROOT" "$PREEXISTING_ROOT/.codegraph"
printf 'preserve\n' > "$PREEXISTING_ROOT/.codegraph/sentinel"
expect 'pre-existing index install provisions package' 0 bash "$LIFECYCLE" codegraph-install --target "$PREEXISTING_ROOT" --tooling-root "$PREEXISTING_TOOLS"
expect 'pre-existing index can be explicitly enabled' 0 bash "$LIFECYCLE" codegraph-enable --target "$PREEXISTING_ROOT" --tooling-root "$PREEXISTING_TOOLS"
printf '\n' >> "$PREEXISTING_TOOLS/.lazybuddy-codegraph-receipt.json"
expect 'edited CodeGraph receipt blocks uninstall' 2 bash "$LIFECYCLE" codegraph-uninstall --target "$PREEXISTING_ROOT" --tooling-root "$PREEXISTING_TOOLS"
[ "$(cat "$PREEXISTING_ROOT/.codegraph/sentinel")" = preserve ] || fail 'unsafe uninstall changed pre-existing index'
rm "$PREEXISTING_TOOLS/.lazybuddy-codegraph-receipt.json"
expect 'pre-existing receipt absence blocks uninstall' 2 bash "$LIFECYCLE" codegraph-uninstall --target "$PREEXISTING_ROOT" --tooling-root "$PREEXISTING_TOOLS"
[ "$(cat "$PREEXISTING_ROOT/.codegraph/sentinel")" = preserve ] || fail 'missing receipt changed pre-existing index'

printf 'PASS CodeGraph lifecycle, MCP, and ownership boundaries\n'
