#!/bin/bash
set -euo pipefail

if [ -n "${LAZYBUDDY_DOCUMENTATION_ROOT:-}" ]; then
  PROJECT_ROOT="${LAZYBUDDY_DOCUMENTATION_ROOT}"
  PLUGIN_ROOT="${PROJECT_ROOT}/lazybuddy-plugin"
else
  PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  PROJECT_ROOT="$(cd "${PLUGIN_ROOT}/.." && pwd)"
fi
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

require_heading() {
  local file="$1"
  local heading="$2"
  grep -Fqx "## ${heading}" "$file" || {
    echo "missing heading: ${heading} (${file})" >&2
    return 1
  }
}

for file in "${PROJECT_ROOT}/lazybuddy-evaluation.md" "${PROJECT_ROOT}/docs/handoff.md"; do
  for heading in "${required_headings[@]}"; do
    require_heading "$file" "$heading"
  done
  grep -Eq 'host-ready.*owned-ready.*missing.*incompatible.*disabled.*failed-optional.*not-initialized' "$file"
  grep -Fq 'Normal CI is self-contained' "$file"
  grep -Fq 'release-only' "$file"
  grep -Eq 'does not.*activate.*provider|without.*enabling|as enabling a provider' "$file"
  grep -Eq 'Host registrations are removed manually through the host|host registrations survive' "$file"
done

grep -Fq 'package readiness' "${PROJECT_ROOT}/AGENTS.md"
grep -Fq 'manual MCP' "${PROJECT_ROOT}/AGENTS.md"
grep -Fq '8 local MCP server declarations' "${PLUGIN_ROOT}/README.md"
grep -Fq '.lazybuddy/' "${PROJECT_ROOT}/lazybuddy-evaluation.md"
grep -Fq 'CodeBuddy/WorkBuddy-specific layouts and commands' "${PROJECT_ROOT}/lazybuddy-evaluation.md"
grep -Fq 'filesystem or Playwright MCP servers' "${PROJECT_ROOT}/lazybuddy-evaluation.md"
grep -Fq 'macOS only' "${PROJECT_ROOT}/lazybuddy-evaluation.md"

echo 'v0.17 documentation regression: PASS'
