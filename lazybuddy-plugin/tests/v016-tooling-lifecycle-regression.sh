#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-tooling-lifecycle.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
INSTALL_BIN="$TMP/install-bin"
mkdir "$INSTALL_BIN"
ln -s "$(command -v npm)" "$INSTALL_BIN/npm"
ln -s "$(command -v node)" "$INSTALL_BIN/node"
INSTALL_PATH="$INSTALL_BIN:/usr/bin:/bin"
PASS=0
FAIL=0

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

pass() {
    echo "PASS $1"
    PASS=$((PASS + 1))
}

fail() {
    echo "FAIL $1" >&2
    FAIL=$((FAIL + 1))
}

expect_status() {
    local label="$1"
    local expected="$2"
    shift 2
    local output rc
    if output=$("$@" 2>&1); then
        rc=0
    else
        rc=$?
    fi
    printf '%s\n' "$output" > "$TMP/${label}.out"
    if [ "$rc" -eq "$expected" ]; then
        pass "$label"
    else
        fail "$label (exit $rc, expected $expected): ${output:0:240}"
    fi
}

snapshot() {
    local root="$1"
    find "$root" -type f -print0 | sort -z | xargs -0 shasum > "$TMP/snapshot.txt"
}

# Given the v0.15 package doctor, when it runs before any lifecycle wiring,
# then it remains a package-readiness check rather than a tooling installer.
if doctor_output=$(bash "$PLUGIN_ROOT/scripts/lazybuddy-plugin-doctor.sh" 2>&1); then
    if ! grep -qi 'tooling install' <<<"$doctor_output"; then
        pass "baseline doctor does not install tooling"
    else
        fail "baseline doctor does not install tooling"
    fi
else
    fail "baseline doctor succeeds"
fi

MISSING_ROOT="$TMP/missing"
expect_status "status reports unavailable root" 0 bash "$LIFECYCLE" status --tooling-root "$MISSING_ROOT"
if grep -q 'STATE: unavailable' "$TMP/status reports unavailable root.out"; then
    pass "status reports useful unavailable state"
else
    fail "status reports useful unavailable state"
fi

HOST_BIN="$TMP/host-bin"
mkdir "$HOST_BIN"
for provider in rg sg; do
    cat > "$HOST_BIN/$provider" <<'SH'
#!/usr/bin/env bash
printf 'fixture provider 1.0\n'
SH
    chmod +x "$HOST_BIN/$provider"
done
HOST_SENTINEL="$TMP/host-sentinel"
printf 'host-owned\n' > "$HOST_SENTINEL"
expect_status "detect prefers compatible host providers" 0 env PATH="$HOST_BIN:/usr/bin:/bin" bash "$LIFECYCLE" detect --tooling-root "$MISSING_ROOT"
if grep -q "PROVIDER: rg host $HOST_BIN/rg" "$TMP/detect prefers compatible host providers.out" \
    && grep -q "PROVIDER: sg host $HOST_BIN/sg" "$TMP/detect prefers compatible host providers.out" \
    && [ "$(cat "$HOST_SENTINEL")" = "host-owned" ]; then
    pass "host detection does not claim or delete host tools"
else
    fail "host detection does not claim or delete host tools"
fi
HOST_ONLY_ROOT="$TMP/host-only-root"
mkdir "$HOST_ONLY_ROOT"
expect_status "install skips owned fallback when host tools are ready" 0 env PATH="$HOST_BIN:$INSTALL_PATH" bash "$LIFECYCLE" install --tooling-root "$HOST_ONLY_ROOT"
if [ -z "$(find "$HOST_ONLY_ROOT" -mindepth 1 -print -quit)" ]; then
    pass "host-only install leaves caller root untouched"
else
    fail "host-only install leaves caller root untouched"
fi

expect_status "doctor rejects unavailable root" 1 bash "$LIFECYCLE" doctor --tooling-root "$MISSING_ROOT"
expect_status "detect reports empty provider registry" 0 bash "$LIFECYCLE" detect --tooling-root "$MISSING_ROOT"
if grep -q 'CAPABILITY: local_search' "$TMP/detect reports empty provider registry.out" \
    && grep -q 'PROVIDER: rg' "$TMP/detect reports empty provider registry.out" \
    && grep -q 'CAPABILITY: structural_search' "$TMP/detect reports empty provider registry.out" \
    && grep -q 'PROVIDER: sg' "$TMP/detect reports empty provider registry.out"; then
    pass "detect reports core local providers"
else
    fail "detect reports core local providers"
fi
expect_status "relative root rejected" 2 bash "$LIFECYCLE" install --tooling-root relative-root

TRAVERSAL="$TMP/../$(basename "$TMP")/traversal-root"
mkdir "$TMP/traversal-root"
expect_status "traversal root rejected" 2 bash "$LIFECYCLE" install --tooling-root "$TRAVERSAL"

NONEMPTY="$TMP/nonempty"
mkdir "$NONEMPTY"
printf 'keep\n' > "$NONEMPTY/sentinel"
expect_status "nonempty root rejected" 2 bash "$LIFECYCLE" install --tooling-root "$NONEMPTY"
if [ "$(cat "$NONEMPTY/sentinel")" = "keep" ]; then
    pass "nonempty root remains unchanged"
else
    fail "nonempty root remains unchanged"
fi

TARGET="$TMP/target"
SYMLINK_ROOT="$TMP/symlink-root"
mkdir "$TARGET"
ln -s "$TARGET" "$SYMLINK_ROOT"
expect_status "symlink root rejected" 2 bash "$LIFECYCLE" install --tooling-root "$SYMLINK_ROOT"
expect_status "status refuses symlink root" 0 bash "$LIFECYCLE" status --tooling-root "$SYMLINK_ROOT"
if grep -q 'STATE: unavailable' "$TMP/status refuses symlink root.out"; then
    pass "status does not misreport symlink root"
else
    fail "status does not misreport symlink root"
fi
if [ -d "$TARGET" ] && [ -z "$(find "$TARGET" -mindepth 1 -print -quit)" ]; then
    pass "symlink target remains unchanged"
else
    fail "symlink target remains unchanged"
fi

ANCESTOR_OUTSIDE="$TMP/ancestor-outside"
ANCESTOR_LINK="$TMP/ancestor-link"
ANCESTOR_ROOT="$ANCESTOR_LINK/owned"
mkdir -p "$ANCESTOR_OUTSIDE/owned"
ln -s "$ANCESTOR_OUTSIDE" "$ANCESTOR_LINK"
expect_status "ancestor symlink root rejected" 2 bash "$LIFECYCLE" install --tooling-root "$ANCESTOR_ROOT"
expect_status "ancestor symlink uninstall rejected" 2 bash "$LIFECYCLE" uninstall --tooling-root "$ANCESTOR_ROOT"
if [ -d "$ANCESTOR_OUTSIDE/owned" ] && [ -z "$(find "$ANCESTOR_OUTSIDE/owned" -mindepth 1 -print -quit)" ]; then
    pass "ancestor symlink target remains unchanged"
else
    fail "ancestor symlink target remains unchanged"
fi

ROOT="$TMP/tooling-root"
mkdir "$ROOT"
expect_status "install into explicit empty root" 0 env PATH="$INSTALL_PATH" bash "$LIFECYCLE" install --tooling-root "$ROOT"
if [ -f "$ROOT/.lazybuddy-tooling-receipt.json" ] && [ -f "$ROOT/package-lock.json" ]; then
    pass "install writes receipt and locked manifest"
else
    fail "install writes receipt and locked manifest"
fi
OWNED_RG="$(find "$ROOT/node_modules/@vscode" -path '*/bin/rg' -type f -print -quit)"
expect_status "owned ripgrep reports version" 0 "$OWNED_RG" --version
expect_status "owned ast-grep reports version" 0 "$ROOT/node_modules/@ast-grep/cli/sg" --version

snapshot "$ROOT"
cp "$TMP/snapshot.txt" "$TMP/before-read-only.txt"
expect_status "status ready root" 0 bash "$LIFECYCLE" status --tooling-root "$ROOT"
expect_status "detect ready root" 0 bash "$LIFECYCLE" detect --tooling-root "$ROOT"
expect_status "doctor ready root" 0 bash "$LIFECYCLE" doctor --tooling-root "$ROOT"
if grep -q 'PROVIDER: rg' "$TMP/detect ready root.out" \
    && grep -q 'PROVIDER: sg' "$TMP/detect ready root.out"; then
    pass "detect resolves host or owned providers"
else
    fail "detect resolves host or owned providers"
fi
snapshot "$ROOT"
if cmp -s "$TMP/before-read-only.txt" "$TMP/snapshot.txt"; then
    pass "status and doctor are read-only"
else
    fail "status and doctor are read-only"
fi

expect_status "repeated install rejected" 2 bash "$LIFECYCLE" install --tooling-root "$ROOT"
snapshot "$ROOT"
if cmp -s "$TMP/before-read-only.txt" "$TMP/snapshot.txt"; then
    pass "repeated install preserves owned root"
else
    fail "repeated install preserves owned root"
fi

cp "$ROOT/.lazybuddy-tooling-receipt.json" "$TMP/receipt-original.json"
printf '\n' >> "$ROOT/.lazybuddy-tooling-receipt.json"
expect_status "edited receipt blocks uninstall" 2 bash "$LIFECYCLE" uninstall --tooling-root "$ROOT"
if [ -d "$ROOT" ] && [ -f "$ROOT/package-lock.json" ]; then
    pass "edited receipt prevents deletion"
else
    fail "edited receipt prevents deletion"
fi
cp "$TMP/receipt-original.json" "$ROOT/.lazybuddy-tooling-receipt.json"

rm "$ROOT/.lazybuddy-tooling-receipt.json"
ln "$TMP/receipt-original.json" "$ROOT/.lazybuddy-tooling-receipt.json"
expect_status "hardlink receipt blocks uninstall" 2 bash "$LIFECYCLE" uninstall --tooling-root "$ROOT"
if [ -d "$ROOT" ] && [ -f "$ROOT/package-lock.json" ]; then
    pass "hardlink receipt prevents deletion"
else
    fail "hardlink receipt prevents deletion"
fi
rm "$ROOT/.lazybuddy-tooling-receipt.json"
cp "$TMP/receipt-original.json" "$ROOT/.lazybuddy-tooling-receipt.json"

RECEIPT_TARGET="$TMP/receipt-target"
printf 'outside\n' > "$RECEIPT_TARGET"
rm "$ROOT/.lazybuddy-tooling-receipt.json"
ln -s "$RECEIPT_TARGET" "$ROOT/.lazybuddy-tooling-receipt.json"
expect_status "symlink receipt blocks uninstall" 2 bash "$LIFECYCLE" uninstall --tooling-root "$ROOT"
if [ "$(cat "$RECEIPT_TARGET")" = "outside" ] && [ -d "$ROOT" ]; then
    pass "symlink receipt target remains untouched"
else
    fail "symlink receipt target remains untouched"
fi

CLEAN_ROOT="$TMP/clean-root"
mkdir "$CLEAN_ROOT"
expect_status "fresh install for uninstall" 0 env PATH="$INSTALL_PATH" bash "$LIFECYCLE" install --tooling-root "$CLEAN_ROOT"
expect_status "receipt-owned uninstall" 0 bash "$LIFECYCLE" uninstall --tooling-root "$CLEAN_ROOT"
if [ ! -e "$CLEAN_ROOT" ]; then
    pass "receipt-owned root removed"
else
    fail "receipt-owned root removed"
fi

STALE_ROOT="$TMP/stale-root"
mkdir "$STALE_ROOT"
expect_status "fresh install for stale provider receipt" 0 env PATH="$INSTALL_PATH" bash "$LIFECYCLE" install --tooling-root "$STALE_ROOT"
printf '\n' >> "$STALE_ROOT/node_modules/@ast-grep/cli/package.json"
expect_status "stale provider receipt reports unavailable" 0 bash "$LIFECYCLE" status --tooling-root "$STALE_ROOT"
expect_status "stale provider receipt blocks uninstall" 2 bash "$LIFECYCLE" uninstall --tooling-root "$STALE_ROOT"
if [ -d "$STALE_ROOT" ]; then
    pass "stale provider root remains untouched"
else
    fail "stale provider root remains untouched"
fi

VERIFY_TARGET="$TMP/verify-target"
mkdir "$VERIFY_TARGET"
cat > "$VERIFY_TARGET/package.json" <<'JSON'
{
  "name": "fixture",
  "private": true,
  "scripts": {
    "lint": "printf lint-ok\\n",
    "typecheck": "printf typecheck-ok\\n",
    "test": "printf test-ok\\n",
    "build": "printf build-ok\\n",
    "prepare": "exit 99"
  }
}
JSON
printf '{"lockfileVersion":3}\n' > "$VERIFY_TARGET/package-lock.json"
printf 'keep dirty target state\n' > "$VERIFY_TARGET/local-note.txt"
snapshot "$VERIFY_TARGET"
cp "$TMP/snapshot.txt" "$TMP/verify-target-before.txt"
expect_status "verify dry-run discovers declared commands" 0 bash "$LIFECYCLE" verify --target "$VERIFY_TARGET" --dry-run
if grep -Fxq 'COMMAND: npm run lint' "$TMP/verify dry-run discovers declared commands.out" \
    && grep -Fxq 'COMMAND: npm run typecheck' "$TMP/verify dry-run discovers declared commands.out" \
    && grep -Fxq 'COMMAND: npm run test' "$TMP/verify dry-run discovers declared commands.out" \
    && grep -Fxq 'COMMAND: npm run build' "$TMP/verify dry-run discovers declared commands.out" \
    && ! grep -q 'prepare' "$TMP/verify dry-run discovers declared commands.out"; then
    pass "verify dry-run allowlists declared commands"
else
    fail "verify dry-run allowlists declared commands"
fi
snapshot "$VERIFY_TARGET"
if cmp -s "$TMP/verify-target-before.txt" "$TMP/snapshot.txt"; then
    pass "verify dry-run preserves target tree"
else
    fail "verify dry-run preserves target tree"
fi
expect_status "verify run executes explicit declared test" 0 bash "$LIFECYCLE" verify --target "$VERIFY_TARGET" --run test
if grep -q 'test-ok' "$TMP/verify run executes explicit declared test.out"; then
    pass "verify run executes selected test"
else
    fail "verify run executes selected test"
fi

VERIFY_CALLER_HOME="$TMP/verify-caller-home"
VERIFY_CALLER_CONFIG="$TMP/verify-caller-config"
VERIFY_FAKE_BIN="$TMP/verify-fake-bin"
VERIFY_CALLER_SENTINEL="$VERIFY_CALLER_HOME/npm-state-written"
mkdir "$VERIFY_CALLER_HOME" "$VERIFY_CALLER_CONFIG" "$VERIFY_FAKE_BIN"
VERIFY_REAL_NPM="$(command -v npm)"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' "if [ \"\${HOME:-}\" = \"$VERIFY_CALLER_HOME\" ] || [ \"\${XDG_CONFIG_HOME:-}\" = \"$VERIFY_CALLER_CONFIG\" ]; then" "  touch \"$VERIFY_CALLER_SENTINEL\"" 'fi' "exec \"$VERIFY_REAL_NPM\" \"\$@\"" > "$VERIFY_FAKE_BIN/npm"
chmod +x "$VERIFY_FAKE_BIN/npm"
snapshot "$VERIFY_TARGET"
cp "$TMP/snapshot.txt" "$TMP/verify-run-before.txt"
expect_status "verify run isolates caller npm state" 0 env PATH="$VERIFY_FAKE_BIN:$PATH" HOME="$VERIFY_CALLER_HOME" XDG_CONFIG_HOME="$VERIFY_CALLER_CONFIG" bash "$LIFECYCLE" verify --target "$VERIFY_TARGET" --run test
[ ! -e "$VERIFY_CALLER_SENTINEL" ] || fail "verify run inherited caller npm runtime state"
snapshot "$VERIFY_TARGET"
if cmp -s "$TMP/verify-run-before.txt" "$TMP/snapshot.txt"; then
    pass "verify run preserves target tree with isolated npm state"
else
    fail "verify run preserves target tree with isolated npm state"
fi
expect_status "verify run rejects undeclared selection" 2 bash "$LIFECYCLE" verify --target "$VERIFY_TARGET" --run prepare

NO_MANIFEST="$TMP/no-manifest"
mkdir "$NO_MANIFEST"
expect_status "verify reports unsupported without manifest" 0 bash "$LIFECYCLE" verify --target "$NO_MANIFEST" --dry-run
if grep -Fxq 'STATE: unsupported' "$TMP/verify reports unsupported without manifest.out"; then
    pass "verify runs nothing without supported manifest"
else
    fail "verify runs nothing without supported manifest"
fi

MALFORMED_TARGET="$TMP/malformed-target"
mkdir "$MALFORMED_TARGET"
printf '{not-json\n' > "$MALFORMED_TARGET/package.json"
printf '{"lockfileVersion":3}\n' > "$MALFORMED_TARGET/package-lock.json"
expect_status "verify safely rejects malformed manifest" 0 bash "$LIFECYCLE" verify --target "$MALFORMED_TARGET" --dry-run
if grep -Fxq 'STATE: unsupported' "$TMP/verify safely rejects malformed manifest.out"; then
    pass "malformed manifest runs nothing"
else
    fail "malformed manifest runs nothing"
fi

FAILING_TARGET="$TMP/failing-target"
mkdir "$FAILING_TARGET"
cat > "$FAILING_TARGET/package.json" <<'JSON'
{"name":"failing-fixture","private":true,"scripts":{"test":"exit 23"}}
JSON
printf '{"lockfileVersion":3}\n' > "$FAILING_TARGET/package-lock.json"
expect_status "verify dry-run does not execute failing command" 0 bash "$LIFECYCLE" verify --target "$FAILING_TARGET" --dry-run test
expect_status "verify run propagates declared failure" 23 bash "$LIFECYCLE" verify --target "$FAILING_TARGET" --run test

TIMEOUT_TARGET="$TMP/timeout-target"
mkdir "$TIMEOUT_TARGET"
cat > "$TIMEOUT_TARGET/package.json" <<'JSON'
{"name":"timeout-fixture","private":true,"scripts":{"test":"node -e \"setTimeout(() => {}, 4000)\""}}
JSON
printf '{"lockfileVersion":3}\n' > "$TIMEOUT_TARGET/package-lock.json"
expect_status "verify run times out long declared command" 124 env LAZYBUDDY_VERIFY_TIMEOUT_SECONDS=1 bash "$LIFECYCLE" verify --target "$TIMEOUT_TARGET" --run test

PYTHON_TARGET="$TMP/python-target"
mkdir "$PYTHON_TARGET"
cat > "$PYTHON_TARGET/pyproject.toml" <<'TOML'
[tool.lazyseries.verification]
test = ["python3", "-c", "print('python-test-ok')"]
TOML
expect_status "verify dry-run discovers explicit Python command" 0 bash "$LIFECYCLE" verify --target "$PYTHON_TARGET" --dry-run
if grep -Fq 'COMMAND: python3 -c' "$TMP/verify dry-run discovers explicit Python command.out"; then
    pass "verify dry-run prints declared Python command"
else
    fail "verify dry-run prints declared Python command"
fi
expect_status "verify run executes explicit Python command" 0 bash "$LIFECYCLE" verify --target "$PYTHON_TARGET" --run test
if grep -q 'python-test-ok' "$TMP/verify run executes explicit Python command.out"; then
    pass "verify run executes declared Python command"
else
    fail "verify run executes declared Python command"
fi

MAKE_TARGET="$TMP/make-target"
mkdir "$MAKE_TARGET"
cat > "$MAKE_TARGET/Makefile" <<'MAKE'
test:
	@printf 'make-test-ok\\n'
MAKE
expect_status "verify dry-run discovers declared Make target" 0 bash "$LIFECYCLE" verify --target "$MAKE_TARGET" --dry-run
if grep -Fxq 'COMMAND: make test' "$TMP/verify dry-run discovers declared Make target.out"; then
    pass "verify dry-run prints declared Make target"
else
    fail "verify dry-run prints declared Make target"
fi
expect_status "verify run executes declared Make target" 0 bash "$LIFECYCLE" verify --target "$MAKE_TARGET" --run test
if grep -q 'make-test-ok' "$TMP/verify run executes declared Make target.out"; then
    pass "verify run executes declared Make target"
else
    fail "verify run executes declared Make target"
fi

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
