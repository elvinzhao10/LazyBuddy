#!/usr/bin/env bash
set -euo pipefail

# Given a copied package, when onboarding/readiness runs, then the package
# requires its vendored automatic-tooling contract and does not mutate host MCP
# configuration.  Tooling-root uninstall is separately receipt-bound.
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-package-onboarding.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
INSTALLED="$TMP/installed/lazybuddy-plugin"
HOME_ROOT="$TMP/home"
CONFIG_ROOT="$TMP/config"
HOST_MCP="$TMP/host-mcp.json"
TOOLING_ROOT="$TMP/tooling-root"
NPM_BIN="$TMP/npm-bin"
FAKE_NPM_LOG="$TMP/fixture-npm.log"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pass() { echo "PASS $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL $1" >&2; FAIL=$((FAIL + 1)); }

expect() {
    local label="$1" expected="$2"
    shift 2
    local output rc
    if output=$("$@" 2>&1); then rc=0; else rc=$?; fi
    printf '%s\n' "$output" > "$TMP/$label.out"
    if [ "$rc" -eq "$expected" ]; then pass "$label"; else fail "$label (exit $rc, expected $expected): ${output:0:200}"; fi
}

mkdir -p "$INSTALLED" "$HOME_ROOT" "$CONFIG_ROOT" "$TOOLING_ROOT" "$NPM_BIN"
cp -R "$PLUGIN_ROOT/." "$INSTALLED/"
cat > "$NPM_BIN/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

[ "${1:-}" = ci ] || { printf 'unexpected fixture npm command: %s\n' "$*" >&2; exit 64; }
[ -n "${LAZYBUDDY_PACKAGE_FAKE_NPM_LOG:-}" ] || { printf 'missing fixture npm log\n' >&2; exit 64; }
printf '%s\n' "$PWD" >> "$LAZYBUDDY_PACKAGE_FAKE_NPM_LOG"
case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) suffix=darwin-arm64 ;;
    Darwin-x86_64) suffix=darwin-x64 ;;
    Linux-aarch64|Linux-arm64) suffix=linux-arm64 ;;
    Linux-x86_64) suffix=linux-x64 ;;
    *) printf 'unsupported fixture platform\n' >&2; exit 64 ;;
esac
mkdir -p "$PWD/node_modules/@vscode/ripgrep-$suffix/bin" "$PWD/node_modules/@ast-grep/cli"
printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture rg 1.0\\n"' > "$PWD/node_modules/@vscode/ripgrep-$suffix/bin/rg"
printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture sg 1.0\\n"' > "$PWD/node_modules/@ast-grep/cli/sg"
chmod +x "$PWD/node_modules/@vscode/ripgrep-$suffix/bin/rg" "$PWD/node_modules/@ast-grep/cli/sg"
printf '%s\n' '{"name":"@ast-grep/cli","version":"fixture"}' > "$PWD/node_modules/@ast-grep/cli/package.json"
SH
chmod +x "$NPM_BIN/npm"
printf '{"caller":"owned"}\n' > "$HOST_MCP"
cp "$HOST_MCP" "$TMP/host-mcp.before"

expect "installed package readiness" 0 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED" bash "$INSTALLED/scripts/lazybuddy-load-check.sh"
expect "installed package doctor" 0 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED" bash "$INSTALLED/scripts/lazybuddy-plugin-doctor.sh"
expect "installed policy and capability adapters import" 0 env INSTALLED="$INSTALLED" python3 -B -c 'import os, sys; sys.path.insert(0, os.path.join(os.environ["INSTALLED"], "tooling")); import lazybuddy_capability, lazybuddy_policy'
expect "onboarding setup is package-local" 0 env HOME="$HOME_ROOT" XDG_CONFIG_HOME="$CONFIG_ROOT" CODEBUDDY_HOST_MCP_CONFIG="$HOST_MCP" bash "$INSTALLED/scripts/lazybuddy-tooling.sh" setup --non-interactive --json
expect "provider status is accurate and offline" 0 env HOME="$HOME_ROOT" XDG_CONFIG_HOME="$CONFIG_ROOT" CODEBUDDY_HOST_MCP_CONFIG="$HOST_MCP" bash "$INSTALLED/scripts/lazybuddy-tooling.sh" providers --policy ask-once --json

if cmp -s "$HOST_MCP" "$TMP/host-mcp.before" && [ ! -e "$INSTALLED/.mcp.json.tmp" ]; then
    pass "onboarding does not persistently mutate host MCP configuration"
else
    fail "onboarding does not persistently mutate host MCP configuration"
fi
if python3 - "$TMP/provider status is accurate and offline.out" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["providers"]["context7"]["reachability"] == "not_contacted"
assert payload["providers"]["grep_app"]["reachability"] == "not_contacted"
assert payload["providers"]["playwright"]["decision"] == "ask"
PY
then pass "providers report offline remote and approval-gated browser state"; else fail "providers report offline remote and approval-gated browser state"; fi

expect "tooling install receipt" 0 env PATH="$NPM_BIN:/usr/bin:/bin" LAZYBUDDY_PACKAGE_FAKE_NPM_LOG="$FAKE_NPM_LOG" bash "$INSTALLED/scripts/lazybuddy-tooling.sh" install --tooling-root "$TOOLING_ROOT"
if [ "$(wc -l < "$FAKE_NPM_LOG" | tr -d ' ')" = 1 ]; then pass "tooling install uses the bounded test-owned npm fixture"; else fail "tooling fixture npm invocation count"; fi
printf 'caller-owned\n' > "$TOOLING_ROOT/caller-owned"
expect "unsafe tooling uninstall is rejected" 2 bash "$INSTALLED/scripts/lazybuddy-tooling.sh" uninstall --tooling-root "$TOOLING_ROOT"
if [ -f "$TOOLING_ROOT/caller-owned" ]; then pass "unsafe uninstall preserves caller-owned root"; else fail "unsafe uninstall preserves caller-owned root"; fi

rm "$INSTALLED/contracts/automatic-tooling-contract.v1.json"
expect "missing packed contract fails readiness" 1 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED" bash "$INSTALLED/scripts/lazybuddy-load-check.sh"

SIDECAR_MISSING="$TMP/sidecar-missing"
cp -R "$PLUGIN_ROOT" "$SIDECAR_MISSING"
rm "$SIDECAR_MISSING/contracts/automatic-tooling-contract.v1.json.sha256"
expect "missing packed sidecar fails doctor" 1 env CODEBUDDY_PLUGIN_ROOT="$SIDECAR_MISSING" bash "$SIDECAR_MISSING/scripts/lazybuddy-plugin-doctor.sh"
if ! grep -q 'Traceback' "$TMP/missing packed sidecar fails doctor.out"; then
    pass "missing sidecar doctor failure is concise"
else
    fail "missing sidecar doctor failure is concise"
fi

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
