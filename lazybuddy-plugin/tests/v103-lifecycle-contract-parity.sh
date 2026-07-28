#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: v103-lifecycle-contract-parity.sh --lazytrae-root ABSOLUTE_ROOT --lazybuddy-root ABSOLUTE_ROOT

Validate and compare the lifecycle v1 contract family from two explicit repository roots.
USAGE
}

fail() {
    echo "FAIL: $1" >&2
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
TRAE_CONTRACTS="$TRAE_CLI/contracts"
BUDDY_CONTRACTS="$BUDDY_PLUGIN/contracts"

[ -f "$TRAE_CLI/package.json" ] || fail "misconfigured LazyTrae root"
[ -f "$BUDDY_PLUGIN/tests/lifecycle-contract.test.js" ] || fail "misconfigured LazyBuddy root"
[ -d "$TRAE_CLI/node_modules/ajv" ] || fail "LazyTrae contract dependencies are not installed"

(cd "$TRAE_CLI" && node --test test/lifecycle-contract.test.js)
NODE_PATH="$TRAE_CLI/node_modules" node --test "$BUDDY_PLUGIN/tests/lifecycle-contract.test.js"

for artifact in \
    lazy-harness-lifecycle.v1.schema.json \
    lazy-harness-lifecycle.v1.schema.json.sha256 \
    lazy-harness-lifecycle.v1.example.json \
    lazy-harness-lifecycle.v1.example.json.sha256
do
    cmp -s "$TRAE_CONTRACTS/$artifact" "$BUDDY_CONTRACTS/$artifact" ||
        fail "mirrored lifecycle artifact differs: $artifact"
done

diff -ru "$TRAE_CONTRACTS/fixtures/lifecycle-v1" \
    "$BUDDY_CONTRACTS/fixtures/lifecycle-v1" >/dev/null ||
    fail "mirrored lifecycle fixtures differ"

echo "PASS: explicit-root lifecycle v1 contract parity"
