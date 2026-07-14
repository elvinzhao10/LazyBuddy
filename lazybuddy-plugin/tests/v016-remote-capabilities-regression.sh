#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-remote.XXXXXX")"
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
snapshot() {
    find "$1" -type f -print0 | sort -z | xargs -0 shasum > "$2"
}

TOOLS="$TMP/tools"
mkdir "$TOOLS"
CALLER_HOME="$TMP/caller-home"
mkdir "$CALLER_HOME"
printf 'caller-owned\n' > "$CALLER_HOME/sentinel"
INSTALL_BIN="$TMP/install-bin"
mkdir "$INSTALL_BIN"
ln -s "$(command -v npm)" "$INSTALL_BIN/npm"
ln -s "$(command -v node)" "$INSTALL_BIN/node"
INSTALL_PATH="$INSTALL_BIN:/usr/bin:/bin"
expect 'install owned tooling' 0 env HOME="$CALLER_HOME" PATH="$INSTALL_PATH" bash "$LIFECYCLE" install --tooling-root "$TOOLS"
[ "$(cat "$CALLER_HOME/sentinel")" = caller-owned ] || fail 'tooling install changed caller home sentinel'
[ "$(find "$CALLER_HOME" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 1 ] || fail 'tooling install wrote caller home state'
pass 'tooling install keeps npm state receipt-owned'

NETWORK_MARKER="$TMP/network-called"
NETWORK_BIN="$TMP/network-bin"
mkdir "$NETWORK_BIN"
cat > "$NETWORK_BIN/curl" <<SH
#!/usr/bin/env bash
printf 'unexpected remote call\\n' > "$NETWORK_MARKER"
exit 99
SH
chmod +x "$NETWORK_BIN/curl"

snapshot "$TOOLS" "$TMP/before-offline"
expect 'remote status is disabled by default' 0 env PATH="$NETWORK_BIN:/usr/bin:/bin" CONTEXT7_API_KEY=never-persist bash "$LIFECYCLE" remote-status --tooling-root "$TOOLS"
grep -Fxq 'CAPABILITY: context7' "$TMP/remote status is disabled by default.out" || fail 'Context7 absent from remote status'
grep -Fxq 'STATE: disabled' "$TMP/remote status is disabled by default.out" || fail 'remote default is not disabled'
if grep -q 'never-persist' "$TMP/remote status is disabled by default.out"; then fail 'remote status leaked credential'; fi
snapshot "$TOOLS" "$TMP/after-offline"
cmp -s "$TMP/before-offline" "$TMP/after-offline" || fail 'remote status mutated tooling root'
pass 'remote status stays offline and read-only'

expect 'disabled remote export is empty' 0 bash "$LIFECYCLE" remote-export-mcp --tooling-root "$TOOLS"
python3 - "$TMP/disabled remote export is empty.out" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding="utf-8")) == {"mcpServers": {}}
PY
pass 'disabled export has no host registrations'

expect 'enable Context7 explicitly' 0 bash "$LIFECYCLE" remote-enable --tooling-root "$TOOLS" context7
expect 'enable grep_app explicitly' 0 bash "$LIFECYCLE" remote-enable --tooling-root "$TOOLS" grep_app
expect 'enabled remote export' 0 env CONTEXT7_API_KEY=never-persist bash "$LIFECYCLE" remote-export-mcp --tooling-root "$TOOLS"
python3 - "$TMP/enabled remote export.out" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
servers = data["mcpServers"]
assert servers["lazybuddy_context7"]["url"] == "https://mcp.context7.com/mcp"
assert servers["lazybuddy_grep_app"]["url"] == "https://mcp.grep.app"
assert servers["lazybuddy_grep_app"]["experimental"] is True
assert servers["lazybuddy_grep_app"]["versioning"] == "unpinned"
assert "never-persist" not in open(sys.argv[1], encoding="utf-8").read()
PY
pass 'enabled export is namespaced, endpoint-only, and credential-free'

expect 'disable Context7 explicitly' 0 bash "$LIFECYCLE" remote-disable --tooling-root "$TOOLS" context7
expect 'export after Context7 disable' 0 bash "$LIFECYCLE" remote-export-mcp --tooling-root "$TOOLS"
python3 - "$TMP/export after Context7 disable.out" <<'PY'
import json
import sys
servers = json.load(open(sys.argv[1], encoding="utf-8"))["mcpServers"]
assert "lazybuddy_context7" not in servers
assert "lazybuddy_grep_app" in servers
PY
pass 'disable removes only the managed Context7 fragment'

expect 'remote doctor is non-blocking' 0 bash "$LIFECYCLE" remote-doctor --tooling-root "$TOOLS"
grep -Fxq 'DOCTOR: PASS (optional remote capabilities)' "$TMP/remote doctor is non-blocking.out" || fail 'remote doctor did not report optional pass'
[ ! -e "$NETWORK_MARKER" ] || fail 'normal remote lifecycle contacted a network tool'
pass 'normal remote lifecycle made no remote request'
expect 'unknown remote capability is rejected' 2 bash "$LIFECYCLE" remote-enable --tooling-root "$TOOLS" unknown

expect 'uninstall owned tooling' 0 bash "$LIFECYCLE" uninstall --tooling-root "$TOOLS"
[ ! -e "$TOOLS" ] || fail 'receipt-owned remote state blocked safe uninstall'
pass 'safe uninstall removes receipt-owned remote state'

printf 'PASS remote capability lifecycle and offline export boundaries\n'
