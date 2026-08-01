#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REPOSITORY_ROOT="${REPOSITORY_ROOT:-$(cd "$PLUGIN_ROOT/.." && pwd -P)}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-publication-regression.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

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

check_required_pages() {
    local relative_path
    for relative_path in "${required_root_docs[@]}"; do
        [ -f "$REPOSITORY_ROOT/$relative_path" ] || {
            printf 'FAIL: required root doc is missing: %s\n' "$relative_path" >&2
            return 1
        }
    done
}

check_local_links() {
    local publication_files=(
        "$REPOSITORY_ROOT/README.md"
        "$REPOSITORY_ROOT/AGENTS.md"
        "$REPOSITORY_ROOT/lazybuddy-evaluation.md"
    )
    local source
    while IFS= read -r source; do
        publication_files+=("$source")
    done < <(find "$REPOSITORY_ROOT/docs" -type f -name '*.md' -print | LC_ALL=C sort)

    python3 - "$REPOSITORY_ROOT" "${publication_files[@]}" <<'PY'
from pathlib import Path
import re
import sys

repository_root = Path(sys.argv[1]).resolve()
link_pattern = re.compile(r"\[[^\]]*\]\(([^)]*)\)")

for source_arg in sys.argv[2:]:
    source = Path(source_arg).resolve()
    for raw_target in link_pattern.findall(source.read_text(encoding="utf-8")):
        target = raw_target.strip()
        if not target:
            raise SystemExit(f"empty: {source.relative_to(repository_root)}")
        if target.startswith("#") or re.match(r"(?:https?://|mailto:)", target):
            continue
        resolved = (source.parent / target.split("#", 1)[0]).resolve()
        try:
            resolved.relative_to(repository_root)
        except ValueError:
            raise SystemExit(f"escapes repository: {source.relative_to(repository_root)} -> {target}") from None
        if not resolved.exists():
            raise SystemExit(f"missing: {source.relative_to(repository_root)} -> {target}")
PY
}

for publication in README.md AGENTS.md lazybuddy-evaluation.md; do
    [ -s "$REPOSITORY_ROOT/$publication" ] || fail "required publication is missing or empty: $publication"
done
check_required_pages || fail 'root learner route is incomplete'
check_local_links || fail 'root documentation contains an invalid local link'

publication_paths=(
    "$REPOSITORY_ROOT/README.md"
    "$REPOSITORY_ROOT/AGENTS.md"
    "$REPOSITORY_ROOT/lazybuddy-evaluation.md"
    "$REPOSITORY_ROOT/docs"
)
grep -Eriq 'package readiness' "${publication_paths[@]}" || fail 'public docs must distinguish package readiness'
grep -Eriq 'host (verification|proof|session|integration)' "${publication_paths[@]}" || fail 'public docs must distinguish host verification'
grep -Eriq 'independent' "${publication_paths[@]}" || fail 'public docs must describe the independent runtime boundary'
if grep -Eriq '(requires|depends on)[^.]*(LazyCodex|OmO)' "${publication_paths[@]}"; then
    fail 'public docs must not claim a LazyCodex or OmO runtime dependency'
fi
if grep -Eriq 'codebuddy plugin marketplace add[[:space:]]+https://github\.com/' "${publication_paths[@]}"; then
    fail 'public docs must not provide a mutable marketplace command'
fi
if grep -Eriq 'guaranteed descendant cleanup|guarantees all descendants|timeout cleans all descendants' "${publication_paths[@]}"; then
    fail 'public docs must not overstate timeout descendant cleanup'
fi
if grep -Eriq 'alignment candidate|no longer maintained|practice project' "${publication_paths[@]}"; then
    fail 'public docs retain obsolete project framing'
fi
if grep -Erq 'tests/v017-documentation-regression\.sh' "${publication_paths[@]}"; then
    fail 'public docs reference the deleted documentation regression'
fi
if grep -Erq 'git clone[[:space:]]+https://github\.com/elvinzhao10/LazyBuddy(\.git)?([[:space:]]|$)' "${publication_paths[@]}"; then
    fail 'public docs contain an unpinned LazyBuddy clone command'
fi
pass 'current root learner publications satisfy semantic and link checks'

# Given a copied learner route with one required page missing, when publication
# verification runs, then it rejects the incomplete route.
COPIED_REPOSITORY="$TMP/missing-page"
mkdir -p "$COPIED_REPOSITORY"
cp -R "$REPOSITORY_ROOT/docs" "$COPIED_REPOSITORY/docs"
rm "$COPIED_REPOSITORY/docs/07b-mcp-lifecycle.md"
if (REPOSITORY_ROOT="$COPIED_REPOSITORY"; check_required_pages) > "$TMP/missing-page.out" 2>&1; then
    fail 'copied documentation with missing learner page was accepted'
fi
grep -Fq 'docs/07b-mcp-lifecycle.md' "$TMP/missing-page.out" || fail 'missing-page failure did not identify the learner page'
pass 'missing learner page fixture is rejected'

copy_publication_fixture() {
    local fixture_root="$1"
    mkdir -p "$fixture_root/lazybuddy-plugin"
    cp -R "$REPOSITORY_ROOT/docs" "$fixture_root/docs"
    cp "$REPOSITORY_ROOT/README.md" "$REPOSITORY_ROOT/AGENTS.md" "$REPOSITORY_ROOT/CONTRIBUTING.md" \
        "$REPOSITORY_ROOT/SECURITY.md" "$REPOSITORY_ROOT/lazybuddy-evaluation.md" "$fixture_root/"
    cp "$REPOSITORY_ROOT/LICENSE" "$REPOSITORY_ROOT/NOTICE" "$REPOSITORY_ROOT/lazybuddy-banner.jpg" "$fixture_root/"
    cp "$REPOSITORY_ROOT/lazybuddy-plugin/README.md" "$fixture_root/lazybuddy-plugin/README.md"
    mkdir -p "$fixture_root/lazybuddy-plugin/contracts"
    cp "$REPOSITORY_ROOT/lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json" \
        "$fixture_root/lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json"
}

assert_bad_link() {
    local fixture_name="$1" markdown="$2" expected="$3"
    local fixture_root="$TMP/$fixture_name"
    copy_publication_fixture "$fixture_root"
    printf '%s\n' "$markdown" >> "$fixture_root/docs/00-learning-path.md"
    if (REPOSITORY_ROOT="$fixture_root"; check_local_links) > "$TMP/$fixture_name.out" 2>&1; then
        fail "$fixture_name link fixture was accepted"
    fi
    grep -Fq "$expected" "$TMP/$fixture_name.out" || fail "$fixture_name fixture did not report $expected"
    pass "$fixture_name fixture is rejected"
}

# Given malformed copied documentation, when the publication walker sees an
# empty, missing, or escaping destination, then each invalid target is rejected.
assert_bad_link empty-link '[empty]()' 'empty'
assert_bad_link missing-link '[missing](not-a-page.md)' 'missing'
assert_bad_link escaping-link '[escape](../../outside.md)' 'escapes repository'

assert_bad_root_link() {
    local publication="$1"
    local fixture_name="broken-${publication%.md}"
    local fixture_root="$TMP/$fixture_name"
    copy_publication_fixture "$fixture_root"
    printf '%s\n' '[missing](missing-root-publication-target.md)' >> "$fixture_root/$publication"
    if (REPOSITORY_ROOT="$fixture_root"; check_local_links) > "$TMP/$fixture_name.out" 2>&1; then
        fail "$publication broken link fixture was accepted"
    fi
    grep -Fq "$publication" "$TMP/$fixture_name.out" || fail "$publication broken link fixture did not identify its source"
    pass "$publication broken link fixture is rejected"
}

# Given each required root publication has a broken local link, when the
# publication walker runs, then it rejects the link and identifies its source.
for publication in README.md AGENTS.md lazybuddy-evaluation.md; do
    assert_bad_root_link "$publication"
done

# Given an existing directory target, when the publication walker resolves it,
# then the directory is a valid local destination.
DIRECTORY_FIXTURE="$TMP/directory-link"
copy_publication_fixture "$DIRECTORY_FIXTURE"
printf '%s\n' '[reference](reference/)' >> "$DIRECTORY_FIXTURE/docs/00-learning-path.md"
(REPOSITORY_ROOT="$DIRECTORY_FIXTURE"; check_local_links) || fail 'existing directory link target was rejected'
pass 'existing directory link fixture is accepted'
