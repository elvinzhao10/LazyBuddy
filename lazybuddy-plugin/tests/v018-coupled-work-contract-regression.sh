#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-coupled-contract.XXXXXX")"

cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

require_pattern() {
    local file="$1" pattern="$2"
    tr '\n' ' ' < "$file" | grep -Eq "$pattern" || fail "missing required contract text in $(basename "$file"): $pattern"
}

reject_bypass_instruction() {
    local file="$1"
    if grep -Eqi 'coupled[[:space:]]+work.*bypass(es)?[[:space:]]+verification|coupling.*skip(s)?[[:space:]]+verification|DoneClaim alone.*(complete|completion|sufficient)' "$file"; then
        return 1
    fi
}

SKILL="$PLUGIN/skills/lazy-start-work/SKILL.md"
COMMAND="$PLUGIN/commands/lazy-start-work.md"
ORCHESTRATOR="$PLUGIN/agents/lazybuddy-orchestrator.md"
VERIFIER="$PLUGIN/agents/lazybuddy-verifier.md"

for file in "$SKILL" "$COMMAND" "$ORCHESTRATOR"; do
    require_pattern "$file" 'shared mutable interface'
    require_pattern "$file" 'atomic[[:space:]]+fixture'
    require_pattern "$file" 'invalid intermediate state'
    require_pattern "$file" 'coupled: true'
    require_pattern "$file" 'reason'
    require_pattern "$file" 'checkbox/file scope'
    require_pattern "$file" 'parallel decomposition is unsafe'
    require_pattern "$file" 'convenience'
    require_pattern "$file" 'capacity'
    require_pattern "$file" 'generic multi-file'
    require_pattern "$file" 'root product edits'
    require_pattern "$file" 'Manual-QA'
    require_pattern "$file" 'adversarial'
    require_pattern "$file" 'independent verifier'
done

require_pattern "$VERIFIER" 'When a dispatch says `coupled: true`'
require_pattern "$VERIFIER" 'DoneClaim alone is not completion'
require_pattern "$VERIFIER" 'Coupling never waives independent reproduction of tests'

copied_instruction="$TMP/copied-coupled-instruction.md"
printf '%s\n' 'Coupled work bypasses verification when one worker owns multiple files.' > "$copied_instruction"
if reject_bypass_instruction "$copied_instruction"; then
    fail 'copied instruction claiming a coupling verification bypass was accepted'
fi

printf '%s\n' 'A coupled DoneClaim alone is sufficient for completion.' > "$copied_instruction"
if reject_bypass_instruction "$copied_instruction"; then
    fail 'copied instruction claiming DoneClaim-only coupled completion was accepted'
fi

printf '%s\n' 'Coupled work retains independent verification and all normal gates.' > "$copied_instruction"
if ! reject_bypass_instruction "$copied_instruction"; then
    fail 'safe copied instruction was rejected'
fi

echo 'v0.18 coupled-work contract regression: PASS'
