#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
SKILL="$PLUGIN_ROOT/skills/lazy-init-deep/SKILL.md"
COMMAND="$PLUGIN_ROOT/commands/lazy-init-deep.md"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-receipt-init-deep.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
INSTALL_BIN="$TMP/install-bin"
mkdir "$INSTALL_BIN"
FAKE_NPM_LOG="$TMP/fixture-npm.log"
cat > "$INSTALL_BIN/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

# This receipt matrix verifies ownership and preservation. Its package fixture
# must be deterministic and must not contact a registry.
[ "${1:-}" = ci ] || { printf 'unexpected fixture npm command: %s\n' "$*" >&2; exit 64; }
[ -n "${LAZYBUDDY_RECEIPT_FAKE_NPM_LOG:-}" ] || { printf 'missing receipt fixture npm log\n' >&2; exit 64; }
printf '%s\n' "$PWD" >> "$LAZYBUDDY_RECEIPT_FAKE_NPM_LOG"
case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) codegraph_suffix=darwin-arm64 ;;
    Darwin-x86_64) codegraph_suffix=darwin-x64 ;;
    Linux-aarch64|Linux-arm64) codegraph_suffix=linux-arm64 ;;
    Linux-x86_64) codegraph_suffix=linux-x64 ;;
    *) printf 'unsupported fixture platform\n' >&2; exit 64 ;;
esac
mkdir -p "$PWD/node_modules/@vscode/ripgrep/bin" \
    "$PWD/node_modules/@ast-grep/cli" \
    "$PWD/node_modules/@colbymchenry/codegraph-$codegraph_suffix/bin"
printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture rg 1.0\\n"' > "$PWD/node_modules/@vscode/ripgrep/bin/rg"
printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture sg 1.0\\n"' > "$PWD/node_modules/@ast-grep/cli/sg"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$PWD/node_modules/@colbymchenry/codegraph-$codegraph_suffix/bin/codegraph"
chmod +x "$PWD/node_modules/@vscode/ripgrep/bin/rg" \
    "$PWD/node_modules/@ast-grep/cli/sg" \
    "$PWD/node_modules/@colbymchenry/codegraph-$codegraph_suffix/bin/codegraph"
printf '%s\n' '{"name":"@ast-grep/cli","version":"fixture"}' > "$PWD/node_modules/@ast-grep/cli/package.json"
SH
chmod +x "$INSTALL_BIN/npm"
ln -s "$(command -v node)" "$INSTALL_BIN/node"
INSTALL_PATH="$INSTALL_BIN:/usr/bin:/bin"
IN_GIT_WORKTREE=false
WORKTREE_BEFORE=""
if [ "$(git -C "$PLUGIN_ROOT" rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then
    IN_GIT_WORKTREE=true
    WORKTREE_BEFORE="$(git -C "$PLUGIN_ROOT" status --porcelain)"
fi

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

CLEAN_GIT_FIXTURE="$TMP/clean-git-worktree"
mkdir "$CLEAN_GIT_FIXTURE"
git -C "$CLEAN_GIT_FIXTURE" init -q
git -C "$CLEAN_GIT_FIXTURE" config user.email 'lazybuddy-test@example.invalid'
git -C "$CLEAN_GIT_FIXTURE" config user.name 'LazyBuddy regression fixture'
printf 'tracked fixture\n' > "$CLEAN_GIT_FIXTURE/tracked"
git -C "$CLEAN_GIT_FIXTURE" add tracked
git -C "$CLEAN_GIT_FIXTURE" commit -qm 'fixture'
CLEAN_GIT_STATUS="$(git -C "$CLEAN_GIT_FIXTURE" status --porcelain)"
[ -z "$CLEAN_GIT_STATUS" ] || fail 'clean Git fixture unexpectedly has a status entry'
[ "$(git -C "$CLEAN_GIT_FIXTURE" rev-parse --is-inside-work-tree)" = true ] \
    || fail 'clean Git fixture was not detected as a Git worktree'
FINAL_GUARD="$(tail -n 12 "$0")"
case "$FINAL_GUARD" in
    *'[ -n "$WORKTREE_BEFORE" ]'*) fail 'clean Git worktree guard still relies on a nonempty status snapshot' ;;
esac
grep -Fq 'IN_GIT_WORKTREE=false' "$0" \
    || fail 'clean Git worktree guard is not independently recorded'
case "$FINAL_GUARD" in
    *'if [ "$IN_GIT_WORKTREE" = true ]; then'*) ;;
    *) fail 'clean Git worktree guard is not enforced' ;;
esac
pass 'clean Git worktree retains mutation protection with an empty status snapshot'

expect_status() {
    local label="$1" expected="$2"
    shift 2
    local output status
    if output=$("$@" 2>&1); then status=0; else status=$?; fi
    printf '%s\n' "$output" > "$TMP/$label.out"
    [ "$status" = "$expected" ] || fail "$label exited $status, expected $expected: $output"
}

expect_refusal() {
    local label="$1" root="$2"
    expect_status "$label" 2 bash "$LIFECYCLE" uninstall --tooling-root "$root"
    grep -Fxq 'ERROR: refusing uninstall: root is not an unmodified receipt-owned installation' "$TMP/$label.out" \
        || fail "$label did not report the canonical ownership refusal"
}

install_owned() {
    local root="$1"
    mkdir "$root"
    expect_status "install-$(basename "$root")" 0 env PATH="$INSTALL_PATH" LAZYBUDDY_RECEIPT_FAKE_NPM_LOG="$FAKE_NPM_LOG" bash "$LIFECYCLE" install --tooling-root "$root"
    [ -f "$root/.lazybuddy-tooling-receipt.json" ] || fail "$(basename "$root") did not receive a receipt"
}

write_codegraph_receipt() {
    local root="$1" target="$2"
    python3 - "$root" "$target" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
receipt = {
    "schema_version": 1,
    "owner": "lazybuddy-codegraph",
    "tooling_root": str(root),
    "target_root": str(target),
    "index_path": f"{target}/.codegraph",
    "created_index": False,
    "enabled": False,
}
(root / ".lazybuddy-codegraph-receipt.json").write_text(
    json.dumps(receipt, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY
}

# Given the InitDeep source documents, when their receipt/readiness contract is
# checked, then both must record the shared evidence vocabulary and the limits
# of package-only verification before a matrix fixture is provisioned.
for document in "$SKILL" "$COMMAND"; do
    for key in readiness_result readiness_host capability_statuses optional_policy receipt_state evidence_paths; do
        grep -Fq "$key" "$document" || fail "$(basename "$document") is missing evidence key $key"
    done
done
grep -Fq 'load check first' "$SKILL" || fail 'InitDeep does not require the load check first'
grep -Fq 'skills, commands, agents, hooks, and MCP declarations' "$SKILL" || fail 'InitDeep does not verify package inventory and declarations'
grep -Fq 'does not prove a live host session or MCP connection' "$SKILL" || fail 'InitDeep overclaims host or MCP verification'
grep -Fq 'Do not enable optional capabilities' "$SKILL" || fail 'InitDeep does not preserve optional capability state'
if grep -Eqi 'automatically enable optional|auto-enable optional|enables optional capabilities' "$SKILL" "$COMMAND"; then
    fail 'InitDeep claims automatic optional capability activation'
fi
pass 'InitDeep evidence contract records package-only readiness'
bash "$PLUGIN_ROOT/scripts/lazybuddy-docs-check.sh" > "$TMP/docs-check.json" || fail 'documentation regression check failed'
grep -Fq '"policy_violations":0' "$TMP/docs-check.json" || fail 'documentation regression check reported a policy violation'
pass 'documentation checker enforces the InitDeep evidence contract'

DOCS_FIXTURE="$TMP/docs-fixture"
mkdir -p "$DOCS_FIXTURE/scripts" "$DOCS_FIXTURE/skills/lazy-init-deep" "$DOCS_FIXTURE/commands"
cp "$PLUGIN_ROOT/scripts/lazybuddy-docs-check.sh" "$DOCS_FIXTURE/scripts/"
cp "$SKILL" "$DOCS_FIXTURE/skills/lazy-init-deep/SKILL.md"
cp "$COMMAND" "$DOCS_FIXTURE/commands/lazy-init-deep.md"
python3 - "$DOCS_FIXTURE/commands/lazy-init-deep.md" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text(encoding="utf-8").replace("  readiness_result: {load-check result}\n", "", 1), encoding="utf-8")
PY
if CODEBUDDY_PLUGIN_ROOT="$DOCS_FIXTURE" bash "$DOCS_FIXTURE/scripts/lazybuddy-docs-check.sh" > "$TMP/docs-missing-key.json" 2>&1; then
    fail 'documentation checker accepted a missing InitDeep evidence key'
fi
grep -Fq 'readiness_result' "$TMP/docs-missing-key.json" || fail 'documentation checker did not identify the missing evidence key'
pass 'documentation checker rejects missing InitDeep evidence keys'

# Given an empty caller-owned directory with no receipt, when uninstall is
# requested, then it refuses without deleting that directory.
NO_RECEIPT="$TMP/no-receipt"
mkdir "$NO_RECEIPT"
expect_refusal 'no-receipt-refusal' "$NO_RECEIPT"
[ -d "$NO_RECEIPT" ] || fail 'no-receipt root was deleted'
pass 'no receipt is preserved with the canonical refusal'

# Given a valid receipt-owned root with legitimate mutable runtime data, a
# caller project lockfile, and a manual host registration, when uninstall runs,
# then it removes only the owned root and preserves every caller-owned path.
VALID_ROOT="$TMP/valid-root"
PROJECT="$TMP/project"
HOST_REGISTRATION="$TMP/host-registration.json"
mkdir "$PROJECT"
printf '{"lockfileVersion":3}\n' > "$PROJECT/package-lock.json"
printf '{"mcpServers":{"caller-owned":{}}}\n' > "$HOST_REGISTRATION"
install_owned "$VALID_ROOT"
printf 'mutable runtime data\n' > "$VALID_ROOT/.lazybuddy-npm-runtime/cache/runtime-state"
expect_status 'valid-receipt-uninstall' 0 bash "$LIFECYCLE" uninstall --tooling-root "$VALID_ROOT"
grep -Fxq 'STATE: removed' "$TMP/valid-receipt-uninstall.out" || fail 'valid receipt did not report removal'
[ ! -e "$VALID_ROOT" ] || fail 'valid receipt-owned root was not removed'
grep -Fxq '{"lockfileVersion":3}' "$PROJECT/package-lock.json" || fail 'project lockfile was changed'
grep -Fxq '{"mcpServers":{"caller-owned":{}}}' "$HOST_REGISTRATION" || fail 'manual host registration was changed'
pass 'valid receipt permits runtime cleanup while preserving project and host state'

# Given a second uninstall after the owned root is gone, when it is requested,
# then the operation fails closed and does not reinterpret caller paths as owned.
expect_refusal 'second-uninstall-refusal' "$VALID_ROOT"
[ ! -e "$VALID_ROOT" ] || fail 'second uninstall recreated an owned root'
[ -f "$HOST_REGISTRATION" ] || fail 'second uninstall changed host registration'
pass 'second uninstall is safely idempotent'

# Given a modified owned file, an unknown sibling, malformed receipt data, a
# symlinked receipt, or a hardlinked receipt, when uninstall is requested, then
# every unsafe root is preserved under the same ownership refusal reason.
MODIFIED_ROOT="$TMP/modified-owned-file"
install_owned "$MODIFIED_ROOT"
printf '\n' >> "$MODIFIED_ROOT/package.json"
expect_refusal 'modified-owned-file-refusal' "$MODIFIED_ROOT"
[ -f "$MODIFIED_ROOT/package.json" ] || fail 'modified owned file was deleted'

UNKNOWN_ROOT="$TMP/unknown-sibling"
install_owned "$UNKNOWN_ROOT"
printf 'caller-owned\n' > "$UNKNOWN_ROOT/unknown-sibling"
expect_refusal 'unknown-sibling-refusal' "$UNKNOWN_ROOT"
grep -Fxq 'caller-owned' "$UNKNOWN_ROOT/unknown-sibling" || fail 'unknown sibling was deleted'

MALFORMED_ROOT="$TMP/malformed-receipt"
install_owned "$MALFORMED_ROOT"
printf '{not-json}\n' > "$MALFORMED_ROOT/.lazybuddy-tooling-receipt.json"
expect_refusal 'malformed-receipt-refusal' "$MALFORMED_ROOT"
[ -d "$MALFORMED_ROOT" ] || fail 'malformed receipt root was deleted'

SYMLINK_ROOT="$TMP/symlink-receipt"
SYMLINK_TARGET="$TMP/symlink-target"
install_owned "$SYMLINK_ROOT"
printf 'outside\n' > "$SYMLINK_TARGET"
rm "$SYMLINK_ROOT/.lazybuddy-tooling-receipt.json"
ln -s "$SYMLINK_TARGET" "$SYMLINK_ROOT/.lazybuddy-tooling-receipt.json"
expect_refusal 'symlink-receipt-refusal' "$SYMLINK_ROOT"
grep -Fxq 'outside' "$SYMLINK_TARGET" || fail 'symlink target was changed'

HARDLINK_ROOT="$TMP/hardlink-receipt"
HARDLINK_TARGET="$TMP/hardlink-target.json"
LINUX_STAT_BIN="$TMP/linux-stat-bin"
mkdir "$LINUX_STAT_BIN"
cat > "$LINUX_STAT_BIN/stat" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "-f" ]; then
    printf '%s\n' 'linux filesystem metadata'
    exit 0
fi
if [ "${1:-}" = "-c" ] && [ "${2:-}" = '%h' ]; then
    printf '%s\n' 2
    exit 0
fi
exec /usr/bin/stat "$@"
SH
chmod +x "$LINUX_STAT_BIN/stat"
install_owned "$HARDLINK_ROOT"
mv "$HARDLINK_ROOT/.lazybuddy-tooling-receipt.json" "$HARDLINK_TARGET"
ln "$HARDLINK_TARGET" "$HARDLINK_ROOT/.lazybuddy-tooling-receipt.json"
expect_refusal 'hardlink-receipt-refusal' "$HARDLINK_ROOT"
hardlink_count() {
    stat -c '%h' "$1" 2>/dev/null || stat -f '%l' "$1"
}
[ "$(PATH="$LINUX_STAT_BIN:$PATH" hardlink_count "$HARDLINK_TARGET")" = 2 ] || fail 'hardlink receipt was changed'
pass 'tampered, unknown, symlinked, and hardlinked roots are preserved'

# Given a caller-owned pre-existing CodeGraph index and a matching receipt that
# records created_index=false, when CodeGraph is uninstalled, then the project
# index survives while the LazyBuddy receipt is removed.
CODEGRAPH_ROOT="$TMP/codegraph-root"
CODEGRAPH_PROJECT="$TMP/codegraph-project"
mkdir "$CODEGRAPH_PROJECT" "$CODEGRAPH_PROJECT/.codegraph"
printf 'caller-owned index\n' > "$CODEGRAPH_PROJECT/.codegraph/sentinel"
install_owned "$CODEGRAPH_ROOT"
write_codegraph_receipt "$CODEGRAPH_ROOT" "$CODEGRAPH_PROJECT"
expect_status 'caller-owned-codegraph-uninstall' 0 bash "$LIFECYCLE" codegraph-uninstall --target "$CODEGRAPH_PROJECT" --tooling-root "$CODEGRAPH_ROOT"
grep -Fxq 'INDEX: preserved (pre-existing before explicit LazyBuddy initialization)' "$TMP/caller-owned-codegraph-uninstall.out" || fail 'caller-owned CodeGraph index was not reported as preserved'
grep -Fxq 'caller-owned index' "$CODEGRAPH_PROJECT/.codegraph/sentinel" || fail 'caller-owned CodeGraph index was deleted'
[ ! -e "$CODEGRAPH_ROOT/.lazybuddy-codegraph-receipt.json" ] || fail 'CodeGraph receipt was not removed'
expect_status 'codegraph-root-uninstall-after-index-preserved' 0 bash "$LIFECYCLE" uninstall --tooling-root "$CODEGRAPH_ROOT"
[ ! -e "$CODEGRAPH_ROOT" ] || fail 'CodeGraph tooling root was not removed after receipt cleanup'
pass 'caller-owned CodeGraph index remains outside receipt-owned removal'

if [ "$(wc -l < "$FAKE_NPM_LOG" | tr -d ' ')" -eq 7 ]; then
    pass 'receipt matrix uses the bounded test-owned npm fixture'
else
    fail 'receipt matrix uses the bounded test-owned npm fixture'
fi

if [ "$IN_GIT_WORKTREE" = true ]; then
    [ "$WORKTREE_BEFORE" = "$(git -C "$PLUGIN_ROOT" status --porcelain)" ] || fail 'matrix changed the Git worktree instead of temporary fixtures'
else
    pass 'matrix runs without a surrounding Git worktree'
fi
printf 'v0.17 LazyBuddy receipt/uninstall and InitDeep regression: PASS\n'
