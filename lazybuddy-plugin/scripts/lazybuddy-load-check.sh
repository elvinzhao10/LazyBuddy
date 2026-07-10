#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0
FAIL=0

check_count() {
    local label="$1" expected="$2" actual="$3"
    if [ "$actual" -eq "$expected" ]; then
        echo "PASS ${label}: ${actual}/${expected}"
        PASS=$((PASS + 1))
    else
        echo "FAIL ${label}: ${actual}/${expected}"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== LazyBuddy Tool Load Check ==="
echo "Plugin root: ${PLUGIN_ROOT}"
check_count "skills" 14 "$(find "${PLUGIN_ROOT}/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -type f | wc -l | tr -d ' ')"
check_count "commands" 15 "$(find "${PLUGIN_ROOT}/commands" -maxdepth 1 -name '*.md' -type f | wc -l | tr -d ' ')"
check_count "agents" 13 "$(find "${PLUGIN_ROOT}/agents" -maxdepth 1 -name '*.md' -type f | wc -l | tr -d ' ')"

while IFS=$'\t' read -r label actual expected; do
    check_count "$label" "$expected" "$actual"
done < <(python3 - "${PLUGIN_ROOT}" <<'PY'
import json
import os
import sys
root = sys.argv[1]
for label, filename, key, expected in [
    ("hooks", os.path.join(root, "hooks", "hooks.json"), "hooks", 12),
    ("MCP servers", os.path.join(root, ".mcp.json"), "mcpServers", 8),
]:
    try:
        with open(filename) as handle:
            actual = len(json.load(handle).get(key, {}))
    except Exception:
        actual = -1
    print(f"{label}\t{actual}\t{expected}")
PY
)

if [ "$FAIL" -eq 0 ]; then
    echo "PASS manifest-backed tool set is ready. Reload the host if this is a newly installed plugin."
    exit 0
fi
echo "FAIL tool load check. Reinstall or reload LazyBuddy, then run this check again."
exit 1
