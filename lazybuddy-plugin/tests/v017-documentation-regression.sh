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

required_root_docs=(
    'docs/README.md'
    'docs/00-learning-path.md'
    'docs/01-mental-model.md'
    'docs/02-first-task.md'
    'docs/03-install-and-host-verification.md'
    'docs/04-workflow-playbooks.md'
    'docs/05-evidence-and-completion.md'
    'docs/06-capabilities-and-approvals.md'
    'docs/06a-security-and-authority.md'
    'docs/06b-receipts-and-owned-tooling.md'
    'docs/07-package-map.md'
    'docs/07a-state-and-validation.md'
    'docs/07b-mcp-lifecycle.md'
    'docs/08-safe-removal.md'
    'docs/09-test-and-release-verification.md'
    'docs/10-host-capability-matrix.md'
    'docs/reference/host-routes.md'
    'docs/reference/state-artifact-reference.md'
    'docs/reference/mcp-inventory.md'
    'docs/reference/verification-contract.md'
    'docs/reference/terminology.md'
)

required_learner_headings=(
    'docs/06a-security-and-authority.md|# Security and authority'
    'docs/06b-receipts-and-owned-tooling.md|# Receipts and owned tooling'
    'docs/07a-state-and-validation.md|# State and validation'
    'docs/07b-mcp-lifecycle.md|# MCP lifecycle'
    'docs/09-test-and-release-verification.md|# Test and release verification'
    'docs/10-host-capability-matrix.md|# Host capability matrix'
    'docs/reference/state-artifact-reference.md|# State artifact reference'
    'docs/reference/mcp-inventory.md|# MCP inventory'
)

check_root_docs_contract() {
    local relative_path heading_contract heading
    for relative_path in "${required_root_docs[@]}"; do
        [ -f "$REPOSITORY_ROOT/$relative_path" ] || fail "required root doc is missing: $relative_path"
    done
    for heading_contract in "${required_learner_headings[@]}"; do
        relative_path="${heading_contract%%|*}"
        heading="${heading_contract#*|}"
        grep -Fqx "$heading" "$REPOSITORY_ROOT/$relative_path" || fail "required learner heading is missing: $relative_path :: $heading"
    done
    grep -Fq 'The explicit override selects that plugin root directly' \
        "$REPOSITORY_ROOT/docs/06a-security-and-authority.md" || fail 'security authority page must distinguish root selection from metadata validation'
    grep -Fq 'marketplace entry' \
        "$REPOSITORY_ROOT/docs/06a-security-and-authority.md" || fail 'security authority page must disclose parent marketplace metadata validation'

    python3 - "$REPOSITORY_ROOT" <<'PY'
import pathlib
import re
import sys

repository_root = pathlib.Path(sys.argv[1]).resolve()
docs_root = repository_root / "docs"
link_pattern = re.compile(r"\[[^\]]*\]\(([^)]*)\)")

for source in sorted(docs_root.rglob("*.md")):
    for target in link_pattern.findall(source.read_text(encoding="utf-8")):
        target = target.strip()
        if not target:
            raise SystemExit(f"FAIL: root documentation link target is empty: {source.relative_to(repository_root)}")
        if target.startswith("#") or re.match(r"(?:https?://|mailto:)", target):
            continue
        target_path = target.split("#", 1)[0]
        resolved = (source.parent / target_path).resolve()
        try:
            relative_target = resolved.relative_to(repository_root).as_posix()
        except ValueError:
            raise SystemExit(f"FAIL: root documentation link escapes repository: {source.relative_to(repository_root)} -> {target}")
        if relative_target == "docs/handoff.md":
            raise SystemExit(f"FAIL: root documentation must not link to docs/handoff.md ({source.relative_to(repository_root)})")
        if not resolved.is_file():
            raise SystemExit(f"FAIL: root documentation link target is missing: {source.relative_to(repository_root)} -> {target}")
PY
}

# Given an empty Markdown link destination, when the root-doc link resolver is
# exercised, then it rejects that destination rather than silently skipping it.
if python3 - <<'PY'
import re

link_pattern = re.compile(r"\[[^\]]*\]\(([^)]*)\)")

try:
    for target in link_pattern.findall("[empty]()"):
        target = target.strip()
        if not target:
            raise ValueError("root documentation link target is empty")
except ValueError as error:
    if str(error) != "root documentation link target is empty":
        raise SystemExit(f"unexpected empty-link rejection: {error}")
else:
    raise SystemExit("empty Markdown link destination was accepted")
PY
then
    pass 'empty Markdown link destinations are rejected'
else
    fail 'empty Markdown link destination rejection regressed'
fi

if [ ! -f "$REPOSITORY_ROOT/lazybuddy-evaluation.md" ]; then
    grep -Fq 'six local MCP servers' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain the six-server inventory'
    grep -Fq 'manual host' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain manual host verification'
    grep -Fq 'package readiness' "$PLUGIN_ROOT/README.md" || fail 'package README must distinguish package readiness'
    grep -Fq 'this repository does not endorse a mutable marketplace URL' "$PLUGIN_ROOT/README.md" || fail 'package README must require immutable marketplace discovery'
    grep -Fq 'retained root guidance' "$PLUGIN_ROOT/commands/lazy-librarian.md" || fail 'librarian command must name retained root guidance'
    grep -Fq 'primarily inspired by LazyCodex' "$PLUGIN_ROOT/README.md" || fail 'package README must explain the LazyCodex inspiration'
    if grep -Eq '\]\((\./)*\.\./docs/' "$PLUGIN_ROOT/README.md"; then
        fail 'package README must not link to removed repository-root docs/'
    fi
    pass 'standalone package documentation explains the current package boundary'
    exit 0
fi

# Given the current Buddy documentation, when its documentation contract
# is checked, then the retained evidence remains package-local.
for document in "$REPOSITORY_ROOT/lazybuddy-evaluation.md"; do
    assert_documentation_contract "$document"
done
check_root_docs_contract
grep -Fq 'six local MCP servers' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain the six-server inventory'
grep -Fq 'manual host' "$PLUGIN_ROOT/docs/verification-matrix.md" || fail 'verification matrix must retain manual host verification'
grep -Fq 'package readiness' "$PLUGIN_ROOT/README.md" || fail 'package README must distinguish package readiness'
grep -Fq 'this repository does not endorse a mutable marketplace URL' "$PLUGIN_ROOT/README.md" || fail 'package README must require immutable marketplace discovery'
grep -Fq 'retained root guidance' "$PLUGIN_ROOT/commands/lazy-librarian.md" || fail 'librarian command must name retained root guidance'
if grep -Fq 'docs/handoff.md' "$PLUGIN_ROOT/commands/lazy-librarian.md"; then
    fail 'librarian command must not direct users to deleted root docs'
fi
grep -Fq 'before running the host-generated install command' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must require immutable marketplace discovery'
if grep -Eq 'codebuddy plugin marketplace add[[:space:]]+https://github\.com/' \
    "$PLUGIN_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md"; then
    fail 'marketplace guidance must not provide a mutable GitHub marketplace command'
fi
grep -Fq 'package readiness' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must distinguish package readiness'
for document in \
    "$REPOSITORY_ROOT/docs/07a-state-and-validation.md" \
    "$REPOSITORY_ROOT/docs/05-evidence-and-completion.md" \
    "$REPOSITORY_ROOT/docs/reference/verification-contract.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md" \
    "$PLUGIN_ROOT/README.md"; do
    grep -Fqi 'best-effort' "$document" || fail "$(basename "$document") must describe timeout cleanup as best-effort"
    grep -Fqi 'not a security sandbox' "$document" || fail "$(basename "$document") must reject a sandbox claim"
    grep -Eqi 'VM or container-backed runner' "$document" || fail "$(basename "$document") must direct untrusted commands to isolation"
done
if rg -n -i 'guaranteed descendant cleanup|guarantees all descendants|timeout cleans all descendants' \
    "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/docs" "$REPOSITORY_ROOT/lazybuddy-evaluation.md" "$PLUGIN_ROOT/README.md" "$PLUGIN_ROOT/CHANGELOG.md"; then
    fail 'public verifier language retains a descendant-cleanup guarantee'
fi
legacy_release_claim='does not claim a LazyBuddy package release'
for document in \
    "$REPOSITORY_ROOT/README.md" \
    "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md" \
    "$PLUGIN_ROOT/README.md"; do
    grep -Fq 'primarily inspired by LazyCodex' "$document" || fail "$(basename "$document") must explain the LazyCodex inspiration"
    grep -Fq 'independent' "$document" || fail "$(basename "$document") must describe its independent runtime boundary"
    grep -Fq 'LazyCodex or OmO' "$document" || fail "$(basename "$document") must describe its independent runtime boundary"
    if grep -Fq "$legacy_release_claim" "$document"; then
        fail "$(basename "$document") must not retain the legacy package-release disclaimer"
    fi
done
grep -Fqx '![LazyBuddy](lazybuddy-banner.jpg)' "$REPOSITORY_ROOT/README.md" || fail 'README must embed the public LazyBuddy banner'
grep -Fqx '## `offboard` protocol' "$REPOSITORY_ROOT/AGENTS.md" || fail 'onboarding guide must provide an explicit offboard protocol'
if grep -Eqi 'alignment candidate|no longer maintained|practice project' \
    "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md" \
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md"; then
    fail 'public documentation must not use legacy candidate or practice-project framing'
fi
if grep -Eq '\]\((\./)*\.\./docs/' "$PLUGIN_ROOT/README.md"; then
    fail 'package README must not depend on repository-root docs/'
fi
test ! -e "$REPOSITORY_ROOT/workbuddy.md" || fail 'repository root must not ship workbuddy.md'
test ! -e "$PLUGIN_ROOT/workbuddy.md" || fail 'package root must not ship workbuddy.md'
pass 'current documentation satisfies the public learning-project contract'

# Given copied root docs, when a required learner page is absent, then the
# manifest contract rejects the incomplete learning route.
COPIED_REPOSITORY="$TMP/repository"
mkdir -p "$COPIED_REPOSITORY"
cp -R "$REPOSITORY_ROOT/docs" "$COPIED_REPOSITORY/docs"
rm "$COPIED_REPOSITORY/docs/07b-mcp-lifecycle.md"
if (REPOSITORY_ROOT="$COPIED_REPOSITORY"; check_root_docs_contract) > "$TMP/missing-page.out" 2>&1; then
    fail 'copied documentation with missing 07b learner page was accepted'
fi
grep -Fq 'docs/07b-mcp-lifecycle.md' "$TMP/missing-page.out" || fail 'missing-page failure did not identify 07b learner page'
pass 'copied documentation with missing 07b learner page is rejected'

# Given malformed copied documentation, when the link walker sees empty,
# missing, or escaping destinations, then it rejects each local-link violation.
assert_bad_link() {
    local fixture_name="$1" markdown="$2" expected="$3"
    local fixture_root="$TMP/$fixture_name"
    cp -R "$REPOSITORY_ROOT/docs" "$fixture_root"
    printf '%s\n' "$markdown" >> "$fixture_root/00-learning-path.md"
    if python3 - "$fixture_root" <<'PY' > "$TMP/link-fixture.out" 2>&1
import pathlib
import re
import sys

docs_root = pathlib.Path(sys.argv[1]).resolve()
repository_root = docs_root.parent
pattern = re.compile(r"\[[^\]]*\]\(([^)]*)\)")
for source in sorted(docs_root.rglob("*.md")):
    for target in pattern.findall(source.read_text(encoding="utf-8")):
        target = target.strip()
        if not target:
            raise SystemExit("empty")
        if target.startswith("#") or re.match(r"(?:https?://|mailto:)", target):
            continue
        resolved = (source.parent / target.split("#", 1)[0]).resolve()
        try:
            resolved.relative_to(repository_root)
        except ValueError:
            raise SystemExit("escapes repository")
        if not resolved.is_file():
            raise SystemExit("missing")
PY
    then
        fail "$fixture_name link fixture was accepted"
    fi
    grep -Fq "$expected" "$TMP/link-fixture.out" || fail "$fixture_name fixture did not report $expected"
}
assert_bad_link empty-link '[empty]()' 'empty'
assert_bad_link missing-link '[missing](not-a-page.md)' 'missing'
assert_bad_link escaping-link '[escape](../../outside.md)' 'escapes repository'
pass 'empty, missing, and escaping local links are rejected'

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
