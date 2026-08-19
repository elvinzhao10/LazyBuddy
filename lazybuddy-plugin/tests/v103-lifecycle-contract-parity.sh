#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: v103-lifecycle-contract-parity.sh --lazytrae-root ABSOLUTE_ROOT --lazybuddy-root ABSOLUTE_ROOT

Compatibility entry point for the current bounded explicit-root parity gate.
This is package evidence only. It does not inspect or claim host readiness.
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
exec bash "$(cd "$(dirname "$0")" && pwd -P)/v110-six-host-contract-parity.sh" \
    --lazytrae-root "$LAZYTRAE_ROOT" --lazybuddy-root "$LAZYBUDDY_ROOT"
