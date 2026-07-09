#!/bin/bash
# lazyworkbuddy-plugin-doctor.sh
# Validates the plugin structure: manifest exists + parses as JSON,
# all component dirs exist, all placeholder skills/commands present.
#
# Usage: ./scripts/lazyworkbuddy-plugin-doctor.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

# Determine plugin root
if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

PASS=0
FAIL=0
ERRORS=""

check() {
    local label="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  [PASS] $label"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $label — $result"
        FAIL=$((FAIL + 1))
        ERRORS="${ERRORS}\n  - $label: $result"
    fi
}

echo "=== Lazyworkbuddy Plugin Doctor ==="
echo "Plugin root: ${PLUGIN_ROOT}"
echo ""

# 1. Manifest exists
if [ -f "${PLUGIN_ROOT}/.workbuddy-plugin/plugin.json" ]; then
    check "Manifest exists" ok
else
    check "Manifest exists" "missing: ${PLUGIN_ROOT}/.workbuddy-plugin/plugin.json"
fi

# 2. Manifest parses as JSON
if python3 -c "import json; json.load(open('${PLUGIN_ROOT}/.workbuddy-plugin/plugin.json'))" 2>/dev/null; then
    check "Manifest is valid JSON" ok
else
    check "Manifest is valid JSON" "parse error"
fi

# 3. Required manifest fields
MANIFEST="${PLUGIN_ROOT}/.workbuddy-plugin/plugin.json"
for field in name version skills commands agents hooks mcpServers; do
    if python3 -c "import json; d=json.load(open('${MANIFEST}')); assert '${field}' in d" 2>/dev/null; then
        check "Manifest field: ${field}" ok
    else
        check "Manifest field: ${field}" "missing"
    fi
done

# 4. Component directories exist
for dir in skills commands agents hooks mcp scripts schemas tests docs; do
    if [ -d "${PLUGIN_ROOT}/${dir}" ]; then
        check "Directory: ${dir}/" ok
    else
        check "Directory: ${dir}/" "missing"
    fi
done

# 5. Hooks scaffold exists
if [ -f "${PLUGIN_ROOT}/hooks/hooks.json" ]; then
    check "hooks/hooks.json exists" ok
    if python3 -c "import json; json.load(open('${PLUGIN_ROOT}/hooks/hooks.json'))" 2>/dev/null; then
        check "hooks/hooks.json is valid JSON" ok
    else
        check "hooks/hooks.json is valid JSON" "parse error"
    fi
else
    check "hooks/hooks.json exists" "missing"
fi

# 6. MCP scaffold exists
if [ -f "${PLUGIN_ROOT}/.mcp.json" ]; then
    check ".mcp.json exists" ok
    if python3 -c "import json; json.load(open('${PLUGIN_ROOT}/.mcp.json'))" 2>/dev/null; then
        check ".mcp.json is valid JSON" ok
    else
        check ".mcp.json is valid JSON" "parse error"
    fi
else
    check ".mcp.json exists" "missing"
fi

# 7. Placeholder commands (8)
EXPECTED_COMMANDS="init-deep ulw-plan start-work ulw-loop verifier reviewer librarian migration-planner"
for cmd in $EXPECTED_COMMANDS; do
    if [ -f "${PLUGIN_ROOT}/commands/${cmd}.md" ]; then
        check "Command: ${cmd}.md" ok
    else
        check "Command: ${cmd}.md" "missing"
    fi
done

# 8. Placeholder skills (8)
EXPECTED_SKILLS="init-deep ulw-plan start-work ulw-loop verifier reviewer librarian migration-planner"
for skill in $EXPECTED_SKILLS; do
    if [ -f "${PLUGIN_ROOT}/skills/${skill}/SKILL.md" ]; then
        check "Skill: ${skill}/SKILL.md" ok
    else
        check "Skill: ${skill}/SKILL.md" "missing"
    fi
done

# 9. Empty dirs have .gitkeep
for dir in agents mcp scripts schemas tests docs; do
    if [ -f "${PLUGIN_ROOT}/${dir}/.gitkeep" ]; then
        check "Gitkeep: ${dir}/.gitkeep" ok
    else
        check "Gitkeep: ${dir}/.gitkeep" "missing"
    fi
done

# 10. Validation scripts exist and are executable
for script in lazyworkbuddy-smoke-test.sh lazyworkbuddy-docs-check.sh lazyworkbuddy-parity-check.sh; do
    if [ -f "${PLUGIN_ROOT}/scripts/${script}" ]; then
        if [ -x "${PLUGIN_ROOT}/scripts/${script}" ]; then
            check "Script executable: ${script}" ok
        else
            check "Script executable: ${script}" "not executable"
        fi
    else
        check "Script: ${script}" "missing"
    fi
done

echo ""
echo "=== Results ==="
echo "Passed: ${PASS}"
echo "Failed: ${FAIL}"
if [ -n "$ERRORS" ]; then
    echo "Errors:$ERRORS"
fi

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "Doctor check: ALL PASS"
    exit 0
else
    echo ""
    echo "Doctor check: ${FAIL} FAILURE(S)"
    exit 1
fi
