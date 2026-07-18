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

route_docs=(
    "$REPOSITORY_ROOT/AGENTS.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/README.md"
    "$REPOSITORY_ROOT/docs/reference/host-routes.md"
)

if python3 - "${route_docs[@]}" <<'PY'
from pathlib import Path
import sys

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    add = "/plugin marketplace add <absolute-local-LazyBuddy-path>"
    install = "/plugin install lazybuddy@lazybuddy"
    assert add in text, raw_path
    assert install in text, raw_path
    assert text.index(add) < text.index(install), raw_path
    assert "/plugin" in text, raw_path
PY
then
    pass 'local marketplace add/install literals are ordered in every route document'
else
    fail 'local marketplace add/install literals are ordered in every route document'
fi

if python3 - "${route_docs[@]}" <<'PY'
from pathlib import Path
import re
import sys

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    assert not re.search(r"no\s+marketplace-add\s+URL|does not provide a marketplace-add|intentionally provides no\s+marketplace-add|no executable install command", text, re.I), raw_path
PY
then
    pass 'contradictory no-route guidance is absent'
else
    fail 'contradictory no-route guidance is absent'
fi

if python3 - "${route_docs[@]}" <<'PY'
from pathlib import Path
import re
import sys

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    assert "--plugin-dir" in text, raw_path
    assert re.search(r"development/testing only", text, re.I), raw_path
    assert re.search(r"never\s+(?:persists|persistent)|does not persist", text, re.I), raw_path
PY
then
    pass 'plugin-dir is documented as development/testing-only and non-persistent'
else
    fail 'plugin-dir is documented as development/testing-only and non-persistent'
fi

if git -C "$REPOSITORY_ROOT" check-ignore -q .codebuddy/settings.local.json \
    && ! git -C "$REPOSITORY_ROOT" ls-files --error-unmatch .codebuddy/settings.local.json >/dev/null 2>&1 \
    && python3 - "${route_docs[@]}" <<'PY'
from pathlib import Path
import sys

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    assert ".codebuddy/settings.json" in text, raw_path
    assert ".codebuddy/settings.local.json" in text, raw_path
    assert "secrets must never be committed" in text.lower(), raw_path
PY
then
    pass 'settings.local is ignored/untracked and docs forbid committed secrets'
else
    fail 'settings.local is ignored/untracked and docs forbid committed secrets'
fi

RELEASE_ROOT="$TMP/Lazy Buddy"
cp -R "$REPOSITORY_ROOT" "$RELEASE_ROOT"
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

mkdir -p "$RELEASE_ROOT/.codebuddy"
printf '%s\n' '{"shared":"keep"}' > "$RELEASE_ROOT/.codebuddy/settings.json"
printf '%s\n' '{"machine":"keep"}' > "$RELEASE_ROOT/.codebuddy/settings.local.json"
cp "$RELEASE_ROOT/.codebuddy/settings.json" "$TMP/settings.shared.before"
cp "$RELEASE_ROOT/.codebuddy/settings.local.json" "$TMP/settings.local.before"
if env CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" \
    bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" >/dev/null \
    && env CODEBUDDY_PLUGIN_ROOT="$RELEASE_ROOT/lazybuddy-plugin" \
        LAZYBUDDY_MARKETPLACE_FILE="$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" \
        bash "$RELEASE_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" >/dev/null \
    && cmp -s "$TMP/settings.shared.before" "$RELEASE_ROOT/.codebuddy/settings.json" \
    && cmp -s "$TMP/settings.local.before" "$RELEASE_ROOT/.codebuddy/settings.local.json" \
    && ! grep -REiq 'codebuddy[^\n]*(marketplace|plugin install)|marketplace trust' "$RELEASE_ROOT/lazybuddy-plugin/scripts"; then
    pass 'repeated readiness preserves project settings without trust/install automation'
else
    fail 'repeated readiness preserves project settings without trust/install automation'
fi

if python3 - "${route_docs[@]}" <<'PY'
from pathlib import Path
import sys

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8").lower()
    assert "package readiness" in text, raw_path
    assert "not" in text and "host" in text, raw_path
    assert "skills/" in text, raw_path
    assert "manual" in text and "mcp" in text, raw_path
    assert "commands" in text and "agents" in text and "hooks" in text, raw_path
PY
then
    pass 'readiness docs preserve host boundary and WorkBuddy skills/manual-MCP fallback'
else
    fail 'readiness docs preserve host boundary and WorkBuddy skills/manual-MCP fallback'
fi

printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "$FAIL"
[ "$FAIL" -eq 0 ]
