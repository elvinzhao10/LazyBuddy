#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIFECYCLE="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-tooling-lifecycle.XXXXXX")"
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
    find "$root" -mindepth 1 -print0 | sort -z | xargs -0 shasum > "$TMP/snapshot.txt"
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

expect_status "doctor rejects unavailable root" 1 bash "$LIFECYCLE" doctor --tooling-root "$MISSING_ROOT"
expect_status "detect reports empty provider registry" 0 bash "$LIFECYCLE" detect --tooling-root "$MISSING_ROOT"
if grep -q 'PROVIDERS: none configured' "$TMP/detect reports empty provider registry.out"; then
    pass "detect reports no premature providers"
else
    fail "detect reports no premature providers"
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

ROOT="$TMP/tooling-root"
mkdir "$ROOT"
expect_status "install into explicit empty root" 0 bash "$LIFECYCLE" install --tooling-root "$ROOT"
if [ -f "$ROOT/.lazybuddy-tooling-receipt.json" ] && [ -f "$ROOT/package-lock.json" ]; then
    pass "install writes receipt and locked manifest"
else
    fail "install writes receipt and locked manifest"
fi

snapshot "$ROOT"
cp "$TMP/snapshot.txt" "$TMP/before-read-only.txt"
expect_status "status ready root" 0 bash "$LIFECYCLE" status --tooling-root "$ROOT"
expect_status "detect ready root" 0 bash "$LIFECYCLE" detect --tooling-root "$ROOT"
expect_status "doctor ready root" 0 bash "$LIFECYCLE" doctor --tooling-root "$ROOT"
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
expect_status "fresh install for uninstall" 0 bash "$LIFECYCLE" install --tooling-root "$CLEAN_ROOT"
expect_status "receipt-owned uninstall" 0 bash "$LIFECYCLE" uninstall --tooling-root "$CLEAN_ROOT"
if [ ! -e "$CLEAN_ROOT" ]; then
    pass "receipt-owned root removed"
else
    fail "receipt-owned root removed"
fi

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
