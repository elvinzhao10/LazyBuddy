#!/usr/bin/env bash
# pre-tool-use.sh — PreToolUse hook: block dangerous operations, enforce deny/ask rules.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/pre-tool-use-enforcing-unlimited-goal-budget.json
# Complements: .workbuddy/settings.json deny/ask patterns
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")
TOOL_INPUT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tool_input',{})))" 2>/dev/null || echo "{}")

# --- DENY: Secret-like paths ---
SECRET_PATTERNS=(
    '.env' '.env.local' '.env.production' '.env.staging'
    'credentials.json' 'service-account.json' 'private.key' 'id_rsa'
    '.aws/credentials' '.ssh/id_' '.netrc' '.npmrc'
    'secrets.yml' 'secrets.yaml' 'config/secrets'
)

for pattern in "${SECRET_PATTERNS[@]}"; do
    if echo "$TOOL_INPUT" | grep -qF "$pattern"; then
        echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Access to secret-like path blocked: '"$pattern"'. Treat as DENY per .workbuddy/settings.json secret patterns."}}'
        exit 0
    fi
done

# --- DENY: Destructive deletes ---
if [ "$TOOL_NAME" = "Bash" ]; then
    if echo "$TOOL_INPUT" | grep -qE 'rm\s+-rf?\s+/|rm\s+-rf?\s+\$HOME|rm\s+-rf?\s+~/'; then
        echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive recursive delete denied. ASK per .workbuddy/settings.json — destructive operations require explicit confirmation."}}'
        exit 0
    fi
fi

# --- DENY: Force push / hard reset ---
if echo "$TOOL_INPUT" | grep -qE 'git\s+push\s+--force|git\s+reset\s+--hard'; then
    echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive git operation denied. ASK per .workbuddy/settings.json — requires explicit user confirmation."}}'
    exit 0
fi

# --- DENY: Publishing / deployment (unapproved network writes) ---
if echo "$TOOL_INPUT" | grep -qE 'npm\s+publish|pip\s+upload|docker\s+push'; then
    echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"External publish operation denied. ASK per .workbuddy/settings.json — requires approval."}}'
    exit 0
fi

# --- Allow: safe operations pass through ---
exit 0
