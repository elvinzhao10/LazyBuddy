#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

LAZYTRAE_ROOT=""
LAZYBUDDY_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazytrae-root) LAZYTRAE_ROOT="$2"; shift 2 ;;
        --lazybuddy-root) LAZYBUDDY_ROOT="$2"; shift 2 ;;
        *) fail "unknown argument: $1" ;;
    esac
done

[ -d "$LAZYTRAE_ROOT" ] || fail "missing LazyTrae root: $LAZYTRAE_ROOT"
[ -d "$LAZYBUDDY_ROOT" ] || fail "missing LazyBuddy root: $LAZYBUDDY_ROOT"
TRAE_CLI="$(cd "$LAZYTRAE_ROOT/lazytrae-plugin/packages/cli" && pwd -P)"
BUDDY_PLUGIN="$(cd "$LAZYBUDDY_ROOT/lazybuddy-plugin" && pwd -P)"
TRAE_CONTRACT="$TRAE_CLI/contracts/lazyseries-capability-readiness.v2.json"
BUDDY_CONTRACT="$BUDDY_PLUGIN/contracts/lazyseries-capability-readiness.v2.json"

(cd "$TRAE_CLI" && node --test test/capability-readiness-v2.test.js)
(cd "$BUDDY_PLUGIN" && bash tests/v2-capability-readiness-contract-regression.sh)
cmp -s "$TRAE_CONTRACT" "$BUDDY_CONTRACT" || fail "v2 readiness contract bytes differ"
cmp -s "$TRAE_CONTRACT.sha256" "$BUDDY_CONTRACT.sha256" || fail "v2 readiness checksums differ"
cmp -s "$TRAE_CLI/contracts/fixtures/readiness-v2/sha256sums.txt" "$BUDDY_PLUGIN/contracts/fixtures/readiness-v2/sha256sums.txt" \
    || fail "v2 readiness fixture checksums differ"
for name in valid-package.json missing-evidence.json forged-current-session.json unknown-version.json unknown-field.json prompt-injection.json; do
    cmp -s "$TRAE_CLI/contracts/fixtures/readiness-v2/$name" "$BUDDY_PLUGIN/contracts/fixtures/readiness-v2/$name" \
        || fail "v2 readiness fixture bytes differ: $name"
done

printf 'PASS: explicit-root v2 capability readiness contract parity\n'
