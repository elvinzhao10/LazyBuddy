#!/usr/bin/env bash
# user-prompt-submit.sh — UserPromptSubmit hook: detect Lazyworkbuddy command intent + secret warnings.
# LazyCodex source: dev/reference/lazycodex/plugins/omo/hooks/user-prompt-submit-checking-ultrawork-trigger.json
# Advisory only — always exits 0. Never blocks ordinary prompts.
set -euo pipefail

INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user_prompt','') or d.get('prompt','') or d.get('message',''))" 2>/dev/null || echo "")

if [ -z "$MESSAGE" ]; then
    exit 0
fi

# --- Secret detection ---
if echo "$MESSAGE" | grep -qE 'sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._/+=]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghr_[A-Za-z0-9]{20,}'; then
    echo "[Lazyworkbuddy WARNING] Your prompt may contain a secret (API key, token, or credential). Consider redacting it before sending."
fi

# --- Long-horizon work detection without command ---
# Check if user describes multi-step work but didn't use a Lazyworkbuddy command
KEYWORDS=("implement" "build" "create.*app" "migrate" "refactor" "setup" "deploy" "fix all" "fix multiple")
COMMANDS=("/lazy-ultrawork" "/lazy-ulw-loop" "/lazy-ulw-plan" "/lazy-start-work")

HAS_KEYWORD=0
for kw in "${KEYWORDS[@]}"; do
    if echo "$MESSAGE" | grep -qi "$kw"; then
        HAS_KEYWORD=1
        break
    fi
done

if [ "$HAS_KEYWORD" -eq 1 ]; then
    HAS_CMD=0
    for cmd in "${COMMANDS[@]}"; do
        if echo "$MESSAGE" | grep -qF "$cmd"; then
            HAS_CMD=1
            break
        fi
    done
    if [ "$HAS_CMD" -eq 0 ]; then
        echo "[Lazyworkbuddy TIP] Long-horizon task detected. Consider starting with /lazy-ultrawork for structured planning and execution."
    fi
fi

exit 0
