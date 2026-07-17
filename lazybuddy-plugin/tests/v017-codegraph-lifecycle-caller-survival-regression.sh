#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LIFECYCLE_TEST="$PLUGIN_ROOT/tests/v016-codegraph-regression.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-codegraph-caller.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if output="$(bash -c 'bash "$1" && printf "AFTER CODEGRAPH LIFECYCLE\\n"' bash "$LIFECYCLE_TEST" 2>&1)"; then
    status=0
else
    status=$?
fi
printf '%s\n' "$output" > "$TMP/output"
[ "$status" -eq 0 ] || {
    printf 'FAIL CodeGraph lifecycle terminated its direct caller (exit %s): %s\n' "$status" "$output" >&2
    exit 1
}
grep -Fxq 'PASS CodeGraph lifecycle, MCP, and ownership boundaries' "$TMP/output" || {
    printf 'FAIL CodeGraph lifecycle did not reach its final PASS marker\n' >&2
    exit 1
}
grep -Fxq 'AFTER CODEGRAPH LIFECYCLE' "$TMP/output" || {
    printf 'FAIL CodeGraph lifecycle did not return control to its direct caller\n' >&2
    exit 1
}
printf 'PASS CodeGraph lifecycle preserves its direct caller\n'
