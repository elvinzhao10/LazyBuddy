#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TOOLING="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-readiness.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

WORKSPACE="$TMP/workspace"
TOOLING_ROOT="$TMP/tooling-root"
HOST_BIN="$TMP/host-bin"
mkdir -p "$WORKSPACE" "$HOST_BIN"
git -C "$WORKSPACE" init -q
printf 'print("fixture")\n' > "$WORKSPACE/example.py"
printf '{"mcpServers":{}}\n' > "$WORKSPACE/.mcp.json"
printf '{"lockfileVersion":3}\n' > "$WORKSPACE/package-lock.json"
git -C "$WORKSPACE" add example.py .mcp.json package-lock.json
git -C "$WORKSPACE" -c user.name=test -c user.email=test@example.invalid commit -qm initial
printf 'dirty but caller-owned\n' >> "$WORKSPACE/example.py"
printf 'host configuration\n' > "$TMP/host-mcp.json"

for provider in rg sg basedpyright-langserver; do
    cat > "$HOST_BIN/$provider" <<'SH'
#!/usr/bin/env bash
printf 'provider should not execute\n' > "${LAZYBUDDY_PROVIDER_EXECUTION_SENTINEL:?}"
exit 99
SH
    chmod +x "$HOST_BIN/$provider"
done

before_hashes="$(shasum -a 256 "$WORKSPACE/.mcp.json" "$WORKSPACE/package-lock.json" "$TMP/host-mcp.json")"
REPORT="$TMP/report.json"

# Given host-local provider paths and an absent owned root, when the canonical
# report runs, then it emits schema-valid records without executing providers
# or changing caller-owned configuration.
PATH="$HOST_BIN:/usr/bin:/bin" LAZYBUDDY_PROVIDER_EXECUTION_SENTINEL="$TMP/provider-executed" \
    bash "$TOOLING" readiness-report --tooling-root "$TOOLING_ROOT" --target "$WORKSPACE" --json > "$REPORT"
python3 - "$PLUGIN_ROOT/contracts/lazyseries-capability-readiness.v1.json" "$REPORT" <<'PY'
import json
import sys

schema = json.load(open(sys.argv[1], encoding="utf-8"))
records = json.load(open(sys.argv[2], encoding="utf-8"))["records"]
required = set(schema["required"])
by_capability = {record["capability"]: record for record in records}
assert set(by_capability) == {
    "local_search", "structural_search", "code_navigation", "architecture_search",
    "documentation_search", "web_search", "external_code_search", "browser_automation",
    "filesystem_read",
}
for record in records:
    assert set(record) == required
    assert record["host"] == "lazybuddy"
    assert record["status"] in schema["properties"]["status"]["enum"]
    assert isinstance(record["details"], dict)
assert by_capability["local_search"]["status"] == "host-ready"
assert by_capability["structural_search"]["status"] == "host-ready"
assert by_capability["code_navigation"]["status"] == "host-ready"
assert by_capability["architecture_search"]["status"] == "not-initialized"
assert by_capability["documentation_search"]["status"] == "disabled"
PY
[ ! -e "$TMP/provider-executed" ] || fail 'readiness report executed a provider'
[ "$before_hashes" = "$(shasum -a 256 "$WORKSPACE/.mcp.json" "$WORKSPACE/package-lock.json" "$TMP/host-mcp.json")" ] || fail 'readiness report changed caller-owned configuration'
printf 'REPORT_ONLY_HASHES=%s\n' "$before_hashes"
git -C "$WORKSPACE" diff --quiet && fail 'readiness report cleared the pre-existing dirty worktree'
pass 'canonical host report is schema-valid and non-mutating'

LSP_ROOT="$TMP/lsp-root"
mkdir -p "$LSP_ROOT/lsp/python/node_modules/.bin" "$LSP_ROOT/.lazybuddy-lsp-npm-runtime/home" "$LSP_ROOT/.lazybuddy-lsp-npm-runtime/cache" "$LSP_ROOT/.lazybuddy-lsp-npm-runtime/config" "$LSP_ROOT/.lazybuddy-lsp-npm-runtime/tmp"
cp "$PLUGIN_ROOT/tooling/lsp/python/package.json" "$LSP_ROOT/lsp/python/package.json"
cp "$PLUGIN_ROOT/tooling/lsp/python/package-lock.json" "$LSP_ROOT/lsp/python/package-lock.json"
cat > "$LSP_ROOT/lsp/python/node_modules/.bin/basedpyright-langserver" <<'SH'
#!/usr/bin/env bash
exit 99
SH
chmod +x "$LSP_ROOT/lsp/python/node_modules/.bin/basedpyright-langserver"
PYTHONPATH="$PLUGIN_ROOT/tooling" python3 - "$LSP_ROOT" <<'PY'
import json
import sys
from pathlib import Path

from lazybuddy_capability_readiness import tree_digest

root = Path(sys.argv[1])
receipt = {
    "schema_version": 1,
    "owner": "lazybuddy-lsp-tooling",
    "root": str(root),
    "owned_entries": ["lsp", ".lazybuddy-lsp-npm-runtime", ".lazybuddy-lsp-receipt.json"],
    "lsp_digest": tree_digest(root / "lsp"),
}
(root / ".lazybuddy-lsp-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
PATH="/usr/bin:/bin" bash "$TOOLING" readiness-report --tooling-root "$LSP_ROOT" --target "$WORKSPACE" --json > "$TMP/lsp-owned.json"
python3 - "$TMP/lsp-owned.json" <<'PY'
import json
import sys

records = {record["capability"]: record for record in json.load(open(sys.argv[1], encoding="utf-8"))["records"]}
assert records["code_navigation"]["status"] == "owned-ready"
assert records["code_navigation"]["receipt"] == {"owner": "lazybuddy-lsp-tooling", "schema_version": 1, "state": "ready"}
PY
pass 'verified LSP receipt maps to owned-ready without provider execution'

# Given a receipt-shaped CodeGraph root whose provider file lacks an execute
# bit, when readiness inspects it, then it must not claim owned-ready.
PYTHONPATH="$PLUGIN_ROOT/tooling" python3 - "$TMP" "$WORKSPACE" <<'PY'
import json
import sys
from pathlib import Path

from lazybuddy_capability_readiness import architecture_record

temporary = Path(sys.argv[1])
target = Path(sys.argv[2])
root = temporary / "non-executable-codegraph"
binary = root / "node_modules" / "@colbymchenry" / "codegraph-darwin-arm64" / "bin" / "codegraph"
binary.parent.mkdir(parents=True)
binary.write_text("not executable\n", encoding="utf-8")
(target / ".codegraph").mkdir(exist_ok=True)
receipt = {
    "schema_version": 1,
    "owner": "lazybuddy-codegraph",
    "tooling_root": str(root),
    "target_root": str(target),
    "index_path": f"{target}/.codegraph",
    "created_index": False,
    "enabled": True,
}
(root / ".lazybuddy-codegraph-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
assert architecture_record(target, root, "owned")["status"] == "missing"
PY
pass 'non-executable CodeGraph provider is not owned-ready'

# Given a checksum mismatch, when the report adapter is asked to use that
# contract, then it returns canonical fail-safe records without inspecting the
# caller workspace or providers.
PYTHONPATH="$PLUGIN_ROOT/tooling" python3 - "$TMP" "$TOOLING_ROOT" "$WORKSPACE" <<'PY'
import sys
from pathlib import Path

from lazybuddy_capability_contract import PLUGIN_ROOT
from lazybuddy_capability_readiness import readiness_contract_integrity, records

temporary = Path(sys.argv[1])
contract = temporary / "readiness-contract.json"
checksum = temporary / "readiness-contract.json.sha256"
contract.write_bytes((PLUGIN_ROOT / "contracts" / "lazyseries-capability-readiness.v1.json").read_bytes())
checksum.write_text("0" * 64 + "  readiness-contract.json\n", encoding="utf-8")
assert not readiness_contract_integrity(contract, checksum)
report = records(Path(sys.argv[2]), Path(sys.argv[3]), (contract, checksum))
assert len(report) == 9
assert {entry["status"] for entry in report} == {"failed-optional"}
assert {entry["reason_code"] for entry in report} == {"CONTRACT_INTEGRITY_INVALID"}
PY
pass 'readiness contract checksum mismatch fails safely'

# Given a stale receipt-like root with no local host provider, when the report
# runs, then it fails closed as incompatible rather than claiming owned-ready.
mkdir "$TOOLING_ROOT"
printf '{not json}\n' > "$TOOLING_ROOT/.lazybuddy-tooling-receipt.json"
PATH="/usr/bin:/bin" bash "$TOOLING" readiness-report --tooling-root "$TOOLING_ROOT" --target "$WORKSPACE" --json > "$TMP/stale.json"
python3 - "$TMP/stale.json" <<'PY'
import json
import sys

records = {record["capability"]: record for record in json.load(open(sys.argv[1], encoding="utf-8"))["records"]}
assert records["local_search"]["status"] == "incompatible"
assert records["structural_search"]["status"] == "incompatible"
assert records["architecture_search"]["status"] == "not-initialized"
PY
pass 'stale state is never misreported as receipt-owned'

# Given malformed report arguments, when the public command is invoked, then it
# rejects them without changing the sentinel files; help remains documented.
if bash "$TOOLING" readiness-report --tooling-root relative --json > "$TMP/malformed.out" 2>&1; then
    fail 'relative readiness root unexpectedly succeeded'
fi
bash "$TOOLING" readiness-report --help > "$TMP/help.out" 2>&1 || fail 'readiness report help failed'
grep -Fq 'readiness-report' "$TMP/help.out" || fail 'readiness report missing from usage'
[ "$before_hashes" = "$(shasum -a 256 "$WORKSPACE/.mcp.json" "$WORKSPACE/package-lock.json" "$TMP/host-mcp.json")" ] || fail 'malformed readiness command changed caller-owned configuration'
pass 'malformed input and help preserve read-only contract'

printf 'v0.17 LazyBuddy capability readiness regression: PASS\n'
