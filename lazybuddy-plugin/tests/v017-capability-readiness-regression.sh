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
python3 - "$PLUGIN_ROOT/contracts/lazyseries-capability-readiness.v2.json" "$REPORT" <<'PY'
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
    assert record["host"] == "codebuddy-cli"
    assert record["internal_status"] in schema["properties"]["internal_status"]["enum"]
    assert record["readiness_scope"] == "package"
    assert record["evidence"]["scope"] == "package"
assert by_capability["local_search"]["internal_status"] == "package-ready"
assert by_capability["structural_search"]["internal_status"] == "package-ready"
assert by_capability["code_navigation"]["internal_status"] == "package-ready"
assert all(record["readiness_scope"] != "current-session" for record in records)
assert by_capability["architecture_search"]["internal_status"] == "not-initialized"
assert by_capability["documentation_search"]["internal_status"] == "disabled"
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
assert records["code_navigation"]["internal_status"] == "owned-ready"
assert records["code_navigation"]["evidence"]["scope"] == "package"
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
assert architecture_record(target, root, "owned")["internal_status"] == "missing"
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
contract.write_bytes((PLUGIN_ROOT / "contracts" / "lazyseries-capability-readiness.v2.json").read_bytes())
checksum.write_text("0" * 64 + "  readiness-contract.json\n", encoding="utf-8")
assert not readiness_contract_integrity(contract, checksum)
report = records(Path(sys.argv[2]), Path(sys.argv[3]), (contract, checksum))
assert len(report) == 9
assert {entry["internal_status"] for entry in report} == {"failed-optional"}
assert {entry["reason_code"] for entry in report} == {"CONTRACT_INTEGRITY_INVALID"}
PY
pass 'readiness contract checksum mismatch fails safely'

# Given a packaged readiness contract with a stale embedded policy digest, when
# the report and load-check run from a disposable plugin copy, then the report
# must fail safely and the package check must also fail. Regenerating the copied
# contract digest, sidecar, and source pin restores normal readiness.
DISPOSABLE_PLUGIN="$TMP/disposable-plugin"
cp -R "$PLUGIN_ROOT" "$DISPOSABLE_PLUGIN"
DISPOSABLE_TOOLING="$DISPOSABLE_PLUGIN/scripts/lazybuddy-tooling.sh"
DISPOSABLE_LOAD_CHECK="$DISPOSABLE_PLUGIN/scripts/lazybuddy-load-check.sh"
DISPOSABLE_ROOT="$TMP/disposable-tooling-root"

python3 - "$DISPOSABLE_PLUGIN" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path
plugin = Path(sys.argv[1])
contract_path = plugin / "contracts" / "lazyseries-capability-readiness.v2.json"
contract = json.loads(contract_path.read_text(encoding="utf-8"))
contract["properties"]["policy_digest"]["const"] = "0" * 64
contract_path.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")
schema_digest = hashlib.sha256(contract_path.read_bytes()).hexdigest()
contract_path.with_suffix(contract_path.suffix + ".sha256").write_text(f"{schema_digest}  {contract_path.name}\n", encoding="utf-8")
source_path = plugin / "tooling" / "lazybuddy_capability_readiness.py"
source_path.write_text(re.sub(r'(READINESS_SCHEMA_SHA256: Final = ")[0-9a-f]{64}(")', rf'\g<1>{schema_digest}\2', source_path.read_text(encoding="utf-8")), encoding="utf-8")
PY

bash "$DISPOSABLE_TOOLING" readiness-report --tooling-root "$DISPOSABLE_ROOT" --target "$WORKSPACE" --json > "$TMP/stale-digest.json"
python3 - "$TMP/stale-digest.json" <<'PY'
import json
import sys
records = json.load(open(sys.argv[1], encoding="utf-8"))["records"]
assert {record["internal_status"] for record in records} == {"failed-optional"}
assert {record["reason_code"] for record in records} == {"CONTRACT_INTEGRITY_INVALID"}
PY
if CODEBUDDY_PLUGIN_ROOT="$DISPOSABLE_PLUGIN" bash "$DISPOSABLE_LOAD_CHECK" > "$TMP/stale-digest-load-check.out" 2>&1; then
    fail 'load-check reported full readiness despite invalid readiness contract integrity'
fi
grep -Fq 'FAIL canonical capability readiness:' "$TMP/stale-digest-load-check.out" || fail 'invalid readiness integrity was not surfaced by load-check'

python3 - "$DISPOSABLE_PLUGIN" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path
plugin = Path(sys.argv[1])
policy_digest = hashlib.sha256((plugin / "contracts" / "automatic-tooling-contract.v1.json").read_bytes()).hexdigest()
contract_path = plugin / "contracts" / "lazyseries-capability-readiness.v2.json"
contract = json.loads(contract_path.read_text(encoding="utf-8"))
contract["properties"]["policy_digest"]["const"] = policy_digest
contract_path.write_text(json.dumps(contract, indent=2) + "\n", encoding="utf-8")
schema_digest = hashlib.sha256(contract_path.read_bytes()).hexdigest()
contract_path.with_suffix(contract_path.suffix + ".sha256").write_text(f"{schema_digest}  {contract_path.name}\n", encoding="utf-8")
source_path = plugin / "tooling" / "lazybuddy_capability_readiness.py"
source_path.write_text(re.sub(r'(READINESS_SCHEMA_SHA256: Final = ")[0-9a-f]{64}(")', rf'\g<1>{schema_digest}\2', source_path.read_text(encoding="utf-8")), encoding="utf-8")
PY

bash "$DISPOSABLE_TOOLING" readiness-report --tooling-root "$DISPOSABLE_ROOT" --target "$WORKSPACE" --json > "$TMP/regenerated-digest.json"
python3 - "$TMP/regenerated-digest.json" <<'PY'
import json
import sys
records = json.load(open(sys.argv[1], encoding="utf-8"))["records"]
assert "CONTRACT_INTEGRITY_INVALID" not in {record["reason_code"] for record in records}
assert {record["internal_status"] for record in records} != {"failed-optional"}
PY
CODEBUDDY_PLUGIN_ROOT="$DISPOSABLE_PLUGIN" bash "$DISPOSABLE_LOAD_CHECK" > "$TMP/regenerated-digest-load-check.out"
grep -Fqx 'PACKAGE_READINESS=full' "$TMP/regenerated-digest-load-check.out" || fail 'load-check did not return full after readiness contract regeneration'
pass 'invalid readiness integrity fails load-check and regenerated integrity restores readiness'

# Given a stale receipt-like root with no local host provider, when the report
# runs, then it fails closed as incompatible rather than claiming owned-ready.
mkdir "$TOOLING_ROOT"
printf '{not json}\n' > "$TOOLING_ROOT/.lazybuddy-tooling-receipt.json"
PATH="/usr/bin:/bin" bash "$TOOLING" readiness-report --tooling-root "$TOOLING_ROOT" --target "$WORKSPACE" --json > "$TMP/stale.json"
python3 - "$TMP/stale.json" <<'PY'
import json
import sys

records = {record["capability"]: record for record in json.load(open(sys.argv[1], encoding="utf-8"))["records"]}
assert records["local_search"]["internal_status"] == "incompatible"
assert records["structural_search"]["internal_status"] == "incompatible"
assert records["architecture_search"]["internal_status"] == "not-initialized"
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

printf 'v2 LazyBuddy capability readiness regression: PASS\n'
