#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

python3 - "$PLUGIN_ROOT" <<'PY'
import json
import os
import sys

root = os.path.realpath(sys.argv[1])
failed = False

def result(state, label, detail):
    global failed
    print(f"{state} {label}: {detail}")
    if state == "FAIL":
        failed = True

def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        result("FAIL", label, "missing")
        return None
    except (OSError, json.JSONDecodeError) as exc:
        result("FAIL", label, f"invalid JSON ({exc})")
        return None
    if not isinstance(value, dict):
        result("FAIL", label, "must be a JSON object")
        return None
    result("PASS", label, "valid JSON")
    return value

def count_files(label, directory, expected, predicate):
    if not os.path.isdir(directory):
        result("FAIL", label, f"directory missing (0/{expected})")
        return
    actual = sum(1 for base, _, names in os.walk(directory) for name in names if predicate(base, name))
    result("PASS" if actual == expected else "FAIL", label, f"{actual}/{expected}")

print("=== LazyBuddy Package Readiness Check ===")
print(f"Plugin root: {root}")

if not os.path.isdir(root):
    result("FAIL", "plugin root", "directory missing")
    print("PACKAGE_READINESS=failed")
    sys.exit(1)

skills_dir = os.path.join(root, "skills")
skill_count = sum(
    1 for base, _, names in os.walk(skills_dir)
    if "SKILL.md" in names and os.path.basename(base).startswith("lazy-")
) if os.path.isdir(skills_dir) else 0
code_manifest_path = os.path.join(root, ".codebuddy-plugin", "plugin.json")
work_manifest_path = os.path.join(root, ".workbuddy-plugin", "plugin.json")

if not os.path.exists(code_manifest_path) and not os.path.exists(work_manifest_path) and skill_count:
    print(f"DEGRADED skills: {skill_count} discovered in manual skill-only fallback")
    print("UNCHECKED commands/hooks/MCP: not installed by the manual skill-only fallback")
    print("PACKAGE_READINESS=degraded")
    print("Package readiness is degraded; host registration and runtime loading are unchecked.")
    sys.exit(0)

expected_components = {
    "skills": ["./skills/"],
    "commands": ["./commands/"],
    "agents": ["./agents/"],
    "hooks": ["./hooks/hooks.json"],
    "mcpServers": ["./.mcp.json"],
}
manifests = {}
for host, path in (("CodeBuddy manifest", code_manifest_path), ("WorkBuddy manifest", work_manifest_path)):
    manifest = load_json(path, host)
    manifests[host] = manifest
    if manifest is None:
        continue
    if manifest.get("name") != "lazybuddy":
        result("FAIL", f"{host} name", "expected 'lazybuddy'")
    else:
        result("PASS", f"{host} name", "lazybuddy")
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        result("FAIL", f"{host} version", "missing or invalid")
    else:
        result("PASS", f"{host} version", version)
    for key, expected in expected_components.items():
        actual = manifest.get(key)
        if actual == expected:
            result("PASS", f"{host} {key}", "declared")
        else:
            result("FAIL", f"{host} {key}", f"expected {expected!r}, got {actual!r}")

code_manifest = manifests["CodeBuddy manifest"]
work_manifest = manifests["WorkBuddy manifest"]
if code_manifest is not None and work_manifest is not None:
    if code_manifest.get("version") == work_manifest.get("version"):
        result("PASS", "host manifest version agreement", str(code_manifest.get("version")))
    else:
        result("FAIL", "host manifest version agreement", f"CodeBuddy={code_manifest.get('version')!r}, WorkBuddy={work_manifest.get('version')!r}")

marketplace_path = os.environ.get("LAZYBUDDY_MARKETPLACE_FILE")
if not marketplace_path:
    candidates = [
        os.path.join(root, ".codebuddy-plugin", "marketplace.json"),
        os.path.join(os.path.dirname(root), ".codebuddy-plugin", "marketplace.json"),
    ]
    marketplace_path = next((path for path in candidates if os.path.isfile(path)), "")
if marketplace_path:
    marketplace = load_json(marketplace_path, "marketplace metadata")
    entries = marketplace.get("plugins", []) if marketplace else []
    entry = next((item for item in entries if isinstance(item, dict) and item.get("name") == "lazybuddy"), None)
    if entry is None:
        result("FAIL", "marketplace LazyBuddy entry", "missing")
    elif code_manifest is not None and entry.get("version") != code_manifest.get("version"):
        result("FAIL", "marketplace version agreement", f"marketplace={entry.get('version')!r}, manifest={code_manifest.get('version')!r}")
    else:
        result("PASS", "marketplace version agreement", str(entry.get("version")))
else:
    print("UNCHECKED marketplace metadata: not packaged with this installed plugin root")

count_files("skills", skills_dir, 14, lambda base, name: name == "SKILL.md" and os.path.basename(base).startswith("lazy-"))
count_files("commands", os.path.join(root, "commands"), 14, lambda _base, name: name.endswith(".md"))
count_files("agents", os.path.join(root, "agents"), 13, lambda _base, name: name.endswith(".md"))

hooks = load_json(os.path.join(root, "hooks", "hooks.json"), "hooks configuration")
if hooks is not None:
    actual = hooks.get("hooks")
    count = len(actual) if isinstance(actual, dict) else -1
    result("PASS" if count == 12 else "FAIL", "hooks", f"{count}/12")

mcp = load_json(os.path.join(root, ".mcp.json"), "MCP configuration")
if mcp is not None:
    actual = mcp.get("mcpServers")
    count = len(actual) if isinstance(actual, dict) else -1
    result("PASS" if count == 6 else "FAIL", "MCP servers", f"{count}/6")

contract_path = os.path.join(root, "contracts", "automatic-tooling-contract.v1.json")
contract_digest_path = contract_path + ".sha256"
policy_adapter_path = os.path.join(root, "tooling", "lazybuddy_policy.py")
try:
    import hashlib
    with open(contract_path, "rb") as handle:
        contract_bytes = handle.read()
    with open(contract_digest_path, encoding="utf-8") as handle:
        expected_digest = handle.read().split()[0]
    contract = json.loads(contract_bytes)
    if (
        hashlib.sha256(contract_bytes).hexdigest() != expected_digest
        or contract.get("schema") != "lazy-series.automatic-tooling.contract"
        or contract.get("schema_version") != 1
    ):
        raise ValueError("invalid contract digest or schema")
except (FileNotFoundError, IndexError, OSError, ValueError, json.JSONDecodeError) as exc:
    result("FAIL", "automatic tooling contract", str(exc))
else:
    result("PASS", "automatic tooling contract", "verified")

if os.path.isfile(policy_adapter_path):
    result("PASS", "provider policy adapter", "present")
else:
    result("FAIL", "provider policy adapter", "missing")

if failed:
    print("PACKAGE_READINESS=failed")
    print("Package readiness failed. Reinstall the full plugin or correct the named package file.")
    sys.exit(1)

print("PACKAGE_READINESS=full")
print("Package files are ready. Host registration, runtime loading, and MCP connection remain unchecked.")
PY
