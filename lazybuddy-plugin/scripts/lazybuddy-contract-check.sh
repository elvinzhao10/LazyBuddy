#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd -P)}"
CONTRACT="$PLUGIN_ROOT/contracts/automatic-tooling-contract.v1.json"
SIDECAR="$CONTRACT.sha256"

python3 - "$CONTRACT" "$SIDECAR" <<'PY'
import hashlib
import json
import os
import sys
import tempfile

contract_path, sidecar_path = sys.argv[1:]
expected_providers = {
    "ripgrep", "ast_grep", "lsp", "codegraph", "context7", "web", "grep_app", "playwright", "filesystem",
}
expected_capabilities = {
    "local_search", "structural_search", "code_navigation", "architecture_search", "documentation_search",
    "web_search", "external_code_search", "browser_automation", "filesystem_read",
}

def fail(message):
    raise AssertionError(message)

def read_contract(snapshot, checksum):
    if not os.path.isfile(snapshot):
        fail(f"missing contract snapshot: {snapshot}")
    if not os.path.isfile(checksum):
        fail(f"missing contract checksum: {checksum}")
    with open(snapshot, "rb") as handle:
        raw = handle.read()
    with open(checksum, encoding="utf-8") as handle:
        declared = handle.read().strip().split()[0]
    if len(declared) != 64 or any(character not in "0123456789abcdefABCDEF" for character in declared):
        fail("checksum must be a SHA-256 hex digest")
    if hashlib.sha256(raw).hexdigest() != declared.lower():
        fail("contract checksum mismatch")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"malformed contract JSON: {exc}")
    if value.get("schema") != "lazy-series.automatic-tooling.contract" or value.get("schema_version") != 1:
        fail("unknown schema versions are rejected")
    if value.get("contract_version") != "1.1.0":
        fail("unexpected contract version")
    providers = value.get("providers")
    if not isinstance(providers, dict) or set(providers) != expected_providers:
        fail("unknown providers are rejected")
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, dict) or set(capabilities) != expected_capabilities:
        fail("unknown capabilities are rejected")
    for capability, definition in capabilities.items():
        if not isinstance(definition, dict) or definition.get("id") != capability:
            fail(f"canonical capability id mismatch: {capability}")
        provider_ids = definition.get("providers")
        fallback_ids = definition.get("fallbacks")
        if not isinstance(provider_ids, list) or not provider_ids:
            fail(f"capability needs a provider: {capability}")
        if not isinstance(fallback_ids, list):
            fail(f"capability needs explicit fallbacks: {capability}")
        if any(provider not in providers for provider in provider_ids):
            fail(f"unknown provider reference: {capability}")
        if any(fallback not in capabilities for fallback in fallback_ids):
            fail(f"unknown fallback reference: {capability}")
    for field in ("permissions", "provenance", "automatic_provisioning", "operating_bounds", "timeouts", "error_types", "cost_egress_data_policy"):
        if not isinstance(value.get(field), dict):
            fail(f"missing {field}")
    if value["automatic_provisioning"].get("local_foundation") != {
        "providers": ["ripgrep", "ast_grep", "lsp"],
        "install_and_use": "allowed_without_interruption",
        "destination": "private_receipt_owned_lazyseries_toolpack",
        "lsp": "matching_workspace_language_only",
        "download": "version_pinned_normal_size_only",
        "forbid_writes": ["target_repository_dependencies", "target_repository_lockfiles", "host_configuration"],
    }:
        fail("local foundation automatic provisioning must remain narrowly allowed")
    if value["automatic_provisioning"].get("ask_once") != {
        "providers": ["codegraph", "playwright"],
        "conditions": ["unusual_large_tooling_or_models", "outside_root_access"],
    }:
        fail("large, architecture, browser, and outside-root work must remain ask-once")
    if value["automatic_provisioning"].get("remote") != {
        "costs": "ask_once",
        "credentials_or_auth": "ask_once",
        "writes": "ask_once",
        "egress": "explicit_provider_selection",
    }:
        fail("remote sensitive operations must remain approved")
    return value

contract = read_contract(contract_path, sidecar_path)
with tempfile.TemporaryDirectory(prefix="lazybuddy-contract-check-") as temporary:
    snapshot = os.path.join(temporary, "contract.json")
    checksum = f"{snapshot}.sha256"
    with open(snapshot, "wb") as handle:
        handle.write(open(contract_path, "rb").read())
    with open(checksum, "w", encoding="utf-8") as handle:
        handle.write(open(sidecar_path, encoding="utf-8").read())
    with open(snapshot, "a", encoding="utf-8") as handle:
        handle.write("\n")
    try:
        read_contract(snapshot, checksum)
    except AssertionError as exc:
        assert str(exc) == "contract checksum mismatch"
    else:
        fail("tampered contract must fail checksum validation")
    with open(snapshot, "w", encoding="utf-8") as handle:
        json.dump(contract, handle)
    with open(checksum, "w", encoding="utf-8") as handle:
        handle.write(f"{hashlib.sha256(open(snapshot, 'rb').read()).hexdigest()}\n")
    contract["capabilities"]["unknown_capability"] = {"id": "unknown_capability", "providers": ["ripgrep"], "fallbacks": []}
    with open(snapshot, "w", encoding="utf-8") as handle:
        json.dump(contract, handle)
    with open(checksum, "w", encoding="utf-8") as handle:
        handle.write(f"{hashlib.sha256(open(snapshot, 'rb').read()).hexdigest()}\n")
    try:
        read_contract(snapshot, checksum)
    except AssertionError as exc:
        assert str(exc) == "unknown capabilities are rejected"
    else:
        fail("unknown capability must fail validation")
    contract = read_contract(contract_path, sidecar_path)
    contract["automatic_provisioning"]["local_foundation"]["install_and_use"] = "ask_once"
    with open(snapshot, "w", encoding="utf-8") as handle:
        json.dump(contract, handle)
    with open(checksum, "w", encoding="utf-8") as handle:
        handle.write(f"{hashlib.sha256(open(snapshot, 'rb').read()).hexdigest()}\n")
    try:
        read_contract(snapshot, checksum)
    except AssertionError as exc:
        assert str(exc) == "local foundation automatic provisioning must remain narrowly allowed"
    else:
        fail("prior explicit-enablement policy must fail validation")

print("PASS: automatic tooling contract is self-contained, checksummed, schema-validated, and canonical")
PY
