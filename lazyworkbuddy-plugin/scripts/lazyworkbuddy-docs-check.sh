#!/bin/bash
# lazyworkbuddy-docs-check.sh
# Checks for broken internal markdown links within the plugin directory.
#
# Usage: ./scripts/lazyworkbuddy-docs-check.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

echo "=== Lazyworkbuddy Docs Check ==="
echo ""

PASS=0
FAIL=0
BROKEN=""

# Find all markdown files
echo "Scanning for broken internal links in ${PLUGIN_ROOT}..."

# Extract all relative markdown links [text](path.md) from .md files
# Skip http/https URLs, only check relative paths within the plugin
while IFS= read -r -d '' md_file; do
    # Extract relative markdown links (not http/https, not anchors only)
    # macOS grep doesn't support -P; use sed for extraction
    links=$(sed -n 's/.*\[[^]]*\](\([^)]*\.md\)).*/\1/p' "$md_file" 2>/dev/null || true)

    for link in $links; do
        # Skip http/https URLs
        if echo "$link" | grep -qE '^https?://'; then
            continue
        fi

        # Resolve relative to the file's directory
        link_dir="$(dirname "$md_file")"
        resolved="${link_dir}/${link}"

        if [ -f "$resolved" ]; then
            PASS=$((PASS + 1))
        else
            FAIL=$((FAIL + 1))
            echo "  [FAIL] Broken link in $(basename "$md_file"): ${link} -> ${resolved} (not found)"
            BROKEN="${BROKEN}\n  - $(basename "$md_file"): ${link}"
        fi
    done
done < <(find "${PLUGIN_ROOT}" -name "*.md" -print0)

echo ""
echo "=== Results ==="
echo "Valid links: ${PASS}"
echo "Broken links: ${FAIL}"

if [ -n "$BROKEN" ]; then
    echo "Broken:$BROKEN"
fi

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "Docs check: ALL PASS"
    exit 0
else
    echo ""
    echo "Docs check: ${FAIL} BROKEN LINK(S)"
    exit 1
fi
