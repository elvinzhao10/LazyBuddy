#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-package-boundary.XXXXXX")"
PARENT="$TMP/copied-parent"
INSTALLED_PLUGIN="$PARENT/lazybuddy-plugin"
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
    local output rc
    if output=$(python3 - "$@" <<'PYEOF'
import subprocess
import sys

result = subprocess.run(sys.argv[1:], capture_output=True, text=True, timeout=180, check=False)
print(result.stdout, end="")
print(result.stderr, end="", file=sys.stderr)
raise SystemExit(result.returncode)
PYEOF
); then
        rc=0
    else
        rc=$?
    fi
    printf '%s\n' "$output" > "$TMP/${label}.out"
    if [ "$rc" -eq "$expected" ]; then
        pass "$label"
    else
        fail "$label (exit $rc, expected $expected): ${output:0:240}"
    fi
}

discover_checks() {
    python3 - "$1" <<'PYEOF'
import json
import sys

print(json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {"name": "discover_checks", "arguments": {"section": "all"}},
}))
PYEOF
}

assert_discovery_contract() {
    local label="$1"
    local response="$2"
    if python3 - "$response" <<'PYEOF'
import json
import sys

payload = json.loads(sys.argv[1])
checks = payload["result"]
assert isinstance(checks, list)
assert checks
assert {check["step"] for check in checks} >= {"Package readiness", "Package verification"}
PYEOF
    then
        pass "$label"
    else
        fail "$label"
    fi
}

mkdir -p "$PARENT"
cp -R "$PLUGIN_ROOT" "$INSTALLED_PLUGIN"
printf 'PARENT LICENSE POISON\n' > "$PARENT/LICENSE"
printf 'PARENT NOTICE POISON\n' > "$PARENT/NOTICE"
mkdir -p "$PARENT/docs"
printf '# poisoned parent documentation\n' > "$PARENT/docs/handoff.md"

for script in lazybuddy-load-check.sh lazybuddy-plugin-doctor.sh lazybuddy-mcp-test.sh lazybuddy-verify.sh; do
    expect_status "copied-${script}" 0 env \
        "CWD=$PARENT" \
        "CODEBUDDY_PLUGIN_ROOT=$INSTALLED_PLUGIN" \
        "LAZYBUDDY_VERIFY_REGRESSION_DEPTH=1" \
        bash "$INSTALLED_PLUGIN/scripts/$script"
done
if grep -Fq '"regression_inventory":"pass"' "$TMP/copied-lazybuddy-verify.sh.out" \
    && grep -Fq '"automatic_tooling_regressions":"skipped-nested"' "$TMP/copied-lazybuddy-verify.sh.out"; then
    pass "copied verifier validates inventory without recursive regressions"
else
    fail "copied verifier validates inventory without recursive regressions"
fi

rm "$INSTALLED_PLUGIN/LICENSE"
expect_status "missing-package-license-fails-readiness" 1 env \
    "CWD=$PARENT" \
    "CODEBUDDY_PLUGIN_ROOT=$INSTALLED_PLUGIN" \
    bash "$INSTALLED_PLUGIN/scripts/lazybuddy-load-check.sh"
if grep -Fq 'FAIL package LICENSE: missing from plugin root' "$TMP/missing-package-license-fails-readiness.out"; then
    pass "missing package LICENSE is not masked by parent poison"
else
    fail "missing package LICENSE is reported clearly"
fi
cp "$PLUGIN_ROOT/LICENSE" "$INSTALLED_PLUGIN/LICENSE"

rm "$INSTALLED_PLUGIN/NOTICE"
expect_status "missing-package-notice-fails-readiness" 1 env \
    "CWD=$PARENT" \
    "CODEBUDDY_PLUGIN_ROOT=$INSTALLED_PLUGIN" \
    bash "$INSTALLED_PLUGIN/scripts/lazybuddy-load-check.sh"
if grep -Fq 'FAIL package NOTICE: missing from plugin root' "$TMP/missing-package-notice-fails-readiness.out"; then
    pass "missing package NOTICE is not masked by parent poison"
else
    fail "missing package NOTICE is reported clearly"
fi
cp "$PLUGIN_ROOT/NOTICE" "$INSTALLED_PLUGIN/NOTICE"

first_response="$(discover_checks "$INSTALLED_PLUGIN" | CWD="$PARENT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/mcp/verification/server.sh")"
assert_discovery_contract "package-owned discovery works without parent docs" "$first_response"

cat > "$PARENT/docs/lazybuddy-verification-matrix.md" <<'EOF'
## Poisoned parent contract
| Verification Step | Command | Expected | Artifact |
| Parent poison | false | poisoned | none |
EOF
second_response="$(discover_checks "$INSTALLED_PLUGIN" | CWD="$PARENT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/mcp/verification/server.sh")"
assert_discovery_contract "parent documentation poison cannot alter discovery" "$second_response"
if [ "$first_response" = "$second_response" ]; then
    pass "discovery is invariant under parent documentation poison"
else
    fail "discovery changed after parent documentation poison"
fi

malformed_response="$(printf '%s\n' '{not-json' | CWD="$PARENT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/mcp/verification/server.sh")"
if python3 - "$malformed_response" <<'PYEOF'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["jsonrpc"] == "2.0"
assert payload["id"] is None
assert payload["error"]["code"] == -32700
PYEOF
then
    pass "verification MCP rejects malformed input"
else
    fail "verification MCP rejects malformed input"
fi

if python3 - "$INSTALLED_PLUGIN" <<'PYEOF'
from pathlib import Path
import sys

root = Path(sys.argv[1])
for source in root.rglob("*"):
    if source.is_dir() or source.parts[-2:-1] == ("tests",):
        continue
    if source.suffix not in {".md", ".sh", ".py", ".json"}:
        continue
    text = source.read_text(encoding="utf-8")
    assert "../../docs/" not in text, source
    assert "$CWD/docs/" not in text, source
    assert "dev/reference/" not in text, source
PYEOF
then
    pass "package sources avoid parent docs and dev paths"
else
    fail "package sources avoid parent docs and dev paths"
fi

echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ]
