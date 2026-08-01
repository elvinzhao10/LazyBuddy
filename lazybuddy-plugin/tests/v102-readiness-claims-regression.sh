#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-readiness-claims.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

LOAD_OUTPUT="$TMP/load-check.out"
CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh" >"$LOAD_OUTPUT"
grep -Fqx 'READINESS_SCOPE=package-ready' "$LOAD_OUTPUT" || fail 'full package check did not name package-ready scope'
if grep -Eiq 'host-ready|live-host-proof|connected' "$LOAD_OUTPUT"; then
    fail 'package check output contains a host or live claim'
fi
pass 'load-check reports package scope without host claims'

HOST_BIN="$TMP/host-bin"
mkdir -p "$HOST_BIN"
for provider in rg sg; do
    cat >"$HOST_BIN/$provider" <<'SH'
#!/usr/bin/env bash
exit 0
SH
    chmod +x "$HOST_BIN/$provider"
done
REPORT="$TMP/report.json"
PATH="$HOST_BIN:/usr/bin:/bin" python3 "$PLUGIN_ROOT/tooling/lazybuddy_capability_readiness.py" \
    readiness-report --tooling-root "$TMP/missing-tooling" --json >"$REPORT"
python3 - "$PLUGIN_ROOT" "$REPORT" <<'PY'
import copy
import json
import sys
from pathlib import Path

plugin_root = Path(sys.argv[1])
report = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
records = report["records"]
assert records and all(item["readiness_scope"] == "package-ready" for item in records)
assert all(item["status"] != "host-ready" for item in records)
sys.path.insert(0, str(plugin_root / "tooling"))
from lazybuddy_capability_readiness import validate_package_records

validate_package_records(records)
live = copy.deepcopy(records)
live[0]["readiness_scope"] = "live-host-proof"
try:
    validate_package_records(live)
except ValueError as error:
    assert "package-ready" in str(error)
else:
    raise AssertionError("package validator accepted a live host claim")

both_routes = copy.deepcopy(records)
both_routes[0]["readiness_scope"] = "observed-build-route"
both_routes[0]["details"]["route"] = "plugin"
both_routes[1]["readiness_scope"] = "manual-skills-mcp-fallback"
both_routes[1]["details"]["route"] = "manual"
try:
    validate_package_records(both_routes)
except ValueError:
    pass
else:
    raise AssertionError("package validator accepted plugin/manual coexistence as live")
PY
pass 'package validator rejects live and plugin/manual coexistence claims'

FALLBACK="$TMP/manual-fallback"
mkdir -p "$FALLBACK"
cp -R "$PLUGIN_ROOT/skills" "$FALLBACK/skills"
FALLBACK_OUTPUT="$TMP/fallback.out"
CODEBUDDY_PLUGIN_ROOT="$FALLBACK" bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh" >"$FALLBACK_OUTPUT"
grep -Fqx 'READINESS_SCOPE=manual-skills-mcp-fallback' "$FALLBACK_OUTPUT" || fail 'manual fallback scope was not explicit'
grep -Fq 'agents, commands, and hooks remain unavailable' "$FALLBACK_OUTPUT" || fail 'manual fallback capability boundary missing'
grep -Fqx 'PACKAGE_READINESS=degraded' "$FALLBACK_OUTPUT" || fail 'manual fallback did not remain degraded'
pass 'manual fallback is Skills-only and explicitly degraded'

DOCS_OUTPUT="$TMP/docs-check.out"
if ! CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PLUGIN_ROOT/scripts/lazybuddy-docs-check.sh" >"$DOCS_OUTPUT"; then
    cat "$DOCS_OUTPUT" >&2
    fail 'package documentation contains an escaping or missing link'
fi
grep -Fq '"broken":0' "$DOCS_OUTPUT" || fail 'package documentation check did not report zero broken links'
pass 'package documentation stays inside the copied plugin root'

for doc in \
    "$PLUGIN_ROOT/docs/verification-matrix.md" \
    "$PLUGIN_ROOT/README.md" \
    "$(cd "$PLUGIN_ROOT/.." && pwd -P)/docs/reference/host-routes.md" \
    "$(cd "$PLUGIN_ROOT/.." && pwd -P)/docs/reference/verification-contract.md"; do
    grep -Fq 'manual-skills-mcp-fallback' "$doc" || fail "missing manual fallback vocabulary: $doc"
    grep -Fq 'unsupported' "$doc" || fail "missing coexistence warning: $doc"
done
pass 'readiness and route docs define the collision boundary'

printf 'v1.0.3 readiness-claims regression: PASS\n'
