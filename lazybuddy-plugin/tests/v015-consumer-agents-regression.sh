#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$PLUGIN_ROOT/scripts/ensure-consumer-agents.sh"
TEMPLATE="$PLUGIN_ROOT/templates/AGENTS.md"
SESSION_START="$PLUGIN_ROOT/scripts/hooks/session-start.sh"
TMP="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

expect_rejected() {
    local label="$1"
    shift
    if "$@" >"$TMP/output" 2>&1; then
        fail "$label was accepted"
    fi
    grep -q 'must not be.*symlink\|must be.*regular\|must be set\|unavailable' "$TMP/output" || fail "$label did not report a boundary rejection"
}

test -x "$HELPER" || fail "consumer AGENTS helper is missing: $HELPER"
test -f "$TEMPLATE" || fail "consumer AGENTS template is missing"

grep -qi 'explicit user instructions' "$TEMPLATE" || fail 'template does not prioritize user instructions'
grep -q 'root.*workbuddy.md\|workbuddy.md.*root' "$TEMPLATE" || fail 'template does not direct consumers to root workbuddy.md'
grep -q 'child.*workbuddy.md\|workbuddy.md.*child' "$TEMPLATE" || fail 'template does not direct consumers to child workbuddy.md'

mkdir -p "$TMP/absent"
env CWD="$TMP/absent" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HELPER" >"$TMP/absent-output"
test -f "$TMP/absent/AGENTS.md" || fail 'helper did not create an absent AGENTS.md'
test ! -L "$TMP/absent/AGENTS.md" || fail 'helper created a symlinked AGENTS.md'
cmp "$TEMPLATE" "$TMP/absent/AGENTS.md" || fail 'created AGENTS.md differs from the consumer template'
grep -q 'AGENTS_STATUS=created' "$TMP/absent-output" || fail 'helper did not report created status'

mkdir -p "$TMP/existing"
printf 'consumer-owned instructions\nsecond line\n' > "$TMP/existing/AGENTS.md"
cp "$TMP/existing/AGENTS.md" "$TMP/existing-before"
env CWD="$TMP/existing" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HELPER" >"$TMP/existing-output"
cmp "$TMP/existing-before" "$TMP/existing/AGENTS.md" || fail 'helper changed an existing AGENTS.md'
grep -q 'AGENTS_STATUS=preserved' "$TMP/existing-output" || fail 'helper did not report preserved status'

mkdir -p "$TMP/destination-link"
printf 'outside consumer instructions\n' > "$TMP/outside-agents"
cp "$TMP/outside-agents" "$TMP/outside-agents-before"
ln -s "$TMP/outside-agents" "$TMP/destination-link/AGENTS.md"
expect_rejected 'symlinked AGENTS.md destination' env CWD="$TMP/destination-link" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HELPER"
cmp "$TMP/outside-agents-before" "$TMP/outside-agents" || fail 'symlinked destination altered outside data'

mkdir -p "$TMP/real-root"
ln -s "$TMP/real-root" "$TMP/root-link"
expect_rejected 'symlinked project root' env CWD="$TMP/root-link" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HELPER"
test ! -e "$TMP/real-root/AGENTS.md" || fail 'symlinked project root received an AGENTS.md'

mkdir -p "$TMP/session"
printf 'session-owned instructions\n' > "$TMP/session/AGENTS.md"
cp "$TMP/session/AGENTS.md" "$TMP/session-before"
printf '{"cwd":"%s"}\n' "$TMP/session" | CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SESSION_START" >"$TMP/session-output"
cmp "$TMP/session-before" "$TMP/session/AGENTS.md" || fail 'SessionStart changed AGENTS.md'

expect_rejected 'missing CWD' env -u CWD CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$HELPER"
expect_rejected 'missing plugin root' env -u CODEBUDDY_PLUGIN_ROOT CWD="$TMP/absent" bash "$HELPER"
expect_rejected 'empty plugin root' env CWD="$TMP/absent" CODEBUDDY_PLUGIN_ROOT='' bash "$HELPER"

echo 'PASS: consumer AGENTS regression'
