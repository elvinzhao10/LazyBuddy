#!/bin/bash
# lazybuddy-docs-check.sh — Broken internal markdown link checker (v0.9)
#
# Scans all .md files in docs/ and lazybuddy-plugin/ directories for internal
# [text](path.md) links. For each link, verifies the target file exists.
# Outputs a JSON summary. Exit code 0 if no broken links; exit code 1 if broken links found.
#
# Usage: ./scripts/lazybuddy-docs-check.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

PROJECT_ROOT="$(cd "${PLUGIN_ROOT}/.." && pwd)"
BROKEN=""
FIRST=true
TOTAL=0
BROKEN_COUNT=0

append_broken() {
    local source_file="$1"
    local link="$2"
    local resolved="$3"
    local reason="$4"
    BROKEN_COUNT=$((BROKEN_COUNT + 1))
    if [ "$FIRST" = false ]; then
        BROKEN+=','
    fi
    FIRST=false
    local esc_source="${source_file//\\/\\\\}"; esc_source="${esc_source//\"/\\\"}"
    local esc_link="${link//\\/\\\\}"; esc_link="${esc_link//\"/\\\"}"
    local esc_resolved="${resolved//\\/\\\\}"; esc_resolved="${esc_resolved//\"/\\\"}"
    local esc_reason="${reason//\\/\\\\}"; esc_reason="${esc_reason//\"/\\\"}"
    BROKEN+="{\"source\":\"${esc_source}\",\"link\":\"${esc_link}\",\"resolved\":\"${esc_resolved}\",\"reason\":\"${esc_reason}\"}"
}

# Scan markdown files in both docs/ and lazybuddy-plugin/
for scan_dir in "${PROJECT_ROOT}/docs" "${PLUGIN_ROOT}"; do
    [ -d "$scan_dir" ] || continue
    while IFS= read -r -d '' md_file; do
        file_dir="$(dirname "$md_file")"
        # Extract markdown links: [text](path) where path ends in .md
        # Strip inline code (content between backticks) first to avoid false positives
        links=$(sed 's/`[^`]*`//g' "$md_file" 2>/dev/null | grep -oE '\[[^]]+\]\([^)]*\.md[^)]*\)' | sed 's/\[[^]]*\](\(.*\))/\1/' || true)
        for link in $links; do
            # Skip absolute URLs
            if echo "$link" | grep -qE '^https?://'; then
                continue
            fi
            # Strip anchor
            link_path="${link%%#*}"
            TOTAL=$((TOTAL + 1))
            resolved="${file_dir}/${link_path}"
            # Normalize the path to resolve .. and . components
            # realpath is not available on all macOS versions; fall back to python
            if command -v realpath &>/dev/null; then
                resolved_normalized=$(realpath "$resolved" 2>/dev/null || echo "$resolved")
            elif command -v python3 &>/dev/null; then
                resolved_normalized=$(python3 -c "import os; print(os.path.realpath('${resolved}'))" 2>/dev/null || echo "$resolved")
            else
                resolved_normalized="$resolved"
            fi
            if [ -f "$resolved_normalized" ]; then
                : # OK
            else
                append_broken "$md_file" "$link" "$resolved_normalized" "file not found"
            fi
        done
    done < <(find "$scan_dir" -name "*.md" -print0 2>/dev/null || true)
done

if [ "$BROKEN_COUNT" -eq 0 ]; then
    echo "{\"total_links\":${TOTAL},\"broken\":0,\"broken_links\":[]}"
    exit 0
else
    echo "{\"total_links\":${TOTAL},\"broken\":${BROKEN_COUNT},\"broken_links\":[${BROKEN}]}"
    exit 1
fi
