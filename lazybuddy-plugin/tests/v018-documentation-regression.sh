#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REPOSITORY_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-documentation-regression.XXXXXX")"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

required_headings=(
    'Public capability status contract'
    'Optional capability policy'
    'Receipt and safe removal'
    'Package readiness versus host verification'
    'JSON-RPC resilience'
    'Host-specific exclusions'
    'Known unverified host behavior'
    'macOS verification scope'
)

check_documentation_contract() {
    local document="$1" heading
    for heading in "${required_headings[@]}"; do
        grep -Fqx "## $heading" "$document" || { printf 'FAIL: %s is missing %s\n' "$(basename "$document")" "$heading" >&2; return 1; }
    done
    grep -Fq 'macOS only' "$document" || { printf 'FAIL: %s must retain macOS-only scope\n' "$(basename "$document")" >&2; return 1; }
    grep -Fq 'Host integration' "$document" || { printf 'FAIL: %s must name host-integration differences\n' "$(basename "$document")" >&2; return 1; }
    grep -Fq 'State/path' "$document" || { printf 'FAIL: %s must name state/path differences\n' "$(basename "$document")" >&2; return 1; }
    grep -Fq 'Inventory' "$document" || { printf 'FAIL: %s must name inventory differences\n' "$(basename "$document")" >&2; return 1; }
    grep -Eqi 'normal CI.*does not require.*sibling' "$document" || { printf 'FAIL: %s must keep normal CI self-contained\n' "$(basename "$document")" >&2; return 1; }
    grep -Eqi 'release-only paired parity' "$document" || { printf 'FAIL: %s must limit paired parity to release evidence\n' "$(basename "$document")" >&2; return 1; }
}

assert_documentation_contract() {
    check_documentation_contract "$1" || fail "documentation contract failed for $(basename "$1")"
}

# Given the current Buddy documentation, when the v0.17 documentation contract
# is checked, then every shared heading and policy remains package-local.
for document in "$REPOSITORY_ROOT/lazybuddy-evaluation.md" "$REPOSITORY_ROOT/docs/handoff.md"; do
    assert_documentation_contract "$document"
done
# v0.18: docs/ may contain additional topic docs alongside handoff.md
grep -Fqx 'handoff.md' <(find "$REPOSITORY_ROOT/docs" -mindepth 1 -maxdepth 1 -print | sed 's#.*/##' | sort) || fail 'root docs must contain handoff.md'
grep -Fq 'docs/handoff.md' "$REPOSITORY_ROOT/README.md" || fail 'README must link the root documentation handoff'
grep -Fq 'docs/handoff.md' "$REPOSITORY_ROOT/AGENTS.md" || fail 'AGENTS must link the root documentation handoff'
grep -Fq 'six local MCP servers' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain the six-server inventory'
grep -Fq 'manual host' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain manual host verification'
grep -Fq 'package readiness' "$PLUGIN_ROOT/README.md" || fail 'package README must distinguish package readiness'
grep -Fq 'this repository does not endorse a mutable marketplace URL' "$PLUGIN_ROOT/README.md" || fail 'package README must require immutable marketplace discovery'
grep -Fq 'before running the host-generated install command' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must require immutable marketplace discovery'
if grep -Eq 'codebuddy plugin marketplace add[[:space:]]+https://github\.com/' \
    "$PLUGIN_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md"; then
    fail 'marketplace guidance must not provide a mutable GitHub marketplace command'
fi
grep -Fq 'package readiness' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must distinguish package readiness'
version_namespace_statement='Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.'
for document in \
    "$REPOSITORY_ROOT/README.md" \
    "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/docs/handoff.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md" \
    "$PLUGIN_ROOT/README.md"; do
    grep -Fq 'LazyBuddy v0.16.0-alpha.1 is the current package baseline.' "$document" || fail "$(basename "$document") must retain the v0.16.0-alpha.1 package baseline"
    grep -Fq "$version_namespace_statement" "$document" || fail "$(basename "$document") must distinguish the v0.17.0 readiness contract from a package release"
done
grep -Fqx '![LazyBuddy](lazybuddy-banner.jpg)' "$REPOSITORY_ROOT/README.md" || fail 'README must embed the public LazyBuddy banner'
grep -Fqx '## `offboard` protocol' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must provide an explicit offboard protocol'
grep -Fqx '## Reading order' "$REPOSITORY_ROOT/docs/handoff.md" || fail 'handoff must provide a public learning reading order'
if grep -Eqi 'alignment candidate|no longer maintained|practice project' \
    "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/docs/handoff.md" "$REPOSITORY_ROOT/lazybuddy-evaluation.md"; then
    fail 'public documentation must not use legacy candidate or practice-project framing'
fi
pass 'current documentation satisfies the v0.18 contract'

# Given a copied handoff, when a required heading is removed, then the same
# contract fails instead of accepting incomplete release documentation.
COPIED_HANDOFF="$TMP/handoff.md"
cp "$REPOSITORY_ROOT/docs/handoff.md" "$COPIED_HANDOFF"
python3 - "$COPIED_HANDOFF" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text(encoding='utf-8').replace('## JSON-RPC resilience\n', '', 1), encoding='utf-8')
PY
if check_documentation_contract "$COPIED_HANDOFF" > "$TMP/missing-heading.out" 2>&1; then
    fail 'copied documentation with a missing heading was accepted'
fi
grep -Fq 'JSON-RPC resilience' "$TMP/missing-heading.out" || fail 'missing-heading failure did not identify the removed heading'
pass 'copied documentation with a missing heading is rejected'
