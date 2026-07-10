#!/bin/bash
# lazybuddy-smoke-test.sh
# Checks each SKILL.md has valid YAML frontmatter, each command file is non-empty.
#
# Usage: ./scripts/lazybuddy-smoke-test.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

PASS=0
FAIL=0

check() {
    local label="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  [PASS] $label"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $label — $result"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== LazyBuddy Smoke Test ==="
echo ""

# 1. Check each SKILL.md has valid YAML frontmatter
for skill_dir in "${PLUGIN_ROOT}"/skills/*/; do
    skill_name="$(basename "$skill_dir")"
    skill_file="${skill_dir}SKILL.md"

    if [ ! -f "$skill_file" ]; then
        check "Skill ${skill_name}: SKILL.md exists" "missing"
        continue
    fi

    # Check for YAML frontmatter (starts with ---)
    if head -1 "$skill_file" | grep -q "^---$"; then
        check "Skill ${skill_name}: has YAML frontmatter" ok

        # Extract frontmatter and check for required fields
        frontmatter=$(sed -n '/^---$/,/^---$/p' "$skill_file")
        if echo "$frontmatter" | grep -q "^name:"; then
            check "Skill ${skill_name}: has 'name' field" ok
        else
            check "Skill ${skill_name}: has 'name' field" "missing"
        fi
        if echo "$frontmatter" | grep -q "^description:"; then
            check "Skill ${skill_name}: has 'description' field" ok
        else
            check "Skill ${skill_name}: has 'description' field" "missing"
        fi
    else
        check "Skill ${skill_name}: has YAML frontmatter" "no --- delimiter"
    fi
done

# 2. Check each command file is non-empty Markdown
for cmd_file in "${PLUGIN_ROOT}"/commands/*.md; do
    cmd_name="$(basename "$cmd_file" .md)"

    if [ -f "$cmd_file" ] && [ -s "$cmd_file" ]; then
        check "Command ${cmd_name}: file is non-empty" ok

        # Check for frontmatter
        if head -1 "$cmd_file" | grep -q "^---$"; then
            check "Command ${cmd_name}: has YAML frontmatter" ok
        else
            check "Command ${cmd_name}: has YAML frontmatter" "missing"
        fi

        # Check content length (more than just frontmatter)
        line_count=$(wc -l < "$cmd_file")
        if [ "$line_count" -ge 5 ]; then
            check "Command ${cmd_name}: has sufficient content (${line_count} lines)" ok
        else
            check "Command ${cmd_name}: has sufficient content" "only ${line_count} lines (need >= 5)"
        fi
    else
        check "Command ${cmd_name}: file is non-empty" "empty or missing"
    fi
done

# 3. Check hooks.json has the 12 expected event types
HOOKS_FILE="${PLUGIN_ROOT}/hooks/hooks.json"
if [ -f "$HOOKS_FILE" ]; then
    EXPECTED_EVENTS="SessionStart UserPromptSubmit PreToolUse PostToolUse PostToolUseFailure PreCompact Stop StopFailure TaskCreated TaskCompleted SubagentStart SubagentStop"
    for event in $EXPECTED_EVENTS; do
        if grep -q "\"${event}\"" "$HOOKS_FILE"; then
            check "Hooks: ${event} event type present" ok
        else
            check "Hooks: ${event} event type present" "missing"
        fi
    done
fi

echo ""
echo "=== Results ==="
echo "Passed: ${PASS}"
echo "Failed: ${FAIL}"

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "Smoke test: ALL PASS"
    exit 0
else
    echo ""
    echo "Smoke test: ${FAIL} FAILURE(S)"
    exit 1
fi
