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
# is checked, then the retained evidence remains package-local.
for document in "$REPOSITORY_ROOT/lazybuddy-evaluation.md"; do
    assert_documentation_contract "$document"
done
test ! -e "$REPOSITORY_ROOT/docs" || fail 'repository-root docs/ must remain absent'
grep -Fq 'six local MCP servers' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain the six-server inventory'
grep -Fq 'manual host' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain manual host verification'
grep -Fq 'package readiness' "$PLUGIN_ROOT/README.md" || fail 'package README must distinguish package readiness'
grep -Fq 'this repository does not endorse a mutable marketplace URL' "$PLUGIN_ROOT/README.md" || fail 'package README must require immutable marketplace discovery'
grep -Fq 'retained root guidance' "$PLUGIN_ROOT/commands/lazy-librarian.md" || fail 'librarian command must name retained root guidance'
if grep -Fq 'docs/handoff.md' "$PLUGIN_ROOT/commands/lazy-librarian.md"; then
    fail 'librarian command must not direct users to deleted root docs'
fi
grep -Fq 'package README and `docs/verification-matrix.md` inventory' "$PLUGIN_ROOT/workbuddy.md" || fail 'package maintainer guide must name package-owned MCP inventory documentation'
if grep -Fq 'root README, handoff' "$PLUGIN_ROOT/workbuddy.md"; then
    fail 'package maintainer guide must not direct MCP changes to deleted root handoff documentation'
fi
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
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md" \
    "$PLUGIN_ROOT/README.md"; do
    grep -Fq 'LazyBuddy v0.17.0 is the current package baseline.' "$document" || fail "$(basename "$document") must retain the v0.17.0 package baseline"
    grep -Fq "$version_namespace_statement" "$document" || fail "$(basename "$document") must distinguish the v0.17.0 readiness contract from a package release"
done
grep -Fqx '![LazyBuddy](lazybuddy-banner.jpg)' "$REPOSITORY_ROOT/README.md" || fail 'README must embed the public LazyBuddy banner'
grep -Fqx '## `offboard` protocol' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must provide an explicit offboard protocol'
if grep -Eqi 'alignment candidate|no longer maintained|practice project' \
    "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md"; then
    fail 'public documentation must not use legacy candidate or practice-project framing'
fi
if grep -Eq '\]\((\./|\.\./)*docs/' \
    "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md" "$REPOSITORY_ROOT/workbuddy.md"; then
    fail 'active documentation must not link to removed repository-root docs/'
fi
if grep -Eq '\]\((\./)*\.\./docs/' "$PLUGIN_ROOT/README.md"; then
    fail 'package README must not link to removed repository-root docs/'
fi
pass 'current documentation satisfies the v0.17 release baseline'

# Given copied documentation, when a required heading is removed, then the same
# contract fails instead of accepting incomplete release documentation.
COPIED_EVALUATION="$TMP/lazybuddy-evaluation.md"
cp "$REPOSITORY_ROOT/lazybuddy-evaluation.md" "$COPIED_EVALUATION"
python3 - "$COPIED_EVALUATION" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(path.read_text(encoding='utf-8').replace('## JSON-RPC resilience\n', '', 1), encoding='utf-8')
PY
if check_documentation_contract "$COPIED_EVALUATION" > "$TMP/missing-heading.out" 2>&1; then
    fail 'copied documentation with a missing heading was accepted'
fi
grep -Fq 'JSON-RPC resilience' "$TMP/missing-heading.out" || fail 'missing-heading failure did not identify the removed heading'
pass 'copied documentation with a missing heading is rejected'

# Given a copied root guide, when a stale root-doc link is restored, then the
# root-doc absence policy rejects it.
COPIED_ROOT_GUIDE="$TMP/README.md"
cp "$REPOSITORY_ROOT/README.md" "$COPIED_ROOT_GUIDE"
for stale_link in 'docs/handoff.md' './docs/handoff.md'; do
    printf '\n[stale handoff](%s)\n' "$stale_link" > "$COPIED_ROOT_GUIDE"
    if ! grep -Eq '\]\((\./|\.\./)*docs/' "$COPIED_ROOT_GUIDE"; then
        fail "stale root-doc link fixture was not detected: $stale_link"
    fi
done
pass 'copied documentation with a stale root-doc link is rejected'
