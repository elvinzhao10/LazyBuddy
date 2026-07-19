#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
REPOSITORY_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-local-route.XXXXXX")"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }

if python3 - "$REPOSITORY_ROOT" <<'PY'
from pathlib import Path
import json
import sys

repository_root = Path(sys.argv[1])
version = "1.0.2"
marketplace = json.loads((repository_root / ".codebuddy-plugin/marketplace.json").read_text(encoding="utf-8"))
codebuddy = json.loads((repository_root / "lazybuddy-plugin/.codebuddy-plugin/plugin.json").read_text(encoding="utf-8"))
workbuddy = json.loads((repository_root / "lazybuddy-plugin/.workbuddy-plugin/plugin.json").read_text(encoding="utf-8"))
assert marketplace["name"] == "lazybuddy"
entry = next(item for item in marketplace["plugins"] if item.get("name") == "lazybuddy")
assert entry["version"] == version
assert entry["source"] == "./lazybuddy-plugin"
assert codebuddy["name"] == workbuddy["name"] == "lazybuddy"
assert codebuddy["version"] == workbuddy["version"] == version
assert (repository_root / entry["source"] / ".codebuddy-plugin/plugin.json").is_file()
assert (repository_root / "lazybuddy-plugin/.workbuddy-plugin/plugin.json").is_file()
PY
then
    pass 'release marketplace maps lazybuddy to the package root and versions agree'
else
    fail 'release marketplace maps lazybuddy to the package root and versions agree'
fi

RELEASE_ROOT="$TMP/Lazy Buddy"
mkdir -p "$RELEASE_ROOT/.codebuddy-plugin"
cp -R "$REPOSITORY_ROOT/lazybuddy-plugin" "$RELEASE_ROOT/lazybuddy-plugin"
cp "$REPOSITORY_ROOT/.codebuddy-plugin/marketplace.json" "$RELEASE_ROOT/.codebuddy-plugin/marketplace.json"
if python3 - "$RELEASE_ROOT" <<'PY'
from pathlib import Path
import json
import sys

release_root = Path(sys.argv[1])
marketplace = json.loads((release_root / ".codebuddy-plugin/marketplace.json").read_text(encoding="utf-8"))
entry = next(item for item in marketplace["plugins"] if item["name"] == "lazybuddy")
source = (release_root / entry["source"]).resolve()
assert source == (release_root / "lazybuddy-plugin").resolve()
json.loads((source / ".codebuddy-plugin/plugin.json").read_text(encoding="utf-8"))
assert " " in str(release_root)
PY
then
    pass 'marketplace source resolves from a copied release path containing spaces'
else
    fail 'marketplace source resolves from a copied release path containing spaces'
fi

PROJECT_ROOT="$TMP/project root"
mkdir -p "$PROJECT_ROOT" "$TMP/home"
PREPARATION_OUTPUT="$TMP/preparation.out"
if HOME="$TMP/home" bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh" \
    --project-dir "$PROJECT_ROOT" >"$PREPARATION_OUTPUT" \
    && grep -Fq 'PACKAGE_PREPARATION=ready' "$PREPARATION_OUTPUT" \
    && grep -Fq 'HOST_MUTATION=none' "$PREPARATION_OUTPUT"; then
    pass 'release root preparation accepts the canonical package layout'
else
    fail 'release root preparation accepts the canonical package layout'
fi

NESTED_SOURCE_ROOT="$TMP/nested-source"
cp -R "$RELEASE_ROOT" "$NESTED_SOURCE_ROOT"
python3 - "$NESTED_SOURCE_ROOT/.codebuddy-plugin/marketplace.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    marketplace = json.load(handle)
marketplace["plugins"][0]["source"] = "./lazybuddy-plugin/.codebuddy-plugin"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(marketplace, handle)
PY
if HOME="$TMP/home" bash "$NESTED_SOURCE_ROOT/lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh" \
    --project-dir "$PROJECT_ROOT" >"$TMP/nested-source.out" 2>&1; then
    fail 'nested plugin metadata is rejected as a marketplace source'
elif grep -Fq 'release marketplace must contain lazybuddy 1.0.2 from ./lazybuddy-plugin' "$TMP/nested-source.out"; then
    pass 'nested plugin metadata is rejected as a marketplace source'
else
    fail 'nested plugin metadata is rejected with an actionable layout error'
fi

READINESS_OUTPUT="$TMP/readiness.out"
if env CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" \
    bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" >"$READINESS_OUTPUT" \
    && grep -Fq 'PASS marketplace version agreement: 1.0.2' "$READINESS_OUTPUT" \
    && grep -Fq 'PACKAGE_READINESS=full' "$READINESS_OUTPUT"; then
    pass 'copied spaced release passes marketplace/plugin package readiness'
else
    fail 'copied spaced release passes marketplace/plugin package readiness'
fi

SETTINGS_LOCAL="$PROJECT_ROOT/.codebuddy/settings.local.json"
mkdir -p "$(dirname "$SETTINGS_LOCAL")"
printf '%s\n' '{"machine":{"preserve":"settings-local-sentinel"}}' > "$SETTINGS_LOCAL"
cp "$SETTINGS_LOCAL" "$TMP/settings.local.before"
shasum -a 256 "$SETTINGS_LOCAL" > "$TMP/settings.local.before.sha256"
if (
    cd "$PROJECT_ROOT"
    HOME="$TMP/home" bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh" \
        --project-dir "$PROJECT_ROOT" > "$TMP/settings-preparation.out"
    CWD="$PROJECT_ROOT" CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
        LAZYBUDDY_MARKETPLACE_FILE="$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" \
        bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" \
        > "$TMP/settings-load-check.out"
); then
    SETTINGS_CHECK_RC=0
else
    SETTINGS_CHECK_RC=$?
fi
shasum -a 256 "$SETTINGS_LOCAL" > "$TMP/settings.local.after.sha256"
if [ "$SETTINGS_CHECK_RC" -eq 0 ] \
    && cmp -s "$TMP/settings.local.before" "$SETTINGS_LOCAL" \
    && cmp -s "$TMP/settings.local.before.sha256" "$TMP/settings.local.after.sha256"; then
    pass 'safe preparation and load check preserve local project settings bytes'
else
    fail 'safe preparation and load check preserve local project settings bytes'
fi

mkdir -p "$TMP/unrelated cwd"
if (
    cd "$TMP/unrelated cwd"
    env CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
        LAZYBUDDY_MARKETPLACE_FILE="$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" \
        bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh"
) >"$TMP/default-discovery.out" 2>&1 \
    && grep -Fq 'PASS skills: 14/14' "$TMP/default-discovery.out" \
    && grep -Fq 'PACKAGE_READINESS=full' "$TMP/default-discovery.out"; then
    pass 'spaced release load-check passes from an unrelated CWD with intact default skills'
else
    fail 'spaced release load-check passes from an unrelated CWD with intact default skills'
fi

BROKEN_DEFAULT_ROOT="$TMP/broken-default/Lazy Buddy"
mkdir -p "$(dirname "$BROKEN_DEFAULT_ROOT")"
cp -R "$RELEASE_ROOT" "$BROKEN_DEFAULT_ROOT"
rm "$BROKEN_DEFAULT_ROOT/lazybuddy-plugin/skills/lazy-debugging/SKILL.md"
if env CODEBUDDY_PLUGIN_ROOT="$BROKEN_DEFAULT_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$BROKEN_DEFAULT_ROOT/.codebuddy-plugin/marketplace.json" \
    bash "$BROKEN_DEFAULT_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" \
    >"$TMP/broken-default.out" 2>&1; then
    fail 'broken default skills tree is rejected'
elif grep -Fq 'FAIL CodeBuddy default skills' "$TMP/broken-default.out"; then
    pass 'broken default skills tree is rejected'
else
    fail 'broken default skills tree is rejected with an actionable skill error'
fi

CUSTOM_SKILLS_ROOT="$TMP/custom-skills/Lazy Buddy"
mkdir -p "$(dirname "$CUSTOM_SKILLS_ROOT")"
cp -R "$RELEASE_ROOT" "$CUSTOM_SKILLS_ROOT"
cp -R "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/skills" "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/custom-skills"
python3 - "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["skills"] = "./custom-skills/"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
if env CODEBUDDY_PLUGIN_ROOT="$CUSTOM_SKILLS_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$CUSTOM_SKILLS_ROOT/.codebuddy-plugin/marketplace.json" \
    bash "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" \
    >"$TMP/custom-skills.out" 2>&1 \
    && grep -Fq 'PASS CodeBuddy manifest skills: declared' "$TMP/custom-skills.out" \
    && grep -Fq 'PASS skills: 14/14' "$TMP/custom-skills.out"; then
    pass 'declared custom skills directory passes package readiness'
else
    fail 'declared custom skills directory passes package readiness'
fi

if python3 - "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/.workbuddy-plugin/plugin.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
assert manifest.get("skills") == ["./skills/"]
PY
then
    pass 'WorkBuddy manifest retains its explicit skills declaration'
else
    fail 'WorkBuddy manifest retains its explicit skills declaration'
fi

WRONG_MARKETPLACE="$TMP/wrong-marketplace.json"
python3 - "$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" "$WRONG_MARKETPLACE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    marketplace = json.load(handle)
marketplace["name"] = "wrong-marketplace"
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(marketplace, handle)
PY
if env CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$WRONG_MARKETPLACE" \
    bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" \
    >"$TMP/wrong-marketplace.out" 2>&1; then
    fail 'wrong marketplace identity is rejected'
elif grep -Fq 'FAIL marketplace name:' "$TMP/wrong-marketplace.out"; then
    pass 'wrong marketplace identity is rejected'
else
    fail 'wrong marketplace identity is rejected with an actionable metadata error'
fi

printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "$FAIL"
[ "$FAIL" -eq 0 ]
