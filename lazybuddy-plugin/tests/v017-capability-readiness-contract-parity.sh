#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: v017-capability-readiness-contract-parity.sh --lazytrae-root ABSOLUTE_ROOT --lazybuddy-root ABSOLUTE_ROOT

Validate and compare the v0.17 capability-readiness artifacts in caller-supplied
LazyTrae and LazyBuddy roots. This runner never infers a sibling checkout.
USAGE
}

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

LAZYTRAE_ROOT=""
LAZYBUDDY_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazytrae-root)
            [ "$#" -ge 2 ] || fail "--lazytrae-root requires a value"
            LAZYTRAE_ROOT="$2"
            shift 2
            ;;
        --lazybuddy-root)
            [ "$#" -ge 2 ] || fail "--lazybuddy-root requires a value"
            LAZYBUDDY_ROOT="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "unknown argument: $1"
            ;;
    esac
done

[ -n "$LAZYTRAE_ROOT" ] || { usage >&2; fail "--lazytrae-root is required"; }
[ -n "$LAZYBUDDY_ROOT" ] || { usage >&2; fail "--lazybuddy-root is required"; }
[ -d "$LAZYTRAE_ROOT" ] || fail "missing LazyTrae root: $LAZYTRAE_ROOT"
[ -d "$LAZYBUDDY_ROOT" ] || fail "missing LazyBuddy root: $LAZYBUDDY_ROOT"

LAZYTRAE_ROOT="$(cd "$LAZYTRAE_ROOT" && pwd -P)"
LAZYBUDDY_ROOT="$(cd "$LAZYBUDDY_ROOT" && pwd -P)"
TRAE_CLI="$LAZYTRAE_ROOT/lazytrae-plugin/packages/cli"
BUDDY_PLUGIN="$LAZYBUDDY_ROOT/lazybuddy-plugin"
TRAE_CONTRACT="$TRAE_CLI/contracts/lazyseries-capability-readiness.v1.json"
BUDDY_CONTRACT="$BUDDY_PLUGIN/contracts/lazyseries-capability-readiness.v1.json"
TRAE_FIXTURE="$TRAE_CLI/contracts/fixtures/v017/readiness-records.json"
BUDDY_FIXTURE="$BUDDY_PLUGIN/contracts/fixtures/v017/readiness-records.json"

[ -f "$TRAE_CLI/package.json" ] || fail "misconfigured LazyTrae root: missing lazytrae-plugin/packages/cli/package.json"
[ -f "$BUDDY_PLUGIN/tests/v017-capability-readiness-contract-regression.sh" ] || fail "misconfigured LazyBuddy root: missing readiness regression check"
for file in "$TRAE_CONTRACT" "$TRAE_CONTRACT.sha256" "$TRAE_FIXTURE" "$BUDDY_CONTRACT" "$BUDDY_CONTRACT.sha256" "$BUDDY_FIXTURE"; do
    [ -f "$file" ] || fail "missing readiness artifact: $file"
done

(cd "$TRAE_CLI" && node --test test/capability-readiness-contract.test.js)
(cd "$BUDDY_PLUGIN" && bash tests/v017-capability-readiness-contract-regression.sh)
cmp -s "$TRAE_CONTRACT" "$BUDDY_CONTRACT" || fail "readiness contract bytes differ"
cmp -s "$TRAE_CONTRACT.sha256" "$BUDDY_CONTRACT.sha256" || fail "readiness contract digest sidecars differ"
cmp -s "$TRAE_FIXTURE" "$BUDDY_FIXTURE" || fail "readiness fixture bytes differ"

printf 'PASS: explicit-root v0.17 capability readiness contract parity\n'
