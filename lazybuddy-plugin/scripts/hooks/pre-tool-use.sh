#!/usr/bin/env bash
# pre-tool-use.sh — PreToolUse hook: block dangerous operations, enforce deny/ask rules.
# Applies LazyBuddy's host-neutral deny/ask policy.
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

if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    STRUCTURED_SECRET_PATTERN=$(printf '%s' "$INPUT" | python3 -c '
import json
import sys

try:
    event = json.load(sys.stdin)
    tool_input = event.get("tool_input")
except (json.JSONDecodeError, AttributeError):
    tool_input = None

if not isinstance(tool_input, dict):
    raise SystemExit(0)

patterns = (
    ".env", ".env.local", ".env.production", ".env.staging",
    "credentials.json", "service-account.json", "private.key", "id_rsa",
    ".aws/credentials", ".ssh/id_", ".netrc", ".npmrc",
    "secrets.yml", "secrets.yaml", "config/secrets",
)

def components(path):
    normalized = []
    for component in path.replace("\\", "/").split("/"):
        if not component or component == ".":
            continue
        if component == "..":
            if normalized:
                normalized.pop()
            continue
        normalized.append(component)
    return normalized

def matches(path_components, pattern):
    pattern_components = pattern.split("/")
    limit = len(path_components) - len(pattern_components) + 1
    for start in range(max(limit, 0)):
        candidate = path_components[start:start + len(pattern_components)]
        if all(
            actual.startswith(expected) if expected == "id_" else actual == expected
            for actual, expected in zip(candidate, pattern_components)
        ):
            return True
    return False

for field in ("path", "file_path", "filePath", "filename", "fileName"):
    value = tool_input.get(field)
    if not isinstance(value, str):
        continue
    path_components = components(value)
    for pattern in patterns:
        if matches(path_components, pattern):
            print(pattern)
            raise SystemExit(0)
' 2>/dev/null || true)
    if [ -n "$STRUCTURED_SECRET_PATTERN" ]; then
        echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Access to secret-like path blocked: '"$STRUCTURED_SECRET_PATTERN"'. LazyBuddy secret policy denies this operation."}}'
        exit 0
    fi
else
    for pattern in "${SECRET_PATTERNS[@]}"; do
        if echo "$TOOL_INPUT" | grep -qF "$pattern"; then
            echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Access to secret-like path blocked: '"$pattern"'. LazyBuddy secret policy denies this operation."}}'
            exit 0
        fi
    done
fi

# --- DENY: Destructive deletes ---
if [ "$TOOL_NAME" = "Bash" ]; then
    DESTRUCTIVE_DELETE=$(printf '%s' "$INPUT" | python3 -c '
import json
import shlex
import sys

try:
    event = json.load(sys.stdin)
    tool_input = event.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
except (json.JSONDecodeError, AttributeError):
    command = None

if not isinstance(command, str):
    raise SystemExit(0)

try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    lexer.commenters = ""
    tokens = list(lexer)
except ValueError:
    # An unparseable shell literal cannot be proven safe at this policy boundary.
    print("deny")
    raise SystemExit(0)

def dangerous_operand(token):
    # shlex has already removed shell quotes, but deliberately leaves variable
    # and tilde expansion text intact for this literal-only policy.
    return (
        token.startswith("/")
        or token == "~"
        or token.startswith("~/")
        or token == "$HOME"
        or token.startswith("$HOME/")
        or token == "${HOME}"
        or token.startswith("${HOME}/")
        or ".." in token.replace("\\", "/").split("/")
    )

for start, token in enumerate(tokens):
    if token != "rm":
        continue

    recursive = False
    options = True
    for operand in tokens[start + 1:]:
        if operand and all(char in ";&|" for char in operand):
            break
        if options and operand == "--":
            options = False
            continue
        if options and operand.startswith("-") and operand != "-":
            if operand == "--recursive" or (not operand.startswith("--") and ("r" in operand[1:] or "R" in operand[1:])):
                recursive = True
            continue
        options = False
        if recursive and dangerous_operand(operand):
            print("deny")
            raise SystemExit(0)
' 2>/dev/null || true)
    if [ -n "$DESTRUCTIVE_DELETE" ]; then
        echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive recursive delete denied. LazyBuddy policy requires explicit confirmation."}}'
        exit 0
    fi
fi

# --- DENY: Force push / hard reset ---
if echo "$TOOL_INPUT" | grep -qE 'git\s+push\s+--force|git\s+reset\s+--hard'; then
    echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive git operation denied. LazyBuddy policy requires explicit user confirmation."}}'
    exit 0
fi

# --- DENY: Publishing / deployment (unapproved network writes) ---
if echo "$TOOL_INPUT" | grep -qE 'npm\s+publish|pip\s+upload|docker\s+push'; then
    echo '{"continue":false,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"External publish operation denied. LazyBuddy policy requires approval."}}'
    exit 0
fi

# --- Allow: safe operations pass through ---
exit 0
