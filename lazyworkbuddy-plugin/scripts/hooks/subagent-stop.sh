#!/usr/bin/env bash
# subagent-stop.sh — SubagentStop hook: verify executor evidence before allowing stop.
# LazyCodex source: reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/src/codex-hook.ts
set -euo pipefail

# --- Helper: manage retry attempts (MUST be defined before use) ---
manage_attempts() {
    local cwd="$1" session_id="$2" agent_id="$3" action="$4"
    local state_dir="$cwd/.lazyworkbuddy/executor-verify-state"
    local safe_sid=$(echo "$session_id" | sed 's/[^A-Za-z0-9._-]/-/g')
    local safe_aid=$(echo "$agent_id" | sed 's/[^A-Za-z0-9._-]/-/g')
    local state_file="$state_dir/${safe_sid}-${safe_aid}.json"
    mkdir -p "$state_dir"
    case "$action" in
        increment)
            local attempts=0
            if [ -f "$state_file" ]; then
                attempts=$(python3 -c "import json; print(json.load(open('$state_file')).get('attempts',0))" 2>/dev/null || echo "0")
            fi
            attempts=$((attempts + 1))
            python3 -c "import json; json.dump({'attempts':$attempts}, open('$state_file','w'))" 2>/dev/null
            echo "$attempts"
            ;;
        clear)
            rm -f "$state_file"
            echo "0"
            ;;
        *) echo "0" ;;
    esac
}

INPUT=$(cat)
MAX_ATTEMPTS=3

# --- Context pressure detection ---
for marker in "context compacted" "context_length_exceeded" "skill descriptions were shortened" "context_too_large"; do
    if echo "$INPUT" | grep -qi "$marker"; then exit 0; fi
done

# --- Extract hook fields ---
# WorkBuddy payload uses 'agent_type'; some builds may use 'agent_type_name'. Check both.
AGENT_TYPE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent_type','') or d.get('agent_type_name',''))" 2>/dev/null || echo "")
LAST_MSG=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_assistant_message',''))" 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || echo "unknown")
AGENT_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent_id',''))" 2>/dev/null || echo "unknown")

if [ -z "$CWD" ]; then CWD="$PWD"; fi

# --- Only verify implementer subagents ---
if [ "$AGENT_TYPE" != "lazyworkbuddy-implementer" ] && [ "$AGENT_TYPE" != "implementer" ]; then
    exit 0
fi

if [ -z "$LAST_MSG" ]; then exit 0; fi

# --- Extract EVIDENCE_RECORDED: <path> ---
# Use python3 for reliable extraction (BSD sed doesn't handle \s)
EVIDENCE_PATH=$(python3 -c "
import sys, re
msg = sys.argv[1] if len(sys.argv) > 1 else ''
m = re.search(r'EVIDENCE_RECORDED:\s*(\S+)', msg)
print(m.group(1) if m else '')
" "$LAST_MSG" 2>/dev/null || echo "")

block_with_retry() {
    local reason="$1"
    local att=$(manage_attempts "$CWD" "$SESSION_ID" "$AGENT_ID" "increment")
    if [ "$att" -ge "$MAX_ATTEMPTS" ]; then
        manage_attempts "$CWD" "$SESSION_ID" "$AGENT_ID" "clear"
        exit 0
    fi
    # Correct WorkBuddy contract (per docs/cli/hooks): {"continue":false,"reason":"..."} + exit 0
    # prevents the SubagentStop and surfaces the reason. {"decision":"block"} is DEPRECATED.
    python3 -c "
import json, sys
print(json.dumps({'continue': False, 'reason': f'{sys.argv[1]} (attempt {sys.argv[2]}/{sys.argv[3]})'}))
" "$reason" "$att" "$MAX_ATTEMPTS"
    exit 0
}

if [ -z "$EVIDENCE_PATH" ]; then
    block_with_retry "No EVIDENCE_RECORDED found in implementer output. Please record evidence path before completing."
fi

# --- Resolve evidence path ---
EVIDENCE_PATH="$(echo "$EVIDENCE_PATH" | xargs)"  # Trim whitespace
if [[ "$EVIDENCE_PATH" != /* ]]; then
    EVIDENCE_PATH="$CWD/$EVIDENCE_PATH"
fi
EVIDENCE_ROOT="$CWD/.lazyworkbuddy"

# Get realpaths
REAL_PATH=$(python3 -c "import os; print(os.path.realpath('$EVIDENCE_PATH'))" 2>/dev/null || echo "")
REAL_ROOT=$(python3 -c "import os; print(os.path.realpath('$EVIDENCE_ROOT'))" 2>/dev/null || echo "")

# Check: inside evidence root — use startswith for safety
INSIDE=$(python3 -c "print('yes' if '$REAL_PATH'.startswith('$REAL_ROOT') else 'no')")
if [ "$INSIDE" != "yes" ] || [ -z "$REAL_PATH" ]; then
    block_with_retry "EVIDENCE_RECORDED path is outside .lazyworkbuddy/ — rejected."
fi

# Check: file exists
if [ ! -f "$EVIDENCE_PATH" ]; then
    block_with_retry "EVIDENCE_RECORDED file does not exist: $EVIDENCE_PATH"
fi

# Check: not a symlink
if [ -L "$EVIDENCE_PATH" ]; then
    block_with_retry "EVIDENCE_RECORDED path is a symlink — rejected."
fi

# Check: non-empty
FILE_SIZE=$(stat -f%z "$EVIDENCE_PATH" 2>/dev/null || stat -c%s "$EVIDENCE_PATH" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -le 0 ]; then
    block_with_retry "EVIDENCE_RECORDED file is empty: $EVIDENCE_PATH"
fi

# --- Evidence valid — clear attempts and allow ---
manage_attempts "$CWD" "$SESSION_ID" "$AGENT_ID" "clear"
exit 0
