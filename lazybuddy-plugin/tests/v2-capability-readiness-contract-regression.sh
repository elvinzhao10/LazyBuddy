#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-readiness-v2.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PYTHONPATH="$PLUGIN_ROOT/tooling" python3 - "$PLUGIN_ROOT" "$TMP" <<'PY'
import copy
import hashlib
import json
import pathlib
import sys

from lazybuddy_capability_readiness import (
    INTERNAL_STATE_MAPPING,
    normalize_v1_readiness_record,
    readiness_contract_integrity,
    validate_readiness_record,
)

plugin = pathlib.Path(sys.argv[1])
temporary = pathlib.Path(sys.argv[2])
contract = plugin / "contracts" / "lazyseries-capability-readiness.v2.json"
fixtures = plugin / "contracts" / "fixtures" / "readiness-v2"

raw = contract.read_bytes()
declared = contract.with_suffix(contract.suffix + ".sha256").read_text(encoding="utf-8").split()[0]
assert hashlib.sha256(raw).hexdigest() == declared
assert readiness_contract_integrity()

valid = json.loads((fixtures / "valid-package.json").read_text(encoding="utf-8"))
assert validate_readiness_record(valid, source_scope="package") == valid
injected = json.loads((fixtures / "prompt-injection.json").read_text(encoding="utf-8"))
assert validate_readiness_record(injected, source_scope="package")["readiness_scope"] == "package"
for line in (fixtures / "sha256sums.txt").read_text(encoding="utf-8").splitlines():
    digest, name = line.split()
    assert hashlib.sha256((fixtures / name).read_bytes()).hexdigest() == digest

expected_mapping = {
    "package-ready": ("invoke-documented", "documented-tested", "ready", "not-run", "package"),
    "owned-ready": ("invoke-documented", "documented-tested", "ready", "not-run", "package"),
    "missing": ("unavailable", "unavailable", "missing", "not-run", "package"),
    "incompatible": ("unavailable", "unavailable", "incompatible", "not-run", "package"),
    "disabled": ("descriptor-only", "documented-untested", "disabled", "not-run", "package"),
    "failed-optional": ("unavailable", "unavailable", "failed", "not-run", "package"),
    "not-initialized": ("descriptor-only", "documented-untested", "not-checked", "not-run", "package"),
    "probe-observed": ("observe-only", "observed-build-specific", "not-checked", "observed", "probe"),
    "current-session-ready": ("invoke-documented", "documented-tested", "ready", "observed", "current-session"),
}
assert INTERNAL_STATE_MAPPING == expected_mapping
assert set(INTERNAL_STATE_MAPPING) == set(expected_mapping)
unknown_status = copy.deepcopy(valid)
unknown_status["internal_status"] = "future-status"
try:
    validate_readiness_record(unknown_status, source_scope="package")
except ValueError as error:
    assert "internal_status" in str(error)
else:
    raise AssertionError("unknown internal status unexpectedly validated")

checksum = temporary / "contract.sha256"
checksum.write_text("0" * 64 + "  contract.json\n", encoding="utf-8")
assert not readiness_contract_integrity(contract, checksum)

for name, message, kwargs in (
    ("missing-evidence.json", "evidence", {"source_scope": "package"}),
    ("unknown-version.json", "contract_version", {"source_scope": "package"}),
    ("unknown-field.json", "unknown fields", {"source_scope": "package"}),
    ("forged-current-session.json", "current session", {"source_scope": "current-session", "current_session_id": "session-real"}),
):
    value = json.loads((fixtures / name).read_text(encoding="utf-8"))
    try:
        validate_readiness_record(value, **kwargs)
    except ValueError as error:
        assert message in str(error)
    else:
        raise AssertionError(f"{name} unexpectedly validated")
forged = json.loads((fixtures / "forged-current-session.json").read_text(encoding="utf-8"))
try:
    validate_readiness_record(forged, source_scope="package")
except ValueError as error:
    assert "package evidence" in str(error)
else:
    raise AssertionError("package evidence unexpectedly emitted current-session readiness")

legacy = {
    "schema_version": 1,
    "contract_version": "0.18.0",
    "contract_digest": valid["policy_digest"],
    "host": "lazybuddy",
    "capability": "local_search",
    "provider": "rg",
    "status": "package-ready",
    "readiness_scope": "package-ready",
    "reason_code": None,
    "message": "legacy",
    "receipt": None,
    "details": {"source": "host"},
}
before = copy.deepcopy(legacy)
normalized = normalize_v1_readiness_record(legacy)
assert legacy == before
assert normalized["schema_version"] == 2
assert normalized["host"] == "codebuddy-cli"
assert validate_readiness_record(normalized, source_scope="package") == normalized
PY

python3 "$PLUGIN_ROOT/tooling/lazybuddy_capability_readiness.py" readiness-report \
    --tooling-root "$TMP/missing" --json >"$TMP/report.json"
python3 - "$TMP/report.json" <<'PY'
import json
import pathlib
import sys

records = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["records"]
assert records
assert all(record["schema_version"] == 2 for record in records)
assert all(record["contract_version"] == "2.0.0" for record in records)
assert all(record["host"] == "codebuddy-cli" for record in records)
assert all(record["readiness_scope"] == "package" for record in records)
assert all(record["public_label"] != "observed-build-specific" for record in records)
PY

printf 'v2 LazyBuddy capability readiness contract regression: PASS\n'
