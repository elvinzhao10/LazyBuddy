#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph-fixture-cleanup.XXXXXX")"
CONCURRENT_SIBLING_FIXTURE=""

cleanup() {
    [ "${LAZYBUDDY_KEEP_TEST_FIXTURES:-}" = 1 ] && {
        printf 'KEEP fixture: %s\n' "$TMP" >&2
        return
    }
    [ -z "$CONCURRENT_SIBLING_FIXTURE" ] || rm -rf "$CONCURRENT_SIBLING_FIXTURE"
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

snapshot() {
    local root="$1" prefix="$2" output="$3"
    find "$root" -maxdepth 1 -type d -name "${prefix}*" -print 2>/dev/null | sort > "$output"
}

after_only_roots() {
    local before="$1" after="$2" output="$3"
    comm -13 "$before" "$after" > "$output"
}

fixture_cleanup_status() {
    local label="$1" before="$2" after="$3" leftovers="$4"
    after_only_roots "$before" "$after" "$leftovers"
    if [ -s "$leftovers" ]; then
        printf '%s left a fixture outside its invocation-owned root:\n' "$label" >&2
        cat "$leftovers" >&2
        return 1
    fi
}

check_fixture_cleanup() {
    local prefix="$1" test_path="$2" label="$3"
    local namespace="$TMP/${label// /-}.fixtures"
    local before="$TMP/$label.before" after="$TMP/$label.after" output="$TMP/$label.output" leftovers="$TMP/$label.leftovers"
    mkdir "$namespace"
    snapshot "$namespace" "$prefix" "$before"
    if ! TMPDIR="$namespace" bash "$test_path" >"$output" 2>&1; then
        cat "$output" >&2
        fail "$label regression failed"
    fi
    snapshot "$namespace" "$prefix" "$after"
    fixture_cleanup_status "$label" "$before" "$after" "$leftovers" || fail "$label fixture cleanup check failed"
    printf 'PASS: %s cleans its owned fixture prefix\n' "$label"
}

before_only="$TMP/before-only"
before_and_after="$TMP/before-and-after"
after_only="$TMP/after-only"
printf '%s\n%s\n' "$before_and_after" "$before_only" > "$TMP/stale.before"
printf '%s\n' "$before_and_after" > "$TMP/stale.after"
if ! fixture_cleanup_status 'stale pre-existing fixture' "$TMP/stale.before" "$TMP/stale.after" "$TMP/stale.leftovers"; then
    fail 'a pre-existing fixture disappearing was reported as a leak'
fi
[ ! -s "$TMP/stale.leftovers" ] || fail 'a pre-existing fixture disappearance produced leftovers'
printf 'PASS: pre-existing fixture disappearance is not a leak\n'

printf '%s\n' "$before_and_after" > "$TMP/leak.before"
printf '%s\n%s\n' "$before_and_after" "$after_only" > "$TMP/leak.after"
if LEAK_OUTPUT="$(fixture_cleanup_status 'after-only fixture' "$TMP/leak.before" "$TMP/leak.after" "$TMP/leak.leftovers" 2>&1)"; then
    fail 'an after-only fixture was not reported as a leak'
fi
grep -Fqx "$after_only" "$TMP/leak.leftovers" || fail 'after-only fixture leak was not named'
grep -Fq 'after-only fixture left a fixture outside its invocation-owned root:' <<<"$LEAK_OUTPUT" \
    || fail 'after-only fixture leak did not retain the named failure'
grep -Fqx "$after_only" <<<"$LEAK_OUTPUT" || fail 'after-only fixture path was omitted from failure output'
printf 'PASS: after-only fixture remains a named leak\n'

CONCURRENT_SIBLING_FIXTURE="${TMPDIR:-/tmp}/lazybuddy-codegraph-install-timeout.concurrent-sibling.$$"
cat > "$TMP/create-concurrent-sibling.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mkdir "$LAZYBUDDY_CONCURRENT_SIBLING_FIXTURE"
SH
chmod +x "$TMP/create-concurrent-sibling.sh"
export LAZYBUDDY_CONCURRENT_SIBLING_FIXTURE="$CONCURRENT_SIBLING_FIXTURE"
check_fixture_cleanup 'lazybuddy-codegraph-install-timeout.' "$TMP/create-concurrent-sibling.sh" 'concurrent sibling isolation'
unset LAZYBUDDY_CONCURRENT_SIBLING_FIXTURE
rm -rf "$CONCURRENT_SIBLING_FIXTURE"
CONCURRENT_SIBLING_FIXTURE=""

check_fixture_cleanup 'lazybuddy-codegraph.' "$PLUGIN_ROOT/tests/v016-codegraph-regression.sh" 'CodeGraph lifecycle'
check_fixture_cleanup 'lazybuddy-codegraph-install-timeout.' "$PLUGIN_ROOT/tests/v017-codegraph-install-timeout-regression.sh" 'CodeGraph install timeout'
check_fixture_cleanup 'lazybuddy-codegraph-pid-identity.' "$PLUGIN_ROOT/tests/v017-codegraph-uninstall-pid-identity-regression.sh" 'CodeGraph PID identity'

printf 'PASS: CodeGraph fixture cleanup inventory is unchanged\n'
