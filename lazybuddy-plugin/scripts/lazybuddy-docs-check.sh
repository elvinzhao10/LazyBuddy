#!/bin/bash
set -euo pipefail

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="$(cd "${CODEBUDDY_PLUGIN_ROOT}" && pwd -P)"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
fi

BROKEN=""
FIRST=true
TOTAL=0
BROKEN_COUNT=0
POLICY_VIOLATIONS=""
POLICY_COUNT=0

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

append_policy_violation() {
    local source_file="$1"
    local pattern="$2"
    POLICY_COUNT=$((POLICY_COUNT + 1))
    if [ -n "$POLICY_VIOLATIONS" ]; then
        POLICY_VIOLATIONS+=','
    fi
    local esc_source="${source_file//\\/\\\\}"; esc_source="${esc_source//\"/\\\"}"
    local esc_pattern="${pattern//\\/\\\\}"; esc_pattern="${esc_pattern//\"/\\\"}"
    POLICY_VIOLATIONS+="{\"source\":\"${esc_source}\",\"pattern\":\"${esc_pattern}\"}"
}

check_active_documentation_policy() {
    local active_paths=(
        "${PLUGIN_ROOT}/README.md"
        "${PLUGIN_ROOT}/skills"
        "${PLUGIN_ROOT}/agents"
        "${PLUGIN_ROOT}/commands"
        "${PLUGIN_ROOT}/templates"
    )
    local forbidden_patterns=(
        '\\.omo(/|[^[:alnum:]_])'
        'lazycodex'
        '(^|[^[:alnum:]_])omo([^[:alnum:]_]|$)'
        'lazybuddy-parity-check'
        'lazy-parity-report'
        'source-map'
        'docs/reference/'
    )
    local active_path pattern policy_file

    for active_path in "${active_paths[@]}"; do
        [ -e "$active_path" ] || continue
        while IFS= read -r -d '' policy_file; do
            for pattern in "${forbidden_patterns[@]}"; do
                if [ "$policy_file" = "${PLUGIN_ROOT}/README.md" ] && \
                    { [ "$pattern" = 'lazycodex' ] || [ "$pattern" = '(^|[^[:alnum:]_])omo([^[:alnum:]_]|$)' ]; }; then
                    continue
                fi
                if grep -Eiq "$pattern" "$policy_file"; then
                    append_policy_violation "$policy_file" "$pattern"
                fi
            done
        done < <(find "$active_path" -type f -name '*.md' -print0 2>/dev/null)
    done
    if grep -Eqi '(requires|depends on)[^.]*(LazyCodex|OmO)' "${PLUGIN_ROOT}/README.md"; then
        append_policy_violation "${PLUGIN_ROOT}/README.md" "must not claim a LazyCodex or OmO runtime dependency"
    fi
}

check_init_deep_evidence_contract() {
    local document key
    local documents=(
        "${PLUGIN_ROOT}/skills/lazy-init-deep/SKILL.md"
        "${PLUGIN_ROOT}/commands/lazy-init-deep.md"
    )
    local required_keys=(
        readiness_result
        readiness_host
        capability_statuses
        optional_policy
        receipt_state
        evidence_paths
    )

    for document in "${documents[@]}"; do
        [ -f "$document" ] || { append_policy_violation "$document" "missing InitDeep document"; continue; }
        for key in "${required_keys[@]}"; do
            grep -Fq "$key" "$document" || append_policy_violation "$document" "missing InitDeep evidence key: $key"
        done
    done

    grep -Fq 'load check first' "${documents[0]}" || append_policy_violation "${documents[0]}" "InitDeep must load-check first"
    grep -Fq 'skills, commands, agents, hooks, and MCP declarations' "${documents[0]}" || append_policy_violation "${documents[0]}" "InitDeep must verify package inventory and declarations"
    grep -Fq 'does not prove a live host session or MCP connection' "${documents[0]}" || append_policy_violation "${documents[0]}" "InitDeep must not claim live host or MCP connection"
    grep -Fq 'Do not enable optional capabilities' "${documents[0]}" || append_policy_violation "${documents[0]}" "InitDeep must preserve optional capability state"
    if grep -Eqi 'automatically enable optional|auto-enable optional|enables optional capabilities' "${documents[@]}"; then
        append_policy_violation "${documents[0]}" "InitDeep must not claim automatic optional capability activation"
    fi
}

for scan_dir in "${PLUGIN_ROOT}"; do
    [ -d "$scan_dir" ] || continue
    while IFS= read -r -d '' md_file; do
        file_dir="$(dirname "$md_file")"
        while IFS= read -r link; do
            if echo "$link" | grep -qE '^(https?://|mailto:|#)'; then
                continue
            fi
            link_path="${link%%#*}"
            TOTAL=$((TOTAL + 1))
            if [ -z "$link_path" ]; then
                append_broken "$md_file" "$link" "" "empty link target"
                continue
            fi
            resolved="${file_dir}/${link_path}"
            resolved_normalized=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$resolved")
            if [ "$resolved_normalized" != "$PLUGIN_ROOT" ] && [[ "$resolved_normalized" != "$PLUGIN_ROOT/"* ]]; then
                append_broken "$md_file" "$link" "$resolved_normalized" "target escapes plugin root"
            elif [ -e "$resolved_normalized" ]; then
                :
            else
                append_broken "$md_file" "$link" "$resolved_normalized" "target not found"
            fi
        done < <(sed 's/`[^`]*`//g' "$md_file" 2>/dev/null | grep -oE '\[[^]]+\]\([^)]*\)' | sed 's/\[[^]]*\](\(.*\))/\1/' || true)
    done < <(
        find "$scan_dir" -type d -name node_modules -prune -o -name "*.md" -print0 2>/dev/null || true
    )
done

check_active_documentation_policy
check_init_deep_evidence_contract

if [ "$BROKEN_COUNT" -eq 0 ] && [ "$POLICY_COUNT" -eq 0 ]; then
    echo "{\"total_links\":${TOTAL},\"broken\":0,\"broken_links\":[],\"policy_violations\":0}"
    exit 0
else
    echo "{\"total_links\":${TOTAL},\"broken\":${BROKEN_COUNT},\"broken_links\":[${BROKEN}],\"policy_violations\":${POLICY_COUNT},\"policy_details\":[${POLICY_VIOLATIONS}]}"
    exit 1
fi
