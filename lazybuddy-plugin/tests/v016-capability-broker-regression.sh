#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TOOLING="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-capability.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }
expect_status() {
    local expected="$1" output status
    shift
    if output=$("$@" 2>&1); then status=0; else status=$?; fi
    [ "$status" = "$expected" ] || fail "expected exit $expected, got $status: $output"
    printf '%s\n' "$output"
}

WORKSPACE="$TMP/workspace"
TOOLPACK="$TMP/toolpack"
mkdir -p "$WORKSPACE" "$TOOLPACK"
if python3 - "$PLUGIN_ROOT/tooling" <<'PY'
import sys

sys.path.insert(0, sys.argv[1])
from lazybuddy_capability import ripgrep_platform_suffix

assert ripgrep_platform_suffix("Linux", "x86_64") == "linux-x64"
assert ripgrep_platform_suffix("Linux", "aarch64") == "linux-arm64"
assert ripgrep_platform_suffix("Darwin", "arm64") == "darwin-arm64"
PY
then
    pass 'owned ripgrep provider resolves Linux and Darwin package suffixes'
else
    fail 'owned ripgrep provider platform suffixes'
fi
git -C "$WORKSPACE" init -q
printf '# TODO: capability broker\n' > "$WORKSPACE/example.txt"
printf '{"mcpServers":{}}\n' > "$WORKSPACE/.mcp.json"
printf '{"lockfileVersion":3}\n' > "$WORKSPACE/package-lock.json"
git -C "$WORKSPACE" add example.txt .mcp.json package-lock.json
git -C "$WORKSPACE" -c user.name=test -c user.email=test@example.invalid commit -qm initial
git -C "$WORKSPACE" diff --quiet || fail 'fixture worktree is dirty before capability invocation'

# Given an empty private toolpack, when canonical local search runs, then it returns
# a result and a receipt without mutating the selected workspace or host MCP files.
output="$(cd "$WORKSPACE" && expect_status 0 bash "$TOOLING" capability run local_search --query TODO --toolpack-root "$TOOLPACK")"
printf '%s' "$output" > "$TMP/first.json"
python3 - "$TMP/first.json" "$TOOLPACK" <<'PY'
import json
import os
import sys

value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['status'] == 'ok'
assert value['capability'] == 'local_search'
assert 'TODO' in value['result']
assert value['receipt'] == os.path.join(os.path.realpath(sys.argv[2]), '.lazybuddy-capability-receipt.json')
assert os.path.isfile(value['receipt'])
PY
git -C "$WORKSPACE" diff --quiet || fail 'local search changed the workspace'
cmp -s "$WORKSPACE/.mcp.json" <(printf '{"mcpServers":{}}\n') || fail 'local search changed host MCP configuration'
pass 'canonical local search is task-scoped and workspace-read-only'

# Given a legacy alias, when it is requested, then the broker maps it to the
# canonical contract capability.
output="$(cd "$WORKSPACE" && expect_status 0 bash "$TOOLING" capability run rg --query TODO --toolpack-root "$TOOLPACK")"
printf '%s' "$output" > "$TMP/alias.json"
python3 - "$TMP/alias.json" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding='utf-8'))['capability'] == 'local_search'
PY
pass 'legacy alias resolves to canonical capability'

# Given a Python workspace and a matching host LSP, when canonical code navigation
# runs, then the broker selects that language-specific local provider.
LSP_BIN="$TMP/lsp-bin"
LSP_PACK="$TMP/lsp-toolpack"
mkdir "$LSP_BIN" "$LSP_PACK"
printf 'print("TODO")\n' > "$WORKSPACE/navigation.py"
cat > "$LSP_BIN/basedpyright-langserver" <<'SH'
#!/usr/bin/env bash
printf 'basedpyright 1.0\n'
SH
chmod +x "$LSP_BIN/basedpyright-langserver"
output="$(cd "$WORKSPACE" && PATH="$LSP_BIN:/usr/bin:/bin" expect_status 0 bash "$TOOLING" capability run code_navigation --query symbol --toolpack-root "$LSP_PACK")"
printf '%s' "$output" > "$TMP/lsp.json"
python3 - "$TMP/lsp.json" <<'PY'
import json
import sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['capability'] == 'code_navigation'
assert value['provider'].endswith('/basedpyright-langserver')
assert 'basedpyright' in value['result']
PY
pass 'code navigation selects matching local LSP'

# Given no host LSP and an empty private toolpack, when Python code navigation
# runs, then it provisions the matching pinned LSP beneath the owned toolpack.
NO_HOST_BIN="$TMP/no-host-bin"
NO_HOST_PACK="$TMP/no-host-toolpack"
mkdir "$NO_HOST_BIN" "$NO_HOST_PACK"
ln -s "$(command -v node)" "$NO_HOST_BIN/node"
FAKE_NPM_LOG="$TMP/no-host-npm.log"
cat > "$NO_HOST_BIN/npm" <<SH
#!/usr/bin/env bash
set -euo pipefail

# This regression exercises receipt ownership, not the registry.  Keep the
# no-host path deterministic and offline while creating only the locked
# providers that the lifecycle validates.
[ "\${1:-}" = ci ] || { printf 'unexpected fixture npm command: %s\n' "\$*" >&2; exit 64; }
printf '%s\n' "\$PWD" >> "$FAKE_NPM_LOG"

case "\$PWD" in
    */lsp/python)
        mkdir -p "\$PWD/node_modules/.bin"
        printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture basedpyright 1.0\\n"' > "\$PWD/node_modules/.bin/basedpyright-langserver"
        chmod +x "\$PWD/node_modules/.bin/basedpyright-langserver"
        ;;
    *)
        case "$(uname -s)-$(uname -m)" in
            Darwin-arm64) suffix=darwin-arm64 ;;
            Darwin-x86_64) suffix=darwin-x64 ;;
            Linux-aarch64|Linux-arm64) suffix=linux-arm64 ;;
            Linux-x86_64) suffix=linux-x64 ;;
            *) printf 'unsupported fixture platform\n' >&2; exit 64 ;;
        esac
        mkdir -p "\$PWD/node_modules/@vscode/ripgrep-\$suffix/bin" "\$PWD/node_modules/@ast-grep/cli"
        printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture rg TODO\\n"' > "\$PWD/node_modules/@vscode/ripgrep-\$suffix/bin/rg"
        printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture sg TODO\\n"' > "\$PWD/node_modules/@ast-grep/cli/sg"
        chmod +x "\$PWD/node_modules/@vscode/ripgrep-\$suffix/bin/rg" "\$PWD/node_modules/@ast-grep/cli/sg"
        printf '%s\n' '{"name":"@ast-grep/cli","version":"fixture"}' > "\$PWD/node_modules/@ast-grep/cli/package.json"
        ;;
esac
SH
chmod +x "$NO_HOST_BIN/npm"
output="$(cd "$WORKSPACE" && PATH="$NO_HOST_BIN:/usr/bin:/bin" expect_status 0 bash "$TOOLING" capability run code_navigation --query symbol --toolpack-root "$NO_HOST_PACK")"
printf '%s' "$output" > "$TMP/no-host-lsp.json"
python3 - "$TMP/no-host-lsp.json" "$NO_HOST_PACK" <<'PY'
import json
import os
import sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['capability'] == 'code_navigation'
assert '/providers/lsp/lsp/python/' in value['provider']
assert os.path.isfile(value['receipt'])
PY
git -C "$WORKSPACE" diff --quiet || fail 'automatic LSP provisioning changed the workspace'
git -C "$WORKSPACE" diff --cached --quiet || fail 'automatic LSP provisioning staged workspace changes'
cmp -s "$WORKSPACE/.mcp.json" <(printf '{"mcpServers":{}}\n') || fail 'automatic LSP provisioning changed MCP configuration'
cmp -s "$WORKSPACE/package-lock.json" <(printf '{"lockfileVersion":3}\n') || fail 'automatic LSP provisioning changed lockfile'
pass 'forced no-host Python LSP is receipt-owned and target-read-only'

# Given a receipt-owned provider root containing a regular LSP path, when no-host
# Python navigation runs, then the broker returns a typed permission error.
FILE_LSP_PACK="$TMP/file-lsp-toolpack"
mkdir "$FILE_LSP_PACK"
(cd "$WORKSPACE" && PATH="$NO_HOST_BIN:/usr/bin:/bin" bash "$TOOLING" capability run local_search --query TODO --toolpack-root "$FILE_LSP_PACK") >/dev/null
printf 'not-a-directory\n' > "$FILE_LSP_PACK/providers/lsp"
if (cd "$WORKSPACE" && PATH="$NO_HOST_BIN:/usr/bin:/bin" bash "$TOOLING" capability run code_navigation --query symbol --toolpack-root "$FILE_LSP_PACK") >"$TMP/file-lsp.json" 2>&1; then
    fail 'regular-file LSP root unexpectedly succeeded'
fi
grep -Fq 'AUTOMATIC_TOOLING_PERMISSION_DENIED' "$TMP/file-lsp.json" || fail 'regular-file LSP root lacked typed permission error'
git -C "$WORKSPACE" diff --quiet || fail 'regular-file LSP root changed the workspace'
pass 'regular-file LSP root fails closed with typed permission error'

if [ "$(wc -l < "$FAKE_NPM_LOG" | tr -d ' ')" = 2 ]; then
    pass 'forced no-host providers use the bounded test-owned npm fixture'
else
    fail 'forced no-host provider fixture invocation count'
fi

# Given an unknown capability, when it is requested, then the broker fails closed
# with the contract-owned typed error and leaves the workspace unchanged.
unknown_output="$TMP/unknown.json"
if (cd "$WORKSPACE" && bash "$TOOLING" capability run unknown --query TODO --toolpack-root "$TOOLPACK") >"$unknown_output" 2>&1; then
    fail 'unknown capability unexpectedly succeeded'
fi
grep -Fq 'AUTOMATIC_TOOLING_UNKNOWN_CAPABILITY' "$unknown_output" || fail 'unknown capability lacked typed error'
git -C "$WORKSPACE" diff --quiet || fail 'unknown capability changed workspace'
pass 'unknown capability fails closed'

# Given a stale receipt, when a local request is retried, then the broker refuses
# that private toolpack before it can invoke a provider.
STALE_PACK="$TMP/stale-toolpack"
mkdir "$STALE_PACK"
(cd "$WORKSPACE" && bash "$TOOLING" capability run local_search --query TODO --toolpack-root "$STALE_PACK") >/dev/null
printf 'stale\n' > "$STALE_PACK/.lazybuddy-capability-receipt.json"
if (cd "$WORKSPACE" && bash "$TOOLING" capability run local_search --query TODO --toolpack-root "$STALE_PACK") >"$TMP/stale.json" 2>&1; then
    fail 'stale receipt unexpectedly succeeded'
fi
grep -Fq 'AUTOMATIC_TOOLING_PERMISSION_DENIED' "$TMP/stale.json" || fail 'stale receipt lacked typed error'
pass 'stale toolpack receipt fails closed'

# Given a hung provider child, when its bounded timeout expires, then its whole
# process group is terminated and the contract timeout is returned.
HANG_BIN="$TMP/bin"
HANG_PID="$TMP/hung.pid"
mkdir "$HANG_BIN"
cat > "$HANG_BIN/rg" <<'SH'
#!/usr/bin/env bash
sleep 30 &
printf '%s\n' "$!" > "$LAZYBUDDY_HANG_PID"
wait
SH
chmod +x "$HANG_BIN/rg"
TIMEOUT_PACK="$TMP/timeout-toolpack"
mkdir "$TIMEOUT_PACK"
timeout_output="$TMP/timeout.json"
if (cd "$WORKSPACE" && PATH="$HANG_BIN:/usr/bin:/bin" LAZYBUDDY_HANG_PID="$HANG_PID" LAZYBUDDY_CAPABILITY_TIMEOUT_SECONDS=1 bash "$TOOLING" capability run local_search --query TODO --toolpack-root "$TIMEOUT_PACK") >"$timeout_output" 2>&1; then
    fail 'hung provider unexpectedly succeeded'
fi
grep -Fq 'AUTOMATIC_TOOLING_TIMEOUT' "$timeout_output" || fail 'timeout lacked typed error'
if [ -f "$HANG_PID" ] && kill -0 "$(cat "$HANG_PID")" 2>/dev/null; then
    fail 'timeout left provider descendant alive'
fi
pass 'timeout cleans up the provider process group'

printf 'PASS: task-scoped capability broker\n'
