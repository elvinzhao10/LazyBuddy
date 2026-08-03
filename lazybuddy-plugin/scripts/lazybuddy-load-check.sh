#!/usr/bin/env bash
# noqa: SIZE_OK - standalone package-readiness gate remains self-contained in installed plugins.
set -euo pipefail

reject_symlinked_path_components() {
    local remaining="${1#/}"
    local prefix=/
    local component
    local candidate

    while [ -n "$remaining" ]; do
        component="${remaining%%/*}"
        if [ "$component" = "$remaining" ]; then
            remaining=
        else
            remaining="${remaining#*/}"
        fi

        case "$component" in
            ''|.) continue ;;
            ..) prefix="$prefix/.."; continue ;;
        esac

        candidate="$prefix$component"
        if [ -L "$candidate" ] && ! is_macos_var_alias "$candidate"; then
            echo "CODEBUDDY_PLUGIN_ROOT path must not be symlinked" >&2
            exit 1
        fi
        prefix="$candidate/"
    done
}

is_macos_var_alias() {
    [ "$1" = /var ] && [ "$(CDPATH= cd -P -- /var && pwd)" = /private/var ]
}

if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    case "$CODEBUDDY_PLUGIN_ROOT" in
        /*)
            PLUGIN_ROOT="$CODEBUDDY_PLUGIN_ROOT"
            reject_symlinked_path_components "$PLUGIN_ROOT"
            ;;
        *)
            echo "CODEBUDDY_PLUGIN_ROOT must be an absolute path" >&2
            exit 1
            ;;
    esac
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

python3 - "$PLUGIN_ROOT" <<'PY'
import json
import os
import subprocess
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
    print("READINESS_SCOPE=manual-skills-mcp-fallback")
    print("Manual fallback exposes Skills and individually configured MCP only; agents, commands, and hooks remain unavailable.")
    print("PACKAGE_READINESS=degraded")
    print("Package readiness is degraded; host activation and runtime loading are unchecked.")
    sys.exit(0)

route_check = subprocess.run(
    ["node", os.path.join(root, "scripts", "lazybuddy-marketplace-route-check.js"), os.path.dirname(root)],
    check=False,
    capture_output=True,
    text=True,
)
if route_check.returncode == 0:
    result("PASS", "marketplace route contract", "CodeBuddy IDE and WorkBuddy marketplace defaults")
else:
    result("FAIL", "marketplace route contract", route_check.stderr.strip())

for legal_name in ("LICENSE", "NOTICE"):
    legal_path = os.path.join(root, legal_name)
    if os.path.isfile(legal_path):
        result("PASS", f"package {legal_name}", "present")
    else:
        result("FAIL", f"package {legal_name}", "missing from plugin root")

expected_components = {
    "commands": ["./commands/"],
    "agents": ["./agents/"],
    "hooks": ["./hooks/hooks.json"],
    "mcpServers": ["./.mcp.json"],
}

def resolve_skill_directories(manifest, host):
    """Return manifest-declared skill roots, or the host's default root."""
    if "skills" not in manifest:
        if host == "CodeBuddy manifest":
            result("PASS", f"{host} skills", "default discovery")
            return [skills_dir], "default"
        result("FAIL", f"{host} skills", "expected ['./skills/'], got missing")
        return [], "invalid"

    raw = manifest.get("skills")
    values = [raw] if isinstance(raw, str) else raw
    if not isinstance(values, list) or not values or any(not isinstance(value, str) or not value for value in values):
        result("FAIL", f"{host} skills", "must be a non-empty relative directory or array of directories")
        return [], "invalid"
    if host == "WorkBuddy manifest" and values != ["./skills/"]:
        result("FAIL", f"{host} skills", f"expected ['./skills/'], got {raw!r}")
        return [], "invalid"

    resolved = []
    for value in values:
        if os.path.isabs(value):
            result("FAIL", f"{host} skills", f"path must stay inside plugin root, got {value!r}")
            continue
        candidate = os.path.realpath(os.path.join(root, value))
        try:
            inside_root = os.path.commonpath((root, candidate)) == root
        except ValueError:
            inside_root = False
        if not inside_root:
            result("FAIL", f"{host} skills", f"path escapes plugin root, got {value!r}")
        elif not os.path.isdir(candidate):
            result("FAIL", f"{host} skills", f"directory missing: {value!r}")
        else:
            resolved.append(candidate)
    if resolved and len(resolved) == len(values):
        result("PASS", f"{host} skills", "declared")
        return resolved, "declared"
    return [], "invalid"

def inspect_skill_tree(directories, expected_count=None):
    actual = 0
    problems = []
    for directory in directories:
        if not os.path.isdir(directory):
            problems.append(f"directory missing: {directory}")
            continue
        children = sorted(
            (entry for entry in os.scandir(directory) if entry.is_dir(follow_symlinks=False)),
            key=lambda entry: entry.name,
        )
        if not children:
            problems.append(f"no skill directories under {directory}")
            continue
        for child in children:
            skill_path = os.path.join(child.path, "SKILL.md")
            if os.path.isfile(skill_path):
                actual += 1
            else:
                problems.append(f"missing {child.name}/SKILL.md")
    if expected_count is not None and actual != expected_count:
        problems.append(f"expected {expected_count} skills, found {actual}")
    return actual, problems

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

skill_directories = {}
skill_modes = {}
for host, manifest in manifests.items():
    if manifest is not None:
        skill_directories[host], skill_modes[host] = resolve_skill_directories(manifest, host)

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
    if marketplace is not None and marketplace.get("name") != "lazybuddy":
        result("FAIL", "marketplace name", f"expected 'lazybuddy', got {marketplace.get('name')!r}")
    elif marketplace is not None:
        result("PASS", "marketplace name", "lazybuddy")
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

skill_inventory_emitted = False
for host in ("CodeBuddy manifest", "WorkBuddy manifest"):
    directories = skill_directories.get(host, [])
    if not directories:
        continue
    is_default = skill_modes.get(host) == "default"
    expected_count = 14 if is_default or host == "WorkBuddy manifest" else None
    actual, problems = inspect_skill_tree(directories, expected_count)
    if is_default:
        label = "CodeBuddy default skills"
    elif host == "WorkBuddy manifest":
        label = "WorkBuddy skills"
    else:
        label = "CodeBuddy declared skills"
    if problems:
        result("FAIL", label, f"{actual} discovered; " + "; ".join(problems))
    else:
        result("PASS", label, f"{actual} discovered")
    if not skill_inventory_emitted:
        denominator = expected_count if expected_count is not None else actual
        result("PASS" if not problems else "FAIL", "skills", f"{actual}/{denominator}")
        skill_inventory_emitted = True

count_files("commands", os.path.join(root, "commands"), 14, lambda _base, name: name.endswith(".md"))
count_files("agents", os.path.join(root, "agents"), 13, lambda _base, name: name.endswith(".md"))

hooks = load_json(os.path.join(root, "hooks", "hooks.json"), "hooks configuration")
if hooks is not None:
    actual = hooks.get("hooks")
    count = len(actual) if isinstance(actual, dict) else -1
    result("PASS" if count == 25 else "FAIL", "hooks", f"{count}/25")

mcp = load_json(os.path.join(root, ".mcp.json"), "MCP configuration")
if mcp is not None:
    actual = mcp.get("mcpServers")
    count = len(actual) if isinstance(actual, dict) else -1
    result("PASS" if count == 6 else "FAIL", "MCP servers", f"{count}/6")
    profile_check = subprocess.run(
        [
            sys.executable,
            os.path.join(root, "scripts", "lazybuddy-mcp-profile.py"),
            "--mode", "orchestrated",
            "--project-dir", os.path.dirname(root),
            "--plugin-data", os.path.join(os.path.realpath(os.getenv("TMPDIR", "/tmp")), f"lazybuddy-profile-validation-{os.getpid()}"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if profile_check.returncode == 0:
        result("PASS", "MCP typed profile contract", "six typed declarations; core direct; optional deferred")
    else:
        result("FAIL", "MCP typed profile contract", profile_check.stderr.strip() or "profile validation failed")

contract_path = os.path.join(root, "contracts", "automatic-tooling-contract.v1.json")
contract_digest_path = contract_path + ".sha256"
policy_adapter_path = os.path.join(root, "tooling", "lazybuddy_policy.py")
readiness_adapter_path = os.path.join(root, "tooling", "lazybuddy_capability_readiness.py")
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

try:
    report = subprocess.run(
        [sys.executable, "-B", readiness_adapter_path, "readiness-report", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    records = json.loads(report.stdout).get("records")
    if (
        not isinstance(records, list)
        or len(records) != 9
        or any(record.get("reason_code") == "CONTRACT_INTEGRITY_INVALID" for record in records)
        or any(record.get("readiness_scope") == "current-session" for record in records)
        or any(record.get("readiness_scope") != "package" for record in records)
    ):
        raise ValueError("canonical report did not return nine integrity-valid records")
except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
    result("FAIL", "canonical capability readiness", str(exc))
else:
    result("PASS", "canonical capability readiness", "read-only report available; host and MCP connection remain unchecked")

if failed:
    print("PACKAGE_READINESS=failed")
    print("Package readiness failed. Reinstall the full plugin or correct the named package file.")
    sys.exit(1)

print("PACKAGE_READINESS=full")
print("READINESS_SCOPE=package-ready")
print("Package files are ready. Host activation, runtime loading, and MCP status remain unchecked.")
PY
