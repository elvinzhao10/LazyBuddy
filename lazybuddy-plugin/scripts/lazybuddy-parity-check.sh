#!/bin/bash
# lazybuddy-parity-check.sh — LazyCodex-to-WorkBuddy parity coverage auditor (v0.9)
#
# Compares lazybuddy-plugin/ structure against dev/reference/lazycodex/plugins/omo/.
# Checks: skills count, hooks events, and agents count.
# Outputs coverage percentage and missing items as JSON.
# Exit code 0 if coverage >= 70%; exit code 1 if coverage < 70%.
#
# Usage: ./scripts/lazybuddy-parity-check.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

PROJECT_ROOT="$(cd "${PLUGIN_ROOT}/.." && pwd)"
REF_SKILLS_DIR="${PROJECT_ROOT}/dev/reference/lazycodex/plugins/omo/skills"
REF_HOOKS_DIR="${PROJECT_ROOT}/dev/reference/lazycodex/plugins/omo/hooks"
REF_AGENTS_DIR="${PROJECT_ROOT}/dev/reference/lazycodex/plugins/omo/components/ultrawork/agents"

WB_SKILLS_DIR="${PLUGIN_ROOT}/skills"
WB_HOOKS_JSON="${PLUGIN_ROOT}/hooks/hooks.json"
WB_AGENTS_DIR="${PLUGIN_ROOT}/agents"

THRESHOLD=70
DETAILS=""
SEP=""

# ---- Skills count comparison ----
REF_SKILLS_COUNT=0
WB_SKILLS_COUNT=0
REF_SKILLS_LIST=""
WB_SKILLS_LIST=""
WB_ONLY_SKILLS=""

if [ -d "$REF_SKILLS_DIR" ]; then
    REF_SKILLS_COUNT=$(find "$REF_SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
    REF_SKILLS_LIST=$(find "$REF_SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; | sort)
fi

if [ -d "$WB_SKILLS_DIR" ]; then
    WB_SKILLS_COUNT=$(find "$WB_SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
    WB_SKILLS_LIST=$(find "$WB_SKILLS_DIR" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; | sort)
fi

# WorkBuddy-only skills
SEP2=""
for wb_skill in $WB_SKILLS_LIST; do
    found=false
    for ref_skill in $REF_SKILLS_LIST; do
        [ "$wb_skill" = "$ref_skill" ] && found=true && break
    done
    if [ "$found" = false ]; then
        WB_ONLY_SKILLS+="${SEP2}\"${wb_skill}\""
        SEP2="," || true
    fi
done

# Skills missing (in reference but not in workbuddy)
MISSING_SKILLS=""
SEP3=""
for ref_skill in $REF_SKILLS_LIST; do
    found=false
    for wb_skill in $WB_SKILLS_LIST; do
        [ "$ref_skill" = "$wb_skill" ] && found=true && break
    done
    if [ "$found" = false ]; then
        MISSING_SKILLS+="${SEP3}\"${ref_skill}\""
        SEP3="," || true
    fi
done

# ---- Hooks events comparison ----
REF_HOOKS_COUNT=0
WB_HOOKS_COUNT=0
WB_HOOK_EVENTS=""

if [ -d "$REF_HOOKS_DIR" ]; then
    REF_HOOKS_COUNT=$(find "$REF_HOOKS_DIR" -maxdepth 1 -name "*.json" | wc -l | tr -d ' ')
fi

if [ -f "$WB_HOOKS_JSON" ]; then
    if command -v python3 &>/dev/null; then
        WB_HOOKS_COUNT=$(python3 -c "
import json
with open('${WB_HOOKS_JSON}') as f:
    data = json.load(f)
hooks = data.get('hooks', {})
count = sum(len(v) for v in hooks.values())
print(count)
" 2>/dev/null || echo "0")
    else
        WB_HOOKS_COUNT=$(grep -c '"command"' "$WB_HOOKS_JSON" 2>/dev/null || echo "0")
    fi
fi

# ---- Agents count comparison ----
REF_AGENTS_COUNT=0
WB_AGENTS_COUNT=0

if [ -d "$REF_AGENTS_DIR" ]; then
    REF_AGENTS_COUNT=$(find "$REF_AGENTS_DIR" -maxdepth 1 -name "*.toml" | wc -l | tr -d ' ')
fi

if [ -d "$WB_AGENTS_DIR" ]; then
    WB_AGENTS_COUNT=$(find "$WB_AGENTS_DIR" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
fi

# ---- Coverage calculation ----
# Dimension weights: skills, hooks, and agents contribute equally.
SKILL_COV=0
HOOK_COV=0
AGENT_COV=0

if [ "$REF_SKILLS_COUNT" -gt 0 ]; then
    SKILL_COV=$(echo "scale=1; ${WB_SKILLS_COUNT} * 100 / ${REF_SKILLS_COUNT}" | bc 2>/dev/null || echo "0")
fi
if [ "$REF_HOOKS_COUNT" -gt 0 ]; then
    HOOK_COV=$(echo "scale=1; ${WB_HOOKS_COUNT} * 100 / ${REF_HOOKS_COUNT}" | bc 2>/dev/null || echo "0")
fi
if [ "$REF_AGENTS_COUNT" -gt 0 ]; then
    AGENT_COV=$(echo "scale=1; ${WB_AGENTS_COUNT} * 100 / ${REF_AGENTS_COUNT}" | bc 2>/dev/null || echo "0")
    # Cap at 100% — having more agents than reference is expected (WorkBuddy-native agents)
    AGENT_COV_INT=$(echo "${AGENT_COV}" | cut -d'.' -f1 2>/dev/null || echo "0")
    if [ "$AGENT_COV_INT" -gt 100 ]; then
        AGENT_COV="100.0"
    fi
fi
# Weighted total
TOTAL_COV=$(echo "scale=1; (${SKILL_COV} + ${HOOK_COV} + ${AGENT_COV}) / 3" | bc 2>/dev/null || echo "0")
TOTAL_COV_INT=$(echo "${TOTAL_COV}" | cut -d'.' -f1 2>/dev/null || echo "0")

# ---- Build JSON ----
MISSING_SKILLS_ARR="[${MISSING_SKILLS}]"
WB_ONLY_ARR="[${WB_ONLY_SKILLS}]"

json="{\"coverage_pct\":${TOTAL_COV},\"threshold_pct\":${THRESHOLD},\"pass\":"
if [ "$TOTAL_COV_INT" -ge "$THRESHOLD" ]; then
    json+="true"
else
    json+="false"
fi
json+=",\"dimensions\":{"
json+="\"skills\":{\"ref_count\":${REF_SKILLS_COUNT},\"wb_count\":${WB_SKILLS_COUNT},\"coverage_pct\":${SKILL_COV},\"missing\":${MISSING_SKILLS_ARR},\"wb_only\":${WB_ONLY_ARR}},"
json+="\"hooks\":{\"ref_count\":${REF_HOOKS_COUNT},\"wb_count\":${WB_HOOKS_COUNT},\"coverage_pct\":${HOOK_COV}},"
json+="\"agents\":{\"ref_count\":${REF_AGENTS_COUNT},\"wb_count\":${WB_AGENTS_COUNT},\"coverage_pct\":${AGENT_COV}}"
json+="}}"

echo "$json"

if [ "$TOTAL_COV_INT" -ge "$THRESHOLD" ]; then
    exit 0
else
    exit 1
fi
