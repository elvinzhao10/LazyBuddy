#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
PACKAGE_SOURCE_ROOT="$(CDPATH= cd -- "$PLUGIN_ROOT/.." && pwd -P)"
source "$PLUGIN_ROOT/tests/helpers/v102-workbuddy-package-preparation-support.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-workbuddy-preparation.XXXXXX")"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

if [ ! -f "$PACKAGE_SOURCE_ROOT/.codebuddy-plugin/marketplace.json" ]; then
    PACKAGE_SOURCE_ROOT="$TMP/source release"
    mkdir -p "$PACKAGE_SOURCE_ROOT/.codebuddy-plugin"
    cp -R "$PLUGIN_ROOT" "$PACKAGE_SOURCE_ROOT/lazybuddy-plugin"
    printf '%s\n' \
        '{' \
        '  "name": "lazybuddy",' \
        '  "plugins": [' \
        '    {"name": "lazybuddy", "source": "./lazybuddy-plugin", "version": "1.2.0"}' \
        '  ]' \
        '}' > "$PACKAGE_SOURCE_ROOT/.codebuddy-plugin/marketplace.json"
fi

SPACE_RELEASE="$TMP/package copies/Lazy Buddy v1.2.0"
PROJECT_ROOT="$TMP/consumer projects/Project With Spaces"$'\nHOST_READINESS=ready'
FIXTURE_HOME="$TMP/Home With Spaces"
mkdir -p "$(dirname -- "$SPACE_RELEASE")" "$PROJECT_ROOT" "$FIXTURE_HOME/.workbuddy/plugins"
cp -R "$PACKAGE_SOURCE_ROOT" "$SPACE_RELEASE"
SPACE_RELEASE="$(CDPATH= cd -- "$SPACE_RELEASE" && pwd -P)"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT" && pwd -P)"
FIXTURE_HOME="$(CDPATH= cd -- "$FIXTURE_HOME" && pwd -P)"
CHECK="$SPACE_RELEASE/lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh"

REGISTRY="$FIXTURE_HOME/.workbuddy/plugins/installed_plugins.json"
printf '%s\n' '{"foreign":{"preserve":true}}' > "$REGISTRY"
v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.before"

mkdir -p "$TMP/unrelated cwd"
if (
    cd "$TMP/unrelated cwd"
    HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$PROJECT_ROOT"
) > "$TMP/check-first.out" 2> "$TMP/check-first.err" \
    && grep -Fq 'MCP_RENDER_JSON=' "$TMP/check-first.out" \
    && grep -Fq 'PACKAGE_PREPARATION=ready' "$TMP/check-first.out"; then
    pass 'spaced copied release self-locates from an arbitrary cwd'
else
    fail 'spaced copied release self-locates from an arbitrary cwd'
fi

if v102_assert_workbuddy_plan \
    "$TMP/check-first.out" "$SPACE_RELEASE/lazybuddy-plugin" "$PROJECT_ROOT" "$FIXTURE_HOME"
then
    pass 'machine-readable MCP plan and paths contain six exact absolute hostile-path entries'
else
    fail 'machine-readable MCP plan and paths contain six exact absolute hostile-path entries'
fi

if v102_assert_workbuddy_statuses "$TMP/check-first.out"; then
    pass 'host lifecycle statuses are exact and newline paths cannot forge readiness'
else
    fail 'host lifecycle statuses are exact and newline paths cannot forge readiness'
fi

if (
    cd "$TMP/unrelated cwd"
    HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$PROJECT_ROOT"
) > "$TMP/check-second.out" 2> "$TMP/check-second.err" \
    && cmp -s "$TMP/check-first.out" "$TMP/check-second.out"; then
    pass 'read-only preparation check repeats deterministically'
else
    fail 'read-only preparation check repeats deterministically'
fi

v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.after-check"
if v102_fixture_tree_matches "$TMP/home.before" "$TMP/home.after-check"; then
    pass 'read-only preparation check preserves all fixture host state'
else
    fail 'read-only preparation check preserves all fixture host state'
fi

if HOME="$FIXTURE_HOME" bash "$CHECK" --apply --project-dir "$PROJECT_ROOT" \
    > "$TMP/apply.out" 2> "$TMP/apply.err"; then
    fail 'unsupported apply mode is rejected'
elif [ "$?" -eq 2 ] \
    && grep -Eiq 'installed_plugins\.json.*private|private.*installed_plugins\.json' "$TMP/apply.err"; then
    pass 'unsupported apply mode is rejected with the private-schema blocker'
else
    fail 'unsupported apply mode reports the private-schema blocker'
fi

v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.after-apply"
if v102_fixture_tree_matches "$TMP/home.before" "$TMP/home.after-apply"; then
    pass 'rejected apply mode preserves all fixture host state'
else
    fail 'rejected apply mode preserves all fixture host state'
fi

ORPHAN="$TMP/orphaned helper/scripts"
mkdir -p "$ORPHAN"
cp "$CHECK" "$ORPHAN/lazybuddy-workbuddy-preparation-check.sh"
if env -u HOME bash "$ORPHAN/lazybuddy-workbuddy-preparation-check.sh" \
    --apply --help > "$TMP/apply-help.out" 2> "$TMP/apply-help.err"; then
    fail 'apply before help is refused before host and package access'
elif [ "$?" -eq 2 ] \
    && grep -Eiq 'installed_plugins\.json.*private|private.*installed_plugins\.json' "$TMP/apply-help.err" \
    && ! grep -Eiq 'HOME|project root|plugin root' "$TMP/apply-help.err"; then
    pass 'apply before help is refused before host and package access'
else
    fail 'apply before help is refused before host and package access'
fi

if env -u HOME bash "$ORPHAN/lazybuddy-workbuddy-preparation-check.sh" \
    --help --apply > "$TMP/help-apply.out" 2> "$TMP/help-apply.err"; then
    fail 'apply after help is refused before host and package access'
elif [ "$?" -eq 2 ] \
    && grep -Eiq 'installed_plugins\.json.*private|private.*installed_plugins\.json' "$TMP/help-apply.err" \
    && ! grep -Eiq 'HOME|project root|plugin root' "$TMP/help-apply.err"; then
    pass 'apply after help is refused before host and package access'
else
    fail 'apply after help is refused before host and package access'
fi

if env -u HOME bash "$ORPHAN/lazybuddy-workbuddy-preparation-check.sh" \
    --apply --project-dir "$TMP/missing project" \
    > "$TMP/apply-order.out" 2> "$TMP/apply-order.err"; then
    fail 'apply refusal precedes HOME, project, and package access'
elif [ "$?" -eq 2 ] \
    && grep -Eiq 'installed_plugins\.json.*private|private.*installed_plugins\.json' "$TMP/apply-order.err" \
    && ! grep -Eiq 'HOME|project root|plugin root' "$TMP/apply-order.err"; then
    pass 'apply refusal precedes HOME, project, and package access'
else
    fail 'apply refusal precedes HOME, project, and package access'
fi

ATTACK_SECRET='supersecret-workbuddy-marker'
cp "$SPACE_RELEASE/lazybuddy-plugin/.mcp.json" "$TMP/mcp.clean.json"
v102_inject_hostile_mcp_metadata \
    "$SPACE_RELEASE/lazybuddy-plugin/.mcp.json" "$ATTACK_SECRET"
if HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$PROJECT_ROOT" \
    > "$TMP/hostile-metadata.out" 2> "$TMP/hostile-metadata.err"; then
    fail 'hostile MCP environment metadata is rejected without disclosure'
elif [ "$?" -ne 0 ] \
    && grep -Eiq 'MCP server run-ledger.*(fields|env|metadata)' "$TMP/hostile-metadata.err" \
    && ! grep -Fq "$ATTACK_SECRET" "$TMP/hostile-metadata.out" \
    && ! grep -Fq "$ATTACK_SECRET" "$TMP/hostile-metadata.err"; then
    pass 'hostile MCP environment metadata is rejected without disclosure'
else
    fail 'hostile MCP environment metadata is rejected without disclosure'
fi

cp "$TMP/mcp.clean.json" "$SPACE_RELEASE/lazybuddy-plugin/.mcp.json"
RUN_LEDGER_LAUNCHER="$SPACE_RELEASE/lazybuddy-plugin/mcp/run-ledger/server.sh"
mv "$RUN_LEDGER_LAUNCHER" "$TMP/run-ledger-server.original"
ln -s '../verification/server.sh' "$RUN_LEDGER_LAUNCHER"
v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.before-symlink"
if HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$PROJECT_ROOT" \
    > "$TMP/symlink-launcher.out" 2> "$TMP/symlink-launcher.err"; then
    SYMLINK_RC=0
else
    SYMLINK_RC=$?
fi
v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.after-symlink"
if [ "$SYMLINK_RC" -ne 0 ] \
    && grep -Eiq 'MCP server run-ledger.*(symlink|non-symlink)' "$TMP/symlink-launcher.err" \
    && ! grep -Fq 'MCP_RENDER_JSON=' "$TMP/symlink-launcher.out" \
    && ! grep -Fq 'MCP_RENDER_JSON=' "$TMP/symlink-launcher.err" \
    && v102_fixture_tree_matches "$TMP/home.before-symlink" "$TMP/home.after-symlink"; then
    pass 'internal launcher symlink is rejected without rendering or host mutation'
else
    fail 'internal launcher symlink is rejected without rendering or host mutation'
fi

rm "$RUN_LEDGER_LAUNCHER"
RUN_LEDGER_DIRECTORY="$SPACE_RELEASE/lazybuddy-plugin/mcp/run-ledger"
mv "$RUN_LEDGER_DIRECTORY" "$TMP/run-ledger-directory.original"
ln -s '../mcp/verification' "$RUN_LEDGER_DIRECTORY"
v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.before-parent-symlink"
if HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$PROJECT_ROOT" \
    > "$TMP/parent-symlink.out" 2> "$TMP/parent-symlink.err"; then
    PARENT_SYMLINK_RC=0
else
    PARENT_SYMLINK_RC=$?
fi
v102_snapshot_fixture_tree "$FIXTURE_HOME" "$TMP/home.after-parent-symlink"
if [ "$PARENT_SYMLINK_RC" -ne 0 ] \
    && grep -Eiq 'MCP server run-ledger.*symlink' "$TMP/parent-symlink.err" \
    && ! grep -Fq 'MCP_RENDER_JSON=' "$TMP/parent-symlink.out" \
    && ! grep -Fq 'MCP_RENDER_JSON=' "$TMP/parent-symlink.err" \
    && v102_fixture_tree_matches \
        "$TMP/home.before-parent-symlink" "$TMP/home.after-parent-symlink"; then
    pass 'symlinked launcher parent is rejected without rendering or host mutation'
else
    fail 'symlinked launcher parent is rejected without rendering or host mutation'
fi

if HOME="$FIXTURE_HOME" bash "$ORPHAN/lazybuddy-workbuddy-preparation-check.sh" \
    --project-dir "$PROJECT_ROOT" > "$TMP/orphan.out" 2> "$TMP/orphan.err"; then
    fail 'orphaned helper rejects a missing plugin root'
elif grep -Eiq 'plugin root.*unavailable|keep.*scripts.*lazybuddy-plugin' "$TMP/orphan.err"; then
    pass 'orphaned helper rejects a missing plugin root actionably'
else
    fail 'orphaned helper reports a missing plugin root actionably'
fi

MISSING_INJECTION="$TMP/missing project"$'\nHOST_READINESS=ready'
if HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$MISSING_INJECTION" \
    > "$TMP/missing-injection.out" 2> "$TMP/missing-injection.err"; then
    fail 'newline-bearing missing project cannot forge readiness errors'
elif [ "$?" -eq 1 ] \
    && grep -Eiq 'project root.*(missing|directory)' "$TMP/missing-injection.err" \
    && ! grep -Fqx 'HOST_READINESS=ready' "$TMP/missing-injection.out" \
    && ! grep -Fqx 'HOST_READINESS=ready' "$TMP/missing-injection.err"; then
    pass 'newline-bearing missing project cannot forge readiness errors'
else
    fail 'newline-bearing missing project cannot forge readiness errors'
fi

UNKNOWN_INJECTION=$'--unknown\nHOST_MUTATION=changed'
if HOME="$FIXTURE_HOME" bash "$CHECK" "$UNKNOWN_INJECTION" \
    > "$TMP/unknown-injection.out" 2> "$TMP/unknown-injection.err"; then
    fail 'newline-bearing unknown argument cannot forge mutation errors'
elif [ "$?" -eq 2 ] \
    && grep -Eiq 'unknown argument' "$TMP/unknown-injection.err" \
    && ! grep -Fqx 'HOST_MUTATION=changed' "$TMP/unknown-injection.out" \
    && ! grep -Fqx 'HOST_MUTATION=changed' "$TMP/unknown-injection.err"; then
    pass 'newline-bearing unknown argument cannot forge mutation errors'
else
    fail 'newline-bearing unknown argument cannot forge mutation errors'
fi

if HOME="$FIXTURE_HOME" bash "$CHECK" --project-dir "$TMP/missing project" \
    > "$TMP/missing-project.out" 2> "$TMP/missing-project.err"; then
    fail 'missing project root is rejected'
elif grep -Eiq 'project root.*(missing|directory)' "$TMP/missing-project.err"; then
    pass 'missing project root is rejected actionably'
else
    fail 'missing project root reports an actionable error'
fi

printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "$FAIL"
[ "$FAIL" -eq 0 ]
