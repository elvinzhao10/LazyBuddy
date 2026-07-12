#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

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
mkdir "$TARGET" "$TOOLING_ROOT"
printf 'export const value = 1;\n' > "$TARGET/source.ts"

# Given a fresh project and caller-owned empty tooling root, when CodeGraph is
# inspected before explicit provisioning, then it is non-blocking and writes
# neither the target nor the tooling root.
expect 'CodeGraph status is disabled by default' 0 bash "$LIFECYCLE" codegraph-status --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -Fxq 'STATE: disabled' "$TMP/CodeGraph status is disabled by default.out" || fail 'default CodeGraph state'
[ ! -e "$TARGET/.codegraph" ] || fail 'default status created project index'
[ -z "$(find "$TOOLING_ROOT" -mindepth 1 -print -quit)" ] || fail 'default status wrote tooling root'
pass 'disabled status is non-mutating'

# Given a large but uninitialized project, when CodeGraph doctor runs, then it
# recommends explicit activation without starting CodeGraph or creating an index.
for number in $(seq 1 500); do
    printf 'export const value%s = %s;\n' "$number" "$number" > "$TARGET/file-$number.ts"
done
expect 'CodeGraph doctor is recommendation-only' 0 bash "$LIFECYCLE" codegraph-doctor --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -q 'RECOMMENDATION: CodeGraph may materially improve architecture exploration' "$TMP/CodeGraph doctor is recommendation-only.out" || fail 'large project recommendation'
[ ! -e "$TARGET/.codegraph" ] || fail 'doctor created project index'
[ -z "$(find "$TOOLING_ROOT" -mindepth 1 -print -quit)" ] || fail 'doctor wrote tooling root'
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
expect 'CodeGraph enable is repeat-safe' 0 bash "$LIFECYCLE" codegraph-enable --target "$TARGET" --tooling-root "$TOOLING_ROOT"
expect 'CodeGraph exports a package-owned MCP configuration' 0 bash "$LIFECYCLE" codegraph-export-mcp --target "$TARGET" --tooling-root "$TOOLING_ROOT"
grep -q 'mcp/codegraph/server.sh' "$TMP/CodeGraph exports a package-owned MCP configuration.out" || fail 'exported launcher path'

expect 'CodeGraph launcher completes MCP initialize' 0 python3 - "$PLUGIN_ROOT/mcp/codegraph/server.sh" "$TARGET" "$TOOLING_ROOT" <<'PY'
import json
import os
import subprocess
import sys

launcher, target, tooling_root = sys.argv[1:]
environment = os.environ | {"CWD": target, "LAZYBUDDY_TOOLING_ROOT": tooling_root}
process = subprocess.Popen(
    ["bash", launcher],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env=environment,
)
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
for expected in ("CODEGRAPH_TELEMETRY=0", "CODEGRAPH_NO_DOWNLOAD=1", f"HOME={tooling_root}/.lazybuddy-codegraph-runtime/home"):
    if expected not in environment_text:
        raise SystemExit(f"CodeGraph launcher missing isolated environment: {expected}")
process.terminate()
stdout, stderr = process.communicate(timeout=15)
if process.returncode not in {0, -15}:
    raise SystemExit(stderr or stdout)
PY

expect 'CodeGraph uninstall removes only receipt-owned index' 0 bash "$LIFECYCLE" codegraph-uninstall --target "$TARGET" --tooling-root "$TOOLING_ROOT"
[ ! -e "$TARGET/.codegraph" ] || fail 'receipt-owned index was not removed'
printf 'preserve\n' > "$TOOLING_ROOT/unowned"
expect 'unowned tooling-root entry blocks uninstall' 2 bash "$LIFECYCLE" uninstall --tooling-root "$TOOLING_ROOT"
[ "$(cat "$TOOLING_ROOT/unowned")" = preserve ] || fail 'unsafe tooling uninstall changed unowned entry'
rm "$TOOLING_ROOT/unowned"
expect 'tooling uninstall removes owned package after index cleanup' 0 bash "$LIFECYCLE" uninstall --tooling-root "$TOOLING_ROOT"
[ ! -e "$TOOLING_ROOT" ] || fail 'owned tooling root was not removed'

PREEXISTING_ROOT="$TMP/preexisting-project"
PREEXISTING_TOOLS="$TMP/preexisting-tools"
mkdir "$PREEXISTING_ROOT" "$PREEXISTING_TOOLS" "$PREEXISTING_ROOT/.codegraph"
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
