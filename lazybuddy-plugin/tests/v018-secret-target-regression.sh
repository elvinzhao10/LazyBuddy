#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$PLUGIN_ROOT/scripts/hooks/pre-tool-use.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

run_hook() {
    local payload="$1"
    set +e
    HOOK_OUTPUT=$(printf '%s' "$payload" | bash "$HOOK")
    HOOK_STATUS=$?
    set -e
}

expect_allowed() {
    local label="$1"
    local payload="$2"
    run_hook "$payload"
    [ "$HOOK_STATUS" -eq 0 ] || fail "$label exited $HOOK_STATUS"
    [ -z "$HOOK_OUTPUT" ] || fail "$label was denied: $HOOK_OUTPUT"
}

expect_denied() {
    local label="$1"
    local payload="$2"
    run_hook "$payload"
    [ "$HOOK_STATUS" -eq 0 ] || fail "$label exited $HOOK_STATUS"
    [ -n "$HOOK_OUTPUT" ] || fail "$label was allowed"
    python3 - "$HOOK_OUTPUT" <<'PY'
import json
import sys

result = json.loads(sys.argv[1])
assert result['continue'] is False
assert result['hookSpecificOutput']['permissionDecision'] == 'deny'
assert 'secret-like path blocked' in result['hookSpecificOutput']['permissionDecisionReason']
PY
}

expect_destructive_delete_denied() {
    local label="$1"
    local payload="$2"
    run_hook "$payload"
    [ "$HOOK_STATUS" -eq 0 ] || fail "$label exited $HOOK_STATUS"
    [ -n "$HOOK_OUTPUT" ] || fail "$label was allowed"
    python3 - "$HOOK_OUTPUT" <<'PY'
import json
import sys

result = json.loads(sys.argv[1])
assert result['continue'] is False
assert result['hookSpecificOutput']['permissionDecision'] == 'deny'
assert 'Destructive recursive delete denied' in result['hookSpecificOutput']['permissionDecisionReason']
PY
}

expect_allowed content-literals '{"tool_name":"Write","tool_input":{"path":"docs/environment.md","content":"Mention .env, .npmrc, and id_rsa here."}}'
expect_allowed edit-replacement-literals '{"tool_name":"Edit","tool_input":{"file_path":"docs/environment.md","old_string":".env","new_string":"Use .npmrc before id_rsa."}}'
expect_allowed description-literal '{"tool_name":"Write","tool_input":{"filePath":"docs/environment.md","description":"document credentials.json"}}'

expect_denied path-env '{"tool_name":"Write","tool_input":{"path":".env"}}'
expect_denied file-path-env-local '{"tool_name":"Edit","tool_input":{"file_path":"config/.env.local"}}'
expect_denied file-path-camel-credentials '{"tool_name":"Write","tool_input":{"filePath":"credentials.json"}}'
expect_denied backslash-target '{"tool_name":"Edit","tool_input":{"path":"secrets\\credentials.json"}}'
expect_denied traversal-target '{"tool_name":"Write","tool_input":{"path":"docs/../.env"}}'
expect_denied repeated-separator-target '{"tool_name":"Edit","tool_input":{"path":"docs///../credentials.json"}}'

expect_denied filename-env '{"tool_name":"Write","tool_input":{"filename":".env"}}'
expect_denied filename-traversal '{"tool_name":"Write","tool_input":{"filename":"docs/../.env"}}'
expect_denied file-name-camel-credentials '{"tool_name":"Edit","tool_input":{"fileName":"credentials.json"}}'
expect_allowed nested-field '{"tool_name":"Edit","tool_input":{"metadata":{"path":".env"}}}'
expect_allowed non-string-path '{"tool_name":"Write","tool_input":{"path":{"value":".env"}}}'
expect_allowed malformed-tool-input '{"tool_name":"Edit","tool_input":[".env"]}'

expect_denied bash-literal-secret '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}'

expect_destructive_delete_denied bash-root-single-quoted '{"tool_name":"Bash","tool_input":{"command":"rm -rf '\''/'\''"}}'
expect_destructive_delete_denied bash-home-double-quoted '{"tool_name":"Bash","tool_input":{"command":"rm -rf \"$HOME\""}}'
expect_destructive_delete_denied bash-home-braced-quoted '{"tool_name":"Bash","tool_input":{"command":"rm -rf \"${HOME}\""}}'
expect_destructive_delete_denied bash-root-after-options '{"tool_name":"Bash","tool_input":{"command":"rm -rf -- \"/\""}}'
expect_destructive_delete_denied bash-relative-traversal '{"tool_name":"Bash","tool_input":{"command":"rm --recursive ../"}}'
expect_destructive_delete_denied bash-malformed-shell '{"tool_name":"Bash","tool_input":{"command":"rm -rf \"/"}}'
expect_allowed bash-content-literal '{"tool_name":"Bash","tool_input":{"command":"printf '\''rm -rf /'\''"}}'

expect_denied repeat-denied '{"tool_name":"Write","tool_input":{"path":".env"}}'
expect_allowed repeat-allowed '{"tool_name":"Write","tool_input":{"path":"docs/environment.md","content":".env"}}'

echo 'v0.18 secret target regression: PASS'
