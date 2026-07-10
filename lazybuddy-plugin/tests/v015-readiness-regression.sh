#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-readiness.XXXXXX")"
PASS=0
FAIL=0

cleanup() {
    rm -rf "$TMP"
}

trap cleanup EXIT

pass() {
    echo "PASS $1"
    PASS=$((PASS + 1))
}

fail() {
    echo "FAIL $1" >&2
    FAIL=$((FAIL + 1))
}

expect_status() {
    local label="$1"
    local expected="$2"
    shift 2
    local output status
    if output=$("$@" 2>&1); then
        status=0
    else
        status=$?
    fi
    if [ "$status" -ne "$expected" ]; then
        fail "$label (exit $status, expected $expected): ${output:0:160}"
        return
    fi
    printf '%s\n' "$output" > "$TMP/${label}.out"
    pass "$label"
}

expect_contains() {
    local label="$1"
    local pattern="$2"
    if grep -qE "$pattern" "$TMP/${label}.out"; then
        pass "$label output"
    else
        fail "$label missing '$pattern'"
    fi
}

cp -R "$PLUGIN_ROOT" "$TMP/installed-plugin"
INSTALLED_PLUGIN="$(cd "$TMP/installed-plugin" && pwd)"

expect_status full-package-readiness 0 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-load-check.sh"
expect_contains full-package-readiness '^PACKAGE_READINESS=full$'

printf '{invalid json\n' > "$INSTALLED_PLUGIN/.workbuddy-plugin/plugin.json"
expect_status invalid-workbuddy-manifest 1 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-load-check.sh"
expect_contains invalid-workbuddy-manifest '^FAIL WorkBuddy manifest: invalid JSON'
expect_status doctor-catches-invalid-workbuddy-manifest 1 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-plugin-doctor.sh"
expect_contains doctor-catches-invalid-workbuddy-manifest 'WorkBuddy manifest is valid JSON'

cp "$PLUGIN_ROOT/.workbuddy-plugin/plugin.json" "$INSTALLED_PLUGIN/.workbuddy-plugin/plugin.json"
printf '{invalid json\n' > "$INSTALLED_PLUGIN/.codebuddy-plugin/plugin.json"
expect_status doctor-catches-validator-failure 1 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-plugin-doctor.sh"
if command -v codebuddy >/dev/null 2>&1; then
    expect_contains doctor-catches-validator-failure 'CodeBuddy manifest validator'
fi
cp "$PLUGIN_ROOT/.codebuddy-plugin/plugin.json" "$INSTALLED_PLUGIN/.codebuddy-plugin/plugin.json"

python3 - "$INSTALLED_PLUGIN/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["skills"] = "./skills/"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
expect_status doctor-catches-validator-text-failure 1 env CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-plugin-doctor.sh"
expect_contains doctor-catches-validator-text-failure 'CodeBuddy manifest validator'
cp "$PLUGIN_ROOT/.codebuddy-plugin/plugin.json" "$INSTALLED_PLUGIN/.codebuddy-plugin/plugin.json"

printf '%s\n' '{"plugins":[{"name":"lazybuddy","version":"0.0.0"}]}' > "$TMP/mismatched-marketplace.json"
expect_status mismatched-marketplace-version 1 env LAZYBUDDY_MARKETPLACE_FILE="$TMP/mismatched-marketplace.json" bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh"
expect_contains mismatched-marketplace-version '^FAIL marketplace version agreement:'

mkdir -p "$TMP/manual-skills/skills/lazy-manual"
printf '%s\n' '---' 'name: lazy-manual' '---' '# manual' > "$TMP/manual-skills/skills/lazy-manual/SKILL.md"
expect_status manual-skill-only-readiness 0 env CODEBUDDY_PLUGIN_ROOT="$TMP/manual-skills" bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh"
expect_contains manual-skill-only-readiness '^PACKAGE_READINESS=degraded$'
expect_contains manual-skill-only-readiness '^UNCHECKED commands/hooks/MCP:'

rm -rf "$TMP/installed-plugin"
cp -R "$PLUGIN_ROOT" "$TMP/installed-plugin"
INSTALLED_PLUGIN="$(cd "$TMP/installed-plugin" && pwd)"
expect_status installed-root-mcp 0 env CWD="$PROJECT_ROOT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-mcp-test.sh"
expect_contains installed-root-mcp "Plugin root: $INSTALLED_PLUGIN"
expect_contains installed-root-mcp '^Passed: 22$'
expect_status installed-root-master-verify 0 env CWD="$PROJECT_ROOT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/lazybuddy-verify.sh"
expect_contains installed-root-master-verify '"all_pass":true'

expect_status missing-plugin-root-pipeline 1 env CWD="$TMP/workspace" CODEBUDDY_PLUGIN_ROOT="$TMP/missing-plugin" bash "$PLUGIN_ROOT/scripts/hook-pipeline-test.sh"
expect_contains missing-plugin-root-pipeline 'plugin root is missing'

cp -R "$PLUGIN_ROOT" "$TMP/broken-hook-plugin"
printf '%s\n' '#!/usr/bin/env bash' 'exit 9' > "$TMP/broken-hook-plugin/scripts/hooks/user-prompt-submit.sh"
chmod +x "$TMP/broken-hook-plugin/scripts/hooks/user-prompt-submit.sh"
expect_status hook-exit-propagates 1 env CWD="$TMP/workspace" CODEBUDDY_PLUGIN_ROOT="$TMP/broken-hook-plugin" bash "$TMP/broken-hook-plugin/scripts/hook-pipeline-test.sh"
expect_contains hook-exit-propagates 'user-prompt-submit.sh — exited 9'

cp -R "$PLUGIN_ROOT" "$TMP/noisy-hook-plugin"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\\n" noisy-hook-output' > "$TMP/noisy-hook-plugin/scripts/hooks/user-prompt-submit.sh"
chmod +x "$TMP/noisy-hook-plugin/scripts/hooks/user-prompt-submit.sh"
expect_status hook-empty-output-propagates 1 env CWD="$TMP/workspace" CODEBUDDY_PLUGIN_ROOT="$TMP/noisy-hook-plugin" bash "$TMP/noisy-hook-plugin/scripts/hook-pipeline-test.sh"
expect_contains hook-empty-output-propagates 'user-prompt-submit.sh — expected empty output, got: noisy-hook-output'

printf '{invalid json\n' > "$INSTALLED_PLUGIN/.workbuddy-plugin/plugin.json"
mkdir -p "$TMP/workspace"
expect_status failed-session-start 1 bash -c "printf '%s\\n' '{\"event\":\"session_start\",\"cwd\":\"$TMP/workspace\"}' | CODEBUDDY_PLUGIN_ROOT='$INSTALLED_PLUGIN' bash '$INSTALLED_PLUGIN/scripts/hooks/session-start.sh'"
expect_contains failed-session-start '^SESSIONSTART_READINESS=failed reason=package-readiness-failed$'

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
