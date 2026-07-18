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
    "$REPOSITORY_ROOT/README.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/README.md"
    "$REPOSITORY_ROOT/docs/reference/host-routes.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/templates/AGENTS.md"
)

protocol_docs=(
    "$REPOSITORY_ROOT/AGENTS.md"
    "$REPOSITORY_ROOT/README.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/README.md"
    "$REPOSITORY_ROOT/docs/03-install-and-host-verification.md"
    "$REPOSITORY_ROOT/docs/10-host-capability-matrix.md"
    "$REPOSITORY_ROOT/docs/reference/host-routes.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/templates/AGENTS.md"
)

connector_docs=(
    "$REPOSITORY_ROOT/AGENTS.md"
    "$REPOSITORY_ROOT/docs/reference/host-routes.md"
    "$REPOSITORY_ROOT/lazybuddy-plugin/templates/AGENTS.md"
)

if python3 - "${protocol_docs[@]}" <<'PY'
from pathlib import Path
import re
import sys

flow = re.compile(
    r"permanent[\s\S]{0,300}(?:open|link)[\s\S]{0,300}"
    r"https://github\.com/elvinzhao10/LazyBuddy[\s\S]{0,180}onboard",
    re.I,
)
required = (
    re.compile(r"package\s+readiness", re.I),
    re.compile(r"host\s+readiness", re.I),
    re.compile(r"approval", re.I),
    re.compile(r"(?:one|exactly)\s+.{0,30}action[\s\S]{0,100}wait", re.I),
    re.compile(r"Computer Use", re.I),
    re.compile(r"reload|new session", re.I),
    re.compile(r"one\s+real\s+(?:Skill|command)|real\s+Skill/command", re.I),
    re.compile(r"expected\s+MCP|all\s+six\s+MCP|six\s+MCP", re.I),
    re.compile(r"pending", re.I),
)

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    assert flow.search(text), raw_path
    for pattern in required:
        assert pattern.search(text), (raw_path, pattern.pattern)

agents = Path(sys.argv[1]).read_text(encoding="utf-8")
routes = Path(sys.argv[-2]).read_text(encoding="utf-8")
assert re.search(r"Action 1[\s\S]*marketplace add[\s\S]*discover", agents, re.I)
assert re.search(r"Action 2[\s\S]*install[\s\S]*lazybuddy@lazybuddy[\s\S]*wait", agents, re.I)
assert re.search(r"Action 3[\s\S]*fresh[\s\S]*session[\s\S]*all\s+six\s+MCP", agents, re.I)
assert re.search(r"CodeBuddy[\s\S]*marketplace[\s\S]*settings\.json[\s\S]*settings\.local\.json", agents, re.I)
assert re.search(r"settings\.local\.json[\s\S]*ignored[\s\S]*unstaged[\s\S]*secrets must never be committed", routes, re.I)
workbuddy = re.split(r"## WorkBuddy", routes, maxsplit=1, flags=re.I)[-1]
assert re.search(r"Skills-only|Skills/manual-MCP|Skills.*import", workbuddy, re.I)
assert re.search(r"six individual manual local MCP", workbuddy, re.I)
assert re.search(r"file[s]?[\s\S]*load-check", workbuddy, re.I)
assert re.search(r"never[\s\S]*commands[\s\S]*agents[\s\S]*hooks[\s\S]*MCP", workbuddy, re.I)
PY
then
    pass 'local-first protocol stages and readiness boundary are present across route docs'
else
    fail 'local-first protocol stages and readiness boundary are present across route docs'
fi

if python3 - "$REPOSITORY_ROOT/docs/reference/host-routes.md" "${connector_docs[@]}" "${protocol_docs[@]}" <<'PY'
from pathlib import Path
import re
import sys

host_routes = Path(sys.argv[1]).read_text(encoding="utf-8")
connector_docs = [(path, Path(path).read_text(encoding="utf-8")) for path in sys.argv[2:5]]
protocol_docs = [(path, Path(path).read_text(encoding="utf-8")) for path in sys.argv[5:]]
servers = (
    "run-ledger",
    "verification",
    "status-dashboard",
    "context-graph",
    "code-intel",
    "docs",
)

for server in servers:
    assert f'<release-root>/lazybuddy-plugin/mcp/{server}/server.sh' in host_routes, server
assert '"command": "bash"' in host_routes
assert '"cwd": "<project-root>"' in host_routes
assert '"CWD": "<project-root>"' in host_routes
assert '"CODEBUDDY_PROJECT_DIR": "<project-root>"' in host_routes
assert re.search(r"add exactly one named connector[\s\S]{0,100}trust prompt[\s\S]{0,100}inspect", host_routes, re.I)

for label, text in connector_docs:
    assert "lazybuddy-plugin/.mcp.json" in text, label
    assert "CODEBUDDY_PROJECT_DIR" in text, label
    assert re.search(r"absolute[\s\S]{0,180}server\.sh", text, re.I), label
    assert re.search(r"excludes?\s+(?:commands,\s+)?(?:agents|Agents)|agents[\s\S]{0,80}excluded", text, re.I), label

for label, text in protocol_docs:
    assert "2026-07-18" in text, label
    assert re.search(
        r"(?:did not\s+record|not\s+recorded)[^.]{0,120}(?:version|build)|"
        r"(?:version|build)[^.]{0,120}(?:did not\s+record|not\s+recorded)",
        text,
        re.I,
    ), label
    assert re.search(r"GUI[\s\S]{0,180}local[- ]directory", text, re.I), label
    assert re.search(r"discover[\s\S]{0,800}install[\s\S]{0,800}(?:fully quit|fully restart)", text, re.I), label
    assert re.search(r"fresh\s+(?:project\s+)?session", text, re.I), label
    assert re.search(r"HOST\s+READINESS:\s*PENDING", text, re.I), label
PY
then
    pass 'desktop plugin and manual connector handoffs are exact and build-qualified'
else
    fail 'desktop plugin and manual connector handoffs are exact and build-qualified'
fi

if python3 - "${protocol_docs[@]}" <<'PY'
from pathlib import Path
import re
import sys

def assert_safe_onboarding(text, label):
    assert not re.search(r"/Users/(?:[^/< >]+)/", text), f"{label}: developer-specific path"
    assert not re.search(r"^\s*(?:\$\s+)?lazybuddy\s+(?:onboard|install|doctor|verify)\b", text, re.I | re.M), f"{label}: bare PATH launcher"
    assert not re.search(r"\bcodebuddy\s+plugin\s+marketplace\s+add\b", text, re.I), f"{label}: unsupported marketplace command form"
    assert not re.search(r"--plugin-dir[^.\n]{0,100}(?:is|provides|creates)\s+(?:a\s+)?persistent", text, re.I), f"{label}: persistent plugin-dir claim"
    assert not re.search(
        r"(?:copied|cloned|linked|manifest|load-check|package files?)[^.]{0,180}"
        r"(?:host[- ]ready|host readiness\s*(?::|is)?\s*(?:ready|pass|full))",
        text,
        re.I,
    ), f"{label}: copied package claimed host readiness"

for raw_path in sys.argv[1:]:
    text = Path(raw_path).read_text(encoding="utf-8")
    assert_safe_onboarding(text, raw_path)
    assert re.search(r"documented\s+CodeBuddy\s+CLI\s+route", text, re.I), raw_path
    assert re.search(r"CodeBuddy\s+IDE[^.]{0,240}observed-build\s+routes?|observed-build\s+routes?[^.]{0,240}CodeBuddy\s+IDE", text, re.I), raw_path
    assert re.search(r"WorkBuddy[^.]{0,240}observed-build\s+routes?|observed-build\s+routes?[^.]{0,240}WorkBuddy", text, re.I), raw_path
    assert "manual-skills-mcp-fallback" in text, raw_path
    assert re.search(r"HOST\s+READINESS:\s*PENDING", text, re.I), raw_path

invalid = (
    ("bare launcher", "lazybuddy onboard"),
    ("developer path", "bash /Users/alice/Desktop/LazyBuddy/lazybuddy-plugin/scripts/lazybuddy-verify.sh"),
    ("unsupported marketplace form", "codebuddy plugin marketplace add /tmp/LazyBuddy"),
    ("persistent plugin-dir", "--plugin-dir provides a persistent install"),
    ("copied package host claim", "Copied package files mean host readiness: ready."),
)
for label, text in invalid:
    try:
        assert_safe_onboarding(text, label)
    except AssertionError:
        pass
    else:
        raise AssertionError(f"unsafe copied onboarding fixture was accepted: {label}")
PY
then
    pass 'host-route qualification and unsafe-claim rejection are enforced'
else
    fail 'host-route qualification and unsafe-claim rejection are enforced'
fi

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

DEFAULT_DISCOVERY_ROOT="$TMP/default-discovery/Lazy Buddy"
mkdir -p "$(dirname "$DEFAULT_DISCOVERY_ROOT")"
cp -R "$REPOSITORY_ROOT" "$DEFAULT_DISCOVERY_ROOT"
python3 - "$DEFAULT_DISCOVERY_ROOT/lazybuddy-plugin/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest.pop("skills", None)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
mkdir -p "$TMP/unrelated cwd"
if (
    cd "$TMP/unrelated cwd"
    env CODEBUDDY_PLUGIN_ROOT="$DEFAULT_DISCOVERY_ROOT/lazybuddy-plugin" \
        LAZYBUDDY_MARKETPLACE_FILE="$DEFAULT_DISCOVERY_ROOT/.codebuddy-plugin/marketplace.json" \
        bash "$DEFAULT_DISCOVERY_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh"
) >"$TMP/default-discovery.out" 2>&1 \
    && grep -Fq 'PASS CodeBuddy manifest skills: default discovery' "$TMP/default-discovery.out" \
    && grep -Fq 'PACKAGE_READINESS=full' "$TMP/default-discovery.out"; then
    pass 'CodeBuddy default skills discovery passes from an unrelated CWD'
else
    fail 'CodeBuddy default skills discovery passes from an unrelated CWD'
fi

BROKEN_DEFAULT_ROOT="$TMP/broken-default/Lazy Buddy"
mkdir -p "$(dirname "$BROKEN_DEFAULT_ROOT")"
cp -R "$REPOSITORY_ROOT" "$BROKEN_DEFAULT_ROOT"
python3 - "$BROKEN_DEFAULT_ROOT/lazybuddy-plugin/.codebuddy-plugin/plugin.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest.pop("skills", None)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle)
PY
rm "$BROKEN_DEFAULT_ROOT/lazybuddy-plugin/skills/lazy-debugging/SKILL.md"
if env CODEBUDDY_PLUGIN_ROOT="$BROKEN_DEFAULT_ROOT/lazybuddy-plugin" \
    LAZYBUDDY_MARKETPLACE_FILE="$BROKEN_DEFAULT_ROOT/.codebuddy-plugin/marketplace.json" \
    bash "$BROKEN_DEFAULT_ROOT/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" \
    >"$TMP/broken-default.out" 2>&1; then
    fail 'broken CodeBuddy default skills tree is rejected'
elif grep -Fq 'FAIL CodeBuddy default skills' "$TMP/broken-default.out"; then
    pass 'broken CodeBuddy default skills tree is rejected'
else
    fail 'broken CodeBuddy default skills tree is rejected with an actionable skill error'
fi

CUSTOM_SKILLS_ROOT="$TMP/custom-skills/Lazy Buddy"
mkdir -p "$(dirname "$CUSTOM_SKILLS_ROOT")"
cp -R "$REPOSITORY_ROOT" "$CUSTOM_SKILLS_ROOT"
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
    pass 'CodeBuddy declared custom skills directory passes package readiness'
else
    fail 'CodeBuddy declared custom skills directory passes package readiness'
fi

if python3 - "$CUSTOM_SKILLS_ROOT/lazybuddy-plugin/.workbuddy-plugin/plugin.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
assert manifest.get("skills") == ["./skills/"]
PY
then
    pass 'WorkBuddy manifest keeps its explicit skills declaration'
else
    fail 'WorkBuddy manifest keeps its explicit skills declaration'
fi

WRONG_MARKETPLACE="$TMP/wrong-marketplace.json"
python3 - "$REPOSITORY_ROOT/.codebuddy-plugin/marketplace.json" "$WRONG_MARKETPLACE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    marketplace = json.load(handle)
marketplace["name"] = "wrong-marketplace"
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(marketplace, handle)
PY
if env LAZYBUDDY_MARKETPLACE_FILE="$WRONG_MARKETPLACE" \
    bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh" >"$TMP/wrong-marketplace.out" 2>&1; then
    fail 'marketplace identity mismatch is rejected'
elif grep -Fq 'FAIL marketplace name:' "$TMP/wrong-marketplace.out"; then
    pass 'marketplace identity mismatch is rejected'
else
    fail 'marketplace identity mismatch is rejected with an actionable metadata error'
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
