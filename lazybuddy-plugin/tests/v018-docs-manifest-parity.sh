#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: v018-docs-manifest-parity.sh --lazybuddy-root ABSOLUTE_ROOT --lazytrae-root ABSOLUTE_ROOT

Compare caller-supplied LazyBuddy and LazyTrae learner documentation. This is
release-only evidence: it never discovers a sibling checkout. Every Markdown
page under docs/ must have a matching path and H1 title; prose is host-specific.
USAGE
}

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

LAZYBUDDY_ROOT=""
LAZYTRAE_ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --lazybuddy-root) [ "$#" -ge 2 ] || fail '--lazybuddy-root requires a value'; LAZYBUDDY_ROOT="$2"; shift 2 ;;
        --lazytrae-root) [ "$#" -ge 2 ] || fail '--lazytrae-root requires a value'; LAZYTRAE_ROOT="$2"; shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; fail "unknown argument: $1" ;;
    esac
done

[ -n "$LAZYBUDDY_ROOT" ] || { usage >&2; fail '--lazybuddy-root is required'; }
[ -n "$LAZYTRAE_ROOT" ] || { usage >&2; fail '--lazytrae-root is required'; }
case "$LAZYBUDDY_ROOT" in /*) ;; *) fail '--lazybuddy-root must be absolute' ;; esac
case "$LAZYTRAE_ROOT" in /*) ;; *) fail '--lazytrae-root must be absolute' ;; esac
[ -f "$LAZYBUDDY_ROOT/lazybuddy-evaluation.md" ] || fail 'misconfigured LazyBuddy root'
[ -f "$LAZYTRAE_ROOT/lazytrae-evaluation.md" ] || fail 'misconfigured LazyTrae root'

python3 - "$LAZYBUDDY_ROOT" "$LAZYTRAE_ROOT" <<'PY'
from pathlib import Path
import re
import sys

roots = {"LazyBuddy": Path(sys.argv[1]).resolve(), "LazyTrae": Path(sys.argv[2]).resolve()}
heading_pattern = re.compile(r"^# (.+?)\s*$", re.MULTILINE)
host_name_pattern = re.compile(r"\b(?:LazyBuddy|LazyTrae)\b")
manifests = {}

for name, root in roots.items():
    docs = root / "docs"
    if not docs.is_dir():
        raise SystemExit(f"FAIL: {name} docs directory is missing: {docs}")
    manifest = {}
    for page in sorted(docs.rglob("*.md")):
        relative = page.relative_to(root).as_posix()
        in_fence = False
        visible_lines = []
        for line in page.read_text(encoding="utf-8").splitlines():
            if line.startswith("```"):
                in_fence = not in_fence
            if not in_fence:
                visible_lines.append(line)
        headings = heading_pattern.findall("\n".join(visible_lines))
        if not headings:
            raise SystemExit(f"FAIL: {name} page has no visible H1: {relative}")
        manifest[relative] = headings[0]
    manifests[name] = manifest

for source, target in (("LazyBuddy", "LazyTrae"), ("LazyTrae", "LazyBuddy")):
    missing = sorted(set(manifests[source]) - set(manifests[target]))
    if missing:
        raise SystemExit(f"FAIL: {source} paths missing from {target}: {', '.join(missing)}")
    mismatched = [
        path
        for path in sorted(manifests[source])
        if host_name_pattern.sub("LazyHost", manifests[source][path])
        != host_name_pattern.sub("LazyHost", manifests[target][path])
    ]
    if mismatched:
        path = mismatched[0]
        raise SystemExit(
            f"FAIL: shared page title differs at {path}: "
            f"{source}={manifests[source][path]!r}, {target}={manifests[target][path]!r}"
        )

print(f"PASS: bidirectional learner manifest parity ({len(manifests['LazyBuddy'])} pages; shared paths and H1 titles)")
PY
