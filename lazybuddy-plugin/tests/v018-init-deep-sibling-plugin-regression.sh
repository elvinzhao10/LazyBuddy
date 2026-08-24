#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(CDPATH= cd -P -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SKILL="$PLUGIN_ROOT/skills/lazy-init-deep/SKILL.md"
COMMAND="$PLUGIN_ROOT/commands/lazy-init-deep.md"
HELPER="$PLUGIN_ROOT/scripts/ensure-consumer-agents.sh"
TMP="$(CDPATH= cd -P -- "$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-init-deep-sibling.XXXXXX")" && pwd -P)"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_documented_contract() {
    local document="$1"
    grep -Fq 'CODEBUDDY_PLUGIN_ROOT="/absolute/path/to/lazybuddy-plugin"' "$document" || fail "$(basename "$document") lacks the absolute sibling-plugin invocation"
    grep -Fq 'PACKAGE_READINESS=full' "$document" || fail "$(basename "$document") lacks the expected full readiness result"
    grep -Fqi 'does not search parents, siblings, marketplaces, or the filesystem' "$document" || fail "$(basename "$document") permits discovery beyond documented local layouts"
}

documented_load_check() {
    local plugin_root="${CODEBUDDY_PLUGIN_ROOT:-}"
    if [ -z "$plugin_root" ] && [ -f "$PWD/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" ]; then
        plugin_root="$PWD/lazybuddy-plugin"
    elif [ -z "$plugin_root" ] && [ -f "$PWD/scripts/lazybuddy-load-check.sh" ]; then
        plugin_root="$PWD"
    fi
    if [ -z "$plugin_root" ]; then
        echo 'LazyBuddy plugin root is unavailable; reopen the copied repository or install the plugin.' >&2
        return 1
    fi
    bash "$plugin_root/scripts/lazybuddy-load-check.sh"
}

assert_documented_contract "$SKILL"
assert_documented_contract "$COMMAND"

WORKSPACE="$TMP/unrelated-workspace"
SIBLING_PARENT="$TMP/sibling-checkout"
SIBLING_PLUGIN="$SIBLING_PARENT/lazybuddy-plugin"
MARKER="$TMP/poisoned-sentinel-ran"
mkdir -p "$WORKSPACE" "$SIBLING_PARENT" "$TMP/scripts" "$SIBLING_PARENT/scripts"
cp -R "$PLUGIN_ROOT" "$SIBLING_PLUGIN"
find "$SIBLING_PLUGIN" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$SIBLING_PLUGIN" -type f -name '*.pyc' -delete
mkdir -p "$SIBLING_PARENT/.codebuddy-plugin"
cp "$PLUGIN_ROOT/../.codebuddy-plugin/marketplace.json" "$SIBLING_PARENT/.codebuddy-plugin/marketplace.json"

for poison in "$TMP/scripts/lazybuddy-load-check.sh" "$SIBLING_PARENT/scripts/lazybuddy-load-check.sh"; do
    cat > "$poison" <<EOF
#!/usr/bin/env bash
printf 'poisoned sentinel executed\n' >> "$MARKER"
exit 99
EOF
    chmod +x "$poison"
done

(
    cd "$WORKSPACE"
    CWD="$WORKSPACE" CODEBUDDY_PLUGIN_ROOT="$SIBLING_PLUGIN" bash "$SIBLING_PLUGIN/scripts/lazybuddy-load-check.sh"
) > "$TMP/explicit-override.out" 2>&1 || fail 'explicit absolute sibling-plugin load check failed'
grep -Fxq 'PACKAGE_READINESS=full' "$TMP/explicit-override.out" || fail 'explicit absolute sibling-plugin load check was not full'
[ ! -e "$MARKER" ] || fail 'explicit override executed a poisoned parent or sibling sentinel'

for relative_root in 'lazybuddy-plugin' '../sibling-checkout/lazybuddy-plugin'; do
    if (
        cd "$SIBLING_PARENT"
        CODEBUDDY_PLUGIN_ROOT="$relative_root" bash "$SIBLING_PLUGIN/scripts/lazybuddy-load-check.sh"
    ) > "$TMP/relative-root.out" 2>&1; then
        fail "relative explicit plugin root was accepted: $relative_root"
    fi
    [ "$(cat "$TMP/relative-root.out")" = 'CODEBUDDY_PLUGIN_ROOT must be an absolute path' ] || fail "relative explicit plugin root was resolved before rejection: $relative_root"
    [ ! -e "$MARKER" ] || fail "relative explicit plugin root executed a poisoned parent or sibling sentinel: $relative_root"
done

if (
    cd "$WORKSPACE"
    env -u CODEBUDDY_PLUGIN_ROOT bash -c "$(declare -f documented_load_check); documented_load_check"
) > "$TMP/no-override.out" 2>&1; then
    fail 'unrelated workspace unexpectedly resolved a plugin root without an override'
fi
grep -Fq 'LazyBuddy plugin root is unavailable' "$TMP/no-override.out" || fail 'no-override result lacked unavailable-root diagnostic'
[ ! -e "$MARKER" ] || fail 'no-override resolution executed a poisoned parent or sibling sentinel'

ln -s "$SIBLING_PLUGIN" "$TMP/symlinked-plugin-root"
if CODEBUDDY_PLUGIN_ROOT="$TMP/symlinked-plugin-root" bash "$SIBLING_PLUGIN/scripts/lazybuddy-load-check.sh" > "$TMP/symlink-load-check.out" 2>&1; then
    fail 'symlinked explicit plugin root was accepted by the load check'
fi
[ "$(cat "$TMP/symlink-load-check.out")" = 'CODEBUDDY_PLUGIN_ROOT path must not be symlinked' ] || fail 'symlinked explicit plugin root was resolved before rejection by the load check'
if CWD="$WORKSPACE" CODEBUDDY_PLUGIN_ROOT="$TMP/symlinked-plugin-root" bash "$HELPER" > "$TMP/symlink-root.out" 2>&1; then
    fail 'symlinked explicit plugin root was accepted by consumer helper'
fi
grep -Eqi 'CODEBUDDY_PLUGIN_ROOT path must not be symlinked|CODEBUDDY_PLUGIN_ROOT must not be a symlink' "$TMP/symlink-root.out" || fail 'symlinked explicit plugin root lacked safe rejection'
test ! -e "$WORKSPACE/AGENTS.md" || fail 'symlinked explicit plugin root wrote a consumer AGENTS.md'

echo 'PASS: InitDeep sibling-plugin onboarding regression'
