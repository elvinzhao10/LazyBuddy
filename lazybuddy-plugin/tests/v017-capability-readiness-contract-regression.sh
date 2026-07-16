#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACT="$PLUGIN_ROOT/contracts/lazyseries-capability-readiness.v1.json"
FIXTURE="$PLUGIN_ROOT/contracts/fixtures/v018/readiness-records.json"
POLICY_DIGEST='3a65e1d7108c1a607035cbb127117dc5c18d0116ddf88c3e9ca5aaa4db032c4a'

[ -f "$CONTRACT" ] || { printf 'FAIL: missing readiness contract\n' >&2; exit 1; }
[ -f "$CONTRACT.sha256" ] || { printf 'FAIL: missing readiness contract checksum\n' >&2; exit 1; }
[ -f "$FIXTURE" ] || { printf 'FAIL: missing readiness fixture\n' >&2; exit 1; }

python3 - "$CONTRACT" "$FIXTURE" "$POLICY_DIGEST" <<'PY'
import hashlib
import json
import pathlib
import sys

contract_path = pathlib.Path(sys.argv[1])
fixture_path = pathlib.Path(sys.argv[2])
policy_digest = sys.argv[3]
statuses = [
    "host-ready",
    "owned-ready",
    "missing",
    "incompatible",
    "disabled",
    "failed-optional",
    "not-initialized",
]

contract_bytes = contract_path.read_bytes()
checksum = contract_path.with_suffix(contract_path.suffix + ".sha256").read_text(encoding="utf-8").split()[0]
assert hashlib.sha256(contract_bytes).hexdigest() == checksum, "readiness contract checksum mismatch"
schema = json.loads(contract_bytes)
assert schema["schema_version"] == 1
assert schema["contract_version"] == "0.18.0"
properties = schema["properties"]
assert properties["contract_digest"]["const"] == policy_digest, "v1.1 automatic-tooling policy digest changed"
assert properties["status"]["enum"] == statuses, "status enum must remain exact and ordered"

records = json.loads(fixture_path.read_text(encoding="utf-8"))["records"]
required = set(schema["required"])
for record in records:
    assert set(record) == required, "record must contain exactly the required fields"
    assert record["schema_version"] == properties["schema_version"]["const"]
    assert record["contract_version"] == properties["contract_version"]["const"]
    assert record["contract_digest"] == properties["contract_digest"]["const"]
    assert record["host"] in properties["host"]["enum"]
    assert isinstance(record["capability"], str) and record["capability"]
    assert record["provider"] is None or isinstance(record["provider"], str)
    assert record["status"] in properties["status"]["enum"]
    assert record["reason_code"] is None or isinstance(record["reason_code"], str)
    assert isinstance(record["message"], str)
    assert isinstance(record["details"], dict)
    receipt = record["receipt"]
    if receipt is not None:
        assert set(receipt) == set(properties["receipt"]["required"])
        assert isinstance(receipt["owner"], str)
        assert receipt["schema_version"] == properties["receipt"]["properties"]["schema_version"]["const"]
        assert isinstance(receipt["state"], str)
assert {record["status"] for record in records} == set(statuses), "fixture must cover every readiness status"

invalid = dict(records[0])
invalid["status"] = "ready"
assert invalid["status"] not in properties["status"]["enum"], "temporary ready status copy must fail validation"
PY

printf 'v0.18 capability readiness contract regression: PASS\n'
