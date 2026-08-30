#!/bin/bash
# noqa: SIZE_OK - standalone release-gate script kept self-contained for plugin installs.
# lazybuddy-plugin-doctor.sh
# Validates the plugin structure: manifest exists + parses as JSON,
# all component dirs exist, all placeholder skills/commands present.
#
# Usage: ./scripts/lazybuddy-plugin-doctor.sh
# Env:   CODEBUDDY_PLUGIN_ROOT (if installed), otherwise defaults to script-relative plugin root.

set -euo pipefail

# Determine plugin root
if [ -n "${CODEBUDDY_PLUGIN_ROOT:-}" ]; then
    PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT}"
else
    PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
PROJECT_ROOT="$(cd "${PLUGIN_ROOT}/.." && pwd)"
RUNNER="${PLUGIN_ROOT}/scripts/lazybuddy-bounded-run.py"
HOST_VALIDATOR_TIMEOUT="${LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS:-15}"
DOCTOR_HOST="${LAZYBUDDY_DOCTOR_HOST:-package}"
PYTHON_REQUEST="${LAZYBUDDY_PYTHON:-python3}"
if ! PYTHON_BIN="$(command -v "$PYTHON_REQUEST" 2>/dev/null)"; then
    printf 'ERROR: LazyBuddy requires Python 3.10 or newer. Install Python 3.10+ and make it available as python3.\n' >&2
    exit 2
fi
PYTHON_VERSION="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info[0], sys.version_info[1])' 2>/dev/null || true)"
read -r PYTHON_MAJOR PYTHON_MINOR _ <<<"$PYTHON_VERSION"
if ! [[ "$PYTHON_MAJOR" =~ ^[0-9]+$ && "$PYTHON_MINOR" =~ ^[0-9]+$ ]] \
    || [ "$PYTHON_MAJOR" -lt 3 ] \
    || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]; }; then
    printf 'ERROR: LazyBuddy requires Python 3.10 or newer. Install Python 3.10+ and make it available as python3.\n' >&2
    exit 2
fi
HOST_VALIDATOR=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --host-validator)
            [ "$#" -ge 2 ] || {
                printf 'ERROR: --host-validator requires an absolute path\n' >&2
                exit 2
            }
            HOST_VALIDATOR="$2"
            shift 2
            ;;
        *)
            printf 'ERROR: unsupported doctor option: %s\n' "$1" >&2
            exit 2
            ;;
    esac
done

if [ -n "$HOST_VALIDATOR" ]; then
    case "$HOST_VALIDATOR" in
        /*) ;;
        *)
            printf 'ERROR: --host-validator must be an absolute executable file\n' >&2
            exit 2
            ;;
    esac
    if [ ! -f "$HOST_VALIDATOR" ] || [ ! -x "$HOST_VALIDATOR" ] || [ -L "$HOST_VALIDATOR" ]; then
        printf 'ERROR: --host-validator must be an absolute executable file\n' >&2
        exit 2
    fi
fi

PASS=0
FAIL=0
ERRORS=""

check() {
    local label="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  [PASS] $label"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $label — $result"
        FAIL=$((FAIL + 1))
        ERRORS="${ERRORS}\n  - $label: $result"
    fi
}

validator_reports_success() {
    local result_file="$1"
    "$PYTHON_BIN" - "$result_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
if result.get("status") != "pass" or result.get("reason") != "ok":
    raise SystemExit(1)
output = result.get("tail")
if not isinstance(output, str):
    raise SystemExit(1)
output = output.strip()
if output in {"Validation successful: 0 errors", "Validation passed with no errors"}:
    raise SystemExit(0)

structured_output = output
for prefix in ("Validation passed with details:", "Validation passed"):
    if not output.startswith(prefix):
        continue
    remainder = output[len(prefix):]
    if not remainder or not remainder[0].isspace():
        raise SystemExit(1)
    structured_output = remainder.lstrip()
    break

decoder = json.JSONDecoder()
try:
    validator_result, consumed = decoder.raw_decode(structured_output)
except json.JSONDecodeError:
    raise SystemExit(1)
if structured_output[consumed:].strip():
    raise SystemExit(1)
if not isinstance(validator_result, dict):
    raise SystemExit(1)

def has_nonempty_error(result):
    for field in ("errors", "error"):
        if field not in result:
            continue
        value = result[field]
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return True
            continue
        if value:
            return True
    return False

if validator_result.get("valid") is True and not has_nonempty_error(validator_result):
    raise SystemExit(0)
raise SystemExit(1)
PY
}

if ! [[ "$HOST_VALIDATOR_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
    printf 'ERROR: LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS must be a positive integer\n' >&2
    exit 2
fi
case "$DOCTOR_HOST" in
    package|codebuddy-cli|codebuddy-ide|workbuddy) ;;
    *)
        printf 'ERROR: LAZYBUDDY_DOCTOR_HOST must be package, codebuddy-cli, codebuddy-ide, or workbuddy\n' >&2
        exit 2
        ;;
esac

echo "=== LazyBuddy Plugin Doctor ==="
echo "Plugin root: ${PLUGIN_ROOT}"
echo ""

for legal_file in LICENSE NOTICE; do
    if [ -f "${PLUGIN_ROOT}/${legal_file}" ]; then
        check "Package legal file: ${legal_file}" ok
    else
        check "Package legal file: ${legal_file}" "missing from plugin root"
    fi
done

# 1-3. Both host manifests exist, parse, and describe the same plugin contract.
CODEBUDDY_MANIFEST="${PLUGIN_ROOT}/.codebuddy-plugin/plugin.json"
WORKBUDDY_MANIFEST="${PLUGIN_ROOT}/.workbuddy-plugin/plugin.json"
for host_manifest in "CodeBuddy:${CODEBUDDY_MANIFEST}" "WorkBuddy:${WORKBUDDY_MANIFEST}"; do
    HOST="${host_manifest%%:*}"
    MANIFEST="${host_manifest#*:}"
    if [ -f "$MANIFEST" ]; then
        check "$HOST manifest exists" ok
    else
        check "$HOST manifest exists" "missing: $MANIFEST"
    fi
    if "$PYTHON_BIN" - "$MANIFEST" <<'PY' 2>/dev/null
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    assert isinstance(json.load(handle), dict)
PY
    then
        check "$HOST manifest is valid JSON" ok
    else
        check "$HOST manifest is valid JSON" "parse error"
    fi
    FIELDS="name version commands agents hooks mcpServers"
    if [ "$HOST" = "WorkBuddy" ]; then
        FIELDS="${FIELDS} skills"
    fi
    for field in $FIELDS; do
        if "$PYTHON_BIN" - "$MANIFEST" "$field" <<'PY' 2>/dev/null
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
assert sys.argv[2] in data
PY
        then
            check "$HOST manifest field: ${field}" ok
        else
            check "$HOST manifest field: ${field}" "missing"
        fi
    done
done

if codebuddy_skills=$("$PYTHON_BIN" - "$CODEBUDDY_MANIFEST" "$PLUGIN_ROOT" <<'PY' 2>&1
import json
import os
import sys

manifest_path, root = sys.argv[1:]
root = os.path.realpath(root)
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)
raw = manifest.get("skills")
mode = "declared"
if raw is None:
    values = ["./skills/"]
    mode = "default discovery"
elif isinstance(raw, str):
    values = [raw]
else:
    values = raw
if not isinstance(values, list) or not values or any(not isinstance(value, str) or not value for value in values):
    raise SystemExit("must be a non-empty relative directory or array of directories")
count = 0
for value in values:
    if os.path.isabs(value):
        raise SystemExit(f"path must stay inside plugin root: {value}")
    directory = os.path.realpath(os.path.join(root, value))
    try:
        inside_root = os.path.commonpath([root, directory]) == root
    except ValueError:
        inside_root = False
    if not inside_root:
        raise SystemExit(f"path escapes plugin root: {value}")
    if not os.path.isdir(directory):
        raise SystemExit(f"directory missing: {value}")
    children = sorted(
        (entry for entry in os.scandir(directory) if entry.is_dir(follow_symlinks=False)),
        key=lambda entry: entry.name,
    )
    if not children:
        raise SystemExit(f"no skill directories under {value}")
    for child in children:
        if not os.path.isfile(os.path.join(child.path, "SKILL.md")):
            raise SystemExit(f"missing {child.name}/SKILL.md")
        count += 1
if mode == "default discovery" and count != 14:
    raise SystemExit(f"expected 14 default skills, found {count}")
print(f"{mode}: {count} skill(s)")
PY
); then
    check "CodeBuddy skills discovery" ok
    echo "  [INFO] CodeBuddy skills: $codebuddy_skills"
else
    check "CodeBuddy skills discovery" "$codebuddy_skills"
fi

if agreement=$("$PYTHON_BIN" - "$CODEBUDDY_MANIFEST" "$WORKBUDDY_MANIFEST" "${PROJECT_ROOT}/.codebuddy-plugin/marketplace.json" <<'PY' 2>&1
import json
import os
import sys

code_path, work_path, marketplace_path = sys.argv[1:]
with open(code_path, encoding="utf-8") as handle:
    code = json.load(handle)
with open(work_path, encoding="utf-8") as handle:
    work = json.load(handle)
if code.get("name") != "lazybuddy" or work.get("name") != "lazybuddy":
    raise SystemExit("host manifest name must be lazybuddy")
if not isinstance(code.get("version"), str) or code["version"] != work.get("version"):
    raise SystemExit("host manifest versions do not agree")
if os.path.exists(marketplace_path):
    with open(marketplace_path, encoding="utf-8") as handle:
        marketplace = json.load(handle)
    entry = next((item for item in marketplace.get("plugins", []) if item.get("name") == "lazybuddy"), None)
    if entry is None or entry.get("version") != code["version"]:
        raise SystemExit("marketplace version does not agree with host manifests")
print(code["version"])
PY
); then
    check "Host/marketplace version agreement" ok
    echo "  [INFO] Host/marketplace version: $agreement"
else
    check "Host/marketplace version agreement" "$agreement"
fi

if route_contract=$(node "${PLUGIN_ROOT}/scripts/lazybuddy-marketplace-route-check.js" "$PROJECT_ROOT" 2>&1); then
    check "Marketplace route contract" ok
    echo "  [INFO] Marketplace routes: $route_contract"
else
    check "Marketplace route contract" "$route_contract"
fi

if machine_status=$(node "${PLUGIN_ROOT}/scripts/lazybuddy-machine-status.js" --json 2>&1) \
    && "$PYTHON_BIN" - "$machine_status" <<'PY'
import json
import sys

status = json.loads(sys.argv[1])
assert status.get("schema_version") == 2
assert status.get("version") == "1.2.1"
assert status.get("package_readiness") == {"status": "ready", "scope": "package"}
assert status.get("host_readiness") == {"status": "pending"}
hosts = status.get("hosts")
assert isinstance(hosts, list)
assert [row.get("host") for row in hosts] == ["codebuddy-cli", "codebuddy-ide", "workbuddy"]
assert all(row.get("host_readiness") == "pending" for row in hosts)
PY
then
    check "Machine status v2" ok
else
    check "Machine status v2" "invalid or unavailable"
fi

if [ "$DOCTOR_HOST" = "codebuddy-ide" ] || [ "$DOCTOR_HOST" = "workbuddy" ]; then
    echo "  [SKIP] CodeBuddy manifest validator — CLI-only validator not applicable to ${DOCTOR_HOST}"
elif [ -n "$HOST_VALIDATOR" ]; then
    validator_result="$(mktemp "${TMPDIR:-/tmp}/lazybuddy-host-validator.XXXXXX")"
    if "$PYTHON_BIN" "$RUNNER" --label "CodeBuddy manifest validator" --timeout "$HOST_VALIDATOR_TIMEOUT" --result-file "$validator_result" -- "$HOST_VALIDATOR" plugin validate "$PLUGIN_ROOT"; then
        validator_output="$("$PYTHON_BIN" - "$validator_result" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["tail"])
PY
)"
        if validator_reports_success "$validator_result"; then
            check "CodeBuddy manifest validator" ok
        else
            check "CodeBuddy manifest validator" "$validator_output"
        fi
    else
        validator_state="$("$PYTHON_BIN" - "$validator_result" <<'PY'
import json
import sys
result = json.load(open(sys.argv[1], encoding="utf-8"))
print(f'{result["status"]} {result["reason"]}')
PY
)"
        if [ "$validator_state" = "timeout deadline_exceeded" ]; then
            if [ "$DOCTOR_HOST" = "package" ]; then
                echo "  [UNCHECKED] CodeBuddy manifest validator — timeout; package validation remains unverified"
            else
                check "CodeBuddy manifest validator" "timeout"
            fi
        elif [ "$validator_state" = "unavailable launch_error" ]; then
            if [ "$DOCTOR_HOST" = "package" ]; then
                echo "  [UNCHECKED] CodeBuddy manifest validator — unavailable; package validation remains unverified"
            else
                check "CodeBuddy manifest validator" "unavailable"
            fi
        else
            check "CodeBuddy manifest validator" "validation command failed"
        fi
    fi
    rm -f "$validator_result"
else
    if [ "$DOCTOR_HOST" = "package" ]; then
        echo "  [SKIP] CodeBuddy manifest validator — package-only default; pass --host-validator /absolute/path to opt in"
    else
        check "CodeBuddy manifest validator" "--host-validator /absolute/path is required"
    fi
fi

# 4. Component directories exist
for dir in skills commands agents hooks mcp scripts schemas tests docs; do
    if [ -d "${PLUGIN_ROOT}/${dir}" ]; then
        check "Directory: ${dir}/" ok
    else
        check "Directory: ${dir}/" "missing"
    fi
done

# 5. Hooks scaffold exists
if [ -f "${PLUGIN_ROOT}/hooks/hooks.json" ]; then
    check "hooks/hooks.json exists" ok
    if "$PYTHON_BIN" -c "import json; json.load(open('${PLUGIN_ROOT}/hooks/hooks.json'))" 2>/dev/null; then
        check "hooks/hooks.json is valid JSON" ok
    else
        check "hooks/hooks.json is valid JSON" "parse error"
    fi
else
    check "hooks/hooks.json exists" "missing"
fi

# 6. MCP scaffold exists
if [ -f "${PLUGIN_ROOT}/.mcp.json" ]; then
    check ".mcp.json exists" ok
    if "$PYTHON_BIN" -c "import json; json.load(open('${PLUGIN_ROOT}/.mcp.json'))" 2>/dev/null; then
        check ".mcp.json is valid JSON" ok
    else
        check ".mcp.json is valid JSON" "parse error"
    fi
else
    check ".mcp.json exists" "missing"
fi

PROFILE_VALIDATION_DATA="${TMPDIR:-/tmp}/lazybuddy-doctor-profile-data-$$"
if profile_result=$("$PYTHON_BIN" "${PLUGIN_ROOT}/scripts/lazybuddy-mcp-profile.py" \
    --mode orchestrated \
    --project-dir "$PROJECT_ROOT" \
    --plugin-data "$PROFILE_VALIDATION_DATA" 2>&1); then
    check "MCP typed profile contract" ok
else
    check "MCP typed profile contract" "$profile_result"
fi

if contract_result=$("$PYTHON_BIN" - "${PLUGIN_ROOT}" <<'PY' 2>&1
import hashlib
import json
import os
import sys

root = sys.argv[1]
contract_path = os.path.join(root, "contracts", "automatic-tooling-contract.v1.json")
digest_path = contract_path + ".sha256"
policy_path = os.path.join(root, "tooling", "lazybuddy_policy.py")
try:
    with open(contract_path, "rb") as handle:
        contract_bytes = handle.read()
    with open(digest_path, encoding="utf-8") as handle:
        expected_digest = handle.read().split()[0]
    contract = json.loads(contract_bytes)
    if hashlib.sha256(contract_bytes).hexdigest() != expected_digest:
        raise ValueError("contract digest mismatch")
    if contract.get("schema") != "lazy-series.automatic-tooling.contract" or contract.get("schema_version") != 1:
        raise ValueError("contract schema mismatch")
    if not os.path.isfile(policy_path):
        raise ValueError("provider policy adapter missing")
except (OSError, IndexError, ValueError, json.JSONDecodeError) as exc:
    raise SystemExit(str(exc))
print("ok")
PY
); then
    check "Automatic tooling contract and provider adapter" ok
else
    check "Automatic tooling contract and provider adapter" "$contract_result"
fi

if readiness_result=$("$PYTHON_BIN" - "${PLUGIN_ROOT}" <<'PY' 2>&1
import json
import os
import subprocess
import sys

root = sys.argv[1]
adapter = os.path.join(root, "tooling", "lazybuddy_capability_readiness.py")
try:
    completed = subprocess.run(
        [sys.executable, "-B", adapter, "readiness-report", "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
except subprocess.CalledProcessError as error:
    raise SystemExit(error.stderr.strip() or "canonical readiness report failed")
records = json.loads(completed.stdout).get("records")
if (
    not isinstance(records, list)
    or len(records) != 9
    or any(record.get("readiness_scope") == "current-session" for record in records)
    or any(record.get("readiness_scope") != "package" for record in records)
):
    raise SystemExit("canonical readiness report did not return nine records")
print("ok")
PY
); then
    check "Canonical capability readiness report" ok
else
    check "Canonical capability readiness report" "$readiness_result"
fi

if hook_result=$("$PYTHON_BIN" - "${PLUGIN_ROOT}" <<'PY' 2>&1
import json
import os
import shlex
import sys

root = os.path.realpath(sys.argv[1])
hooks_path = os.path.join(root, "hooks", "hooks.json")
expected_events = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "Stop",
    "StopFailure",
    "TaskCreated",
    "TaskCompleted",
    "SubagentStart",
    "SubagentStop",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "PostCompact",
    "SessionEnd",
    "InstructionsLoaded",
    "ConfigChange",
    "CwdChanged",
    "FileChanged",
    "WorktreeCreate",
    "WorktreeRemove",
    "Elicitation",
    "ElicitationResult",
]
errors = []

def under_root(path):
    try:
        return os.path.commonpath([root, path]) == root
    except ValueError:
        return False

try:
    with open(hooks_path) as f:
        hooks = json.load(f).get("hooks", {})
except Exception as exc:
    print(f"hooks parse error: {exc}")
    sys.exit(1)

if not isinstance(hooks, dict):
    print("hooks must be an object")
    sys.exit(1)

missing = [event for event in expected_events if event not in hooks]
extra = sorted(event for event in hooks if event not in expected_events)
if missing:
    errors.append("missing hook events: " + ", ".join(missing))
if extra:
    errors.append("unexpected hook events: " + ", ".join(extra))

targets = []
for event in expected_events:
    event_targets = []
    for group_index, group in enumerate(hooks.get(event, [])):
        for hook_index, hook in enumerate(group.get("hooks", [])):
            if hook.get("type") != "command":
                continue
            command = hook.get("command", "")
            try:
                parts = shlex.split(command)
            except ValueError as exc:
                errors.append(f"{event}[{group_index}:{hook_index}] command parse error: {exc}")
                continue
            resolved_parts = [part.replace("${CODEBUDDY_PLUGIN_ROOT}", root) for part in parts]
            candidates = []
            for part in resolved_parts[1:] + resolved_parts[:1]:
                real = os.path.realpath(part)
                if os.path.isabs(part) and under_root(real):
                    candidates.append(real)
            if not candidates:
                errors.append(f"{event}[{group_index}:{hook_index}] command has no plugin-root target")
                continue
            target = candidates[0]
            event_targets.append(target)
            targets.append((event, target))
            if not os.path.exists(target):
                errors.append(f"{event} missing hook target: {target}")
            elif not os.path.isfile(target):
                errors.append(f"{event} hook target is not a file: {target}")
            elif not os.access(target, os.X_OK):
                errors.append(f"{event} hook target is not executable: {target}")
    if len(event_targets) != 1:
        errors.append(f"{event} has {len(event_targets)} command targets, expected 1")

if len(targets) != 25:
    errors.append(f"hook command target count is {len(targets)}, expected 25")

if errors:
    print("; ".join(errors))
    sys.exit(1)
print("ok")
PY
); then
    check "Hook command targets (25 executable)" ok
else
    check "Hook command targets (25 executable)" "${hook_result}"
fi

if mcp_result=$("$PYTHON_BIN" - "${PLUGIN_ROOT}" <<'PY' 2>&1
import json
import os
import sys

root = os.path.realpath(sys.argv[1])
mcp_path = os.path.join(root, ".mcp.json")
errors = []

def under_root(path):
    try:
        return os.path.commonpath([root, path]) == root
    except ValueError:
        return False

try:
    with open(mcp_path) as f:
        servers = json.load(f).get("mcpServers", {})
except Exception as exc:
    print(f"mcp parse error: {exc}")
    sys.exit(1)

if not isinstance(servers, dict):
    print("mcpServers must be an object")
    sys.exit(1)

if len(servers) != 6:
    errors.append(f"mcp server count is {len(servers)}, expected 6")

for name, server in sorted(servers.items()):
    if server.get("command") != "bash":
        errors.append(f"{name} command is {server.get('command')!r}, expected 'bash'")
    args = server.get("args")
    if not isinstance(args, list):
        errors.append(f"{name} args must be a list")
        continue
    script = None
    for arg in args:
        if not isinstance(arg, str):
            continue
        resolved = os.path.realpath(arg.replace("${CODEBUDDY_PLUGIN_ROOT}", root))
        if resolved.endswith(".sh"):
            script = resolved
            break
    if script is None:
        errors.append(f"{name} has no shell script arg")
        continue
    if not under_root(script):
        errors.append(f"{name} script is outside plugin root: {script}")
    elif not os.path.exists(script):
        errors.append(f"{name} missing MCP server script: {script}")
    elif not os.path.isfile(script):
        errors.append(f"{name} MCP server script is not a file: {script}")
    elif not os.access(script, os.X_OK):
        errors.append(f"{name} MCP server script is not executable: {script}")

if errors:
    print("; ".join(errors))
    sys.exit(1)
print("ok")
PY
); then
    check "MCP server scripts (6 executable)" ok
else
    check "MCP server scripts (6 executable)" "${mcp_result}"
fi

if [ -d "${PLUGIN_ROOT}/commands" ]; then
    command_count=$(find "${PLUGIN_ROOT}/commands" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
    if [ "$command_count" -eq 14 ]; then
        check "Command definitions (14)" ok
    else
        check "Command definitions (14)" "found: ${command_count}"
    fi
else
    check "Command definitions (14)" "directory missing"
fi

EXPECTED_COMMANDS="lazy-init-deep lazy-ulw-plan lazy-start-work lazy-ulw-loop lazy-verifier lazy-reviewer lazy-librarian lazy-migration-planner"
for cmd in $EXPECTED_COMMANDS; do
    if [ -f "${PLUGIN_ROOT}/commands/${cmd}.md" ]; then
        check "Command: ${cmd}.md" ok
    else
        check "Command: ${cmd}.md" "missing"
    fi
done

EXPECTED_SKILLS="lazy-init-deep lazy-ulw-plan lazy-start-work lazy-ulw-loop lazy-verifier lazy-reviewer lazy-librarian lazy-migration-planner"
for skill in $EXPECTED_SKILLS; do
    if [ -f "${PLUGIN_ROOT}/skills/${skill}/SKILL.md" ]; then
        check "Skill: ${skill}/SKILL.md" ok
    else
        check "Skill: ${skill}/SKILL.md" "missing"
    fi
done

for dir in agents mcp scripts schemas tests docs; do
    file_count=$(find "${PLUGIN_ROOT}/${dir}" -maxdepth 1 -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
    if [ "$file_count" -gt 0 ]; then
        check "Directory content: ${dir}/" ok
    elif [ -f "${PLUGIN_ROOT}/${dir}/.gitkeep" ]; then
        check "Gitkeep: ${dir}/.gitkeep" ok
    else
        check "Directory: ${dir}/" "empty and missing .gitkeep"
    fi
done

for script in lazybuddy-smoke-test.sh lazybuddy-docs-check.sh; do
    if [ -f "${PLUGIN_ROOT}/scripts/${script}" ]; then
        if [ -x "${PLUGIN_ROOT}/scripts/${script}" ]; then
            check "Script executable: ${script}" ok
        else
            check "Script executable: ${script}" "not executable"
        fi
    else
        check "Script: ${script}" "missing"
    fi
done

if state_result=$("$PYTHON_BIN" - "${PROJECT_ROOT}" <<'PY' 2>&1
import json
import os
import re
import sys

repo = os.path.realpath(sys.argv[1])
runs_dir = os.path.join(repo, ".lazybuddy", "runs")
active_or_complete = {"active", "created", "executing", "blocked", "complete", "completed"}
completed_task_statuses = {"complete", "completed", "done"}
errors = []
notes = []
warnings = []
checked_runs = 0

def under_repo(path):
    try:
        return os.path.commonpath([repo, path]) == repo
    except ValueError:
        return False

def resolve(path, base, label):
    if os.path.isabs(path):
        candidate = os.path.realpath(path)
        return (candidate, None) if under_repo(candidate) else (None, f"{label} escapes project root: {path}")
    first = os.path.realpath(os.path.join(repo, path))
    if os.path.exists(first):
        return (first, None) if under_repo(first) else (None, f"{label} escapes project root: {path}")
    fallback = os.path.realpath(os.path.join(base, path))
    return (fallback, None) if under_repo(fallback) else (None, f"{label} escapes project root: {path}")

def parse_plan_boxes(plan_path):
    headings = {"todos", "final verification wave"}
    in_section = False
    boxes = []
    with open(plan_path) as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith("## "):
                in_section = stripped[3:].strip().lower() in headings
                continue
            if not in_section:
                continue
            match = re.match(r"^-\s+\[([ xX])\]\s+(.+)$", stripped)
            if not match:
                continue
            title = match.group(2).strip()
            id_match = re.match(r"^([A-Za-z]*\d+)\s*:\s*(.+)$", title)
            boxes.append({
                "id": id_match.group(1) if id_match else None,
                "title": title,
                "checked": match.group(1).lower() == "x",
            })
    return boxes

def is_path_like(value):
    return (
        "/" in value
        or value.startswith((".", "~"))
        or re.search(r"\.(json|jsonl|log|md|txt|html|pdf|png|jpg|jpeg|gif|svg)$", value)
    )

def evidence_refs(value):
    if isinstance(value, str):
        ref = value.strip()
        if not ref:
            return [], ["empty evidence string"]
        return [ref], []
    elif isinstance(value, list):
        if not value:
            return [], ["empty evidence list"]
        refs = []
        problems = []
        for item in value:
            item_refs, item_problems = evidence_refs(item)
            refs.extend(item_refs)
            problems.extend(item_problems)
        return refs, problems
    elif isinstance(value, dict):
        refs = []
        for key in ("path", "file", "evidence_path", "transcript", "transcript_path"):
            val = value.get(key)
            if isinstance(val, str) and val.strip():
                refs.append(val.strip())
        if refs:
            return refs, []
        return [], ["evidence object missing path"]
    return [], [f"malformed evidence value: {type(value).__name__}"]

if not os.path.isdir(runs_dir):
    print("ok: no .lazybuddy/runs directory found")
    sys.exit(0)

run_dirs = [
    os.path.join(runs_dir, name)
    for name in sorted(os.listdir(runs_dir))
    if os.path.isdir(os.path.join(runs_dir, name))
]
if not run_dirs:
    print("ok: no run directories found")
    sys.exit(0)

for run_dir in run_dirs:
    run_id = os.path.basename(run_dir)
    state_path = os.path.join(run_dir, "state.json")
    if not os.path.exists(state_path):
        continue
    checked_runs += 1
    try:
        with open(state_path) as f:
            state = json.load(f)
    except Exception as exc:
        errors.append(f"{run_id}: state.json parse error: {exc}")
        continue

    status = state.get("status", "")
    plan_ref = state.get("plan_reference", "")
    if plan_ref:
        plan_path, plan_error = resolve(plan_ref, run_dir, "plan_reference")
        if plan_error:
            errors.append(f"{run_id}: {plan_error}")
            plan_path = None
        if plan_path is None:
            pass
        elif not os.path.exists(plan_path):
            errors.append(f"{run_id}: plan_reference missing: {plan_ref}")
        else:
            try:
                boxes = parse_plan_boxes(plan_path)
            except Exception as exc:
                errors.append(f"{run_id}: plan parse error: {exc}")
                boxes = []
            progress = state.get("progress", {})
            completed = sum(1 for box in boxes if box["checked"])
            if progress.get("total_checkboxes") != len(boxes) or progress.get("completed_checkboxes") != completed:
                errors.append(
                    f"{run_id}: progress drift state={progress.get('completed_checkboxes', 0)}/"
                    f"{progress.get('total_checkboxes', 0)} plan={completed}/{len(boxes)}"
                )
            tasks_by_id = {
                task.get("id"): task
                for task in state.get("tasks", [])
                if isinstance(task, dict) and task.get("id")
            }
            for box in boxes:
                if not box["id"] or box["id"] not in tasks_by_id:
                    continue
                task_status = tasks_by_id[box["id"]].get("status")
                task_done = task_status == "done"
                if box["checked"] != task_done:
                    errors.append(
                        f"{run_id}: status drift {box['id']} plan="
                        f"{'checked' if box['checked'] else 'unchecked'} state={task_status}"
                    )
    elif status in active_or_complete and status != "created":
        errors.append(f"{run_id}: {status} run has no plan_reference")

    for task in state.get("tasks", []):
        if (
            not isinstance(task, dict)
            or task.get("status") not in completed_task_statuses
        ):
            continue
        refs, evidence_problems = evidence_refs(task.get("evidence", []))
        for problem in evidence_problems:
            errors.append(f"{run_id}: completed task {task.get('id', '?')} missing evidence: {problem}")
        for ref in refs:
            if not is_path_like(ref):
                continue
            evidence_path, evidence_error = resolve(ref, run_dir, "evidence")
            if evidence_error:
                errors.append(f"{run_id}: completed task {task.get('id', '?')} {evidence_error}")
                continue
            if not os.path.exists(evidence_path):
                errors.append(f"{run_id}: completed task {task.get('id', '?')} missing evidence: {ref}")

    if status in active_or_complete:
        events_path = os.path.join(run_dir, "events.jsonl")
        if os.path.exists(events_path):
            with open(events_path) as f:
                for line_number, line in enumerate(f, 1):
                    stripped = line.strip()
                    if not stripped:
                        continue
                    legacy_header = re.fullmatch(r"RUN_ID:\s*([A-Za-z0-9._-]+)", stripped)
                    if line_number == 1 and legacy_header and legacy_header.group(1) == run_id:
                        warnings.append(
                            f"{run_id}: events.jsonl line 1 legacy RUN_ID header preserved unchanged; "
                            "not a JSON event; excluded from package-health failure"
                        )
                        continue
                    try:
                        event = json.loads(stripped)
                    except Exception as exc:
                        errors.append(f"{run_id}: events.jsonl line {line_number} parse error: {exc}")
                        continue
                    if event.get("boundary_warning") or event.get("event") == "boundary_warning":
                        errors.append(f"{run_id}: boundary_warning in events.jsonl line {line_number}")
        else:
            notes.append(f"{run_id}: no events.jsonl")

for warning in warnings:
    print(f"WARN: {warning}")
if errors:
    print("; ".join(errors))
    sys.exit(1)
if checked_runs == 0:
    print("ok: no state.json files found")
else:
    print("ok: checked %d run(s)" % checked_runs)
PY
); then
    printf '%s\n' "$state_result" | sed -n 's/^WARN: /  [WARN] /p'
    check "Run state drift/evidence/boundaries" ok
else
    printf '%s\n' "$state_result" | sed -n 's/^WARN: /  [WARN] /p'
    state_error="$(printf '%s\n' "$state_result" | sed '/^WARN: /d')"
    check "Run state drift/evidence/boundaries" "$state_error"
fi

echo ""
echo "=== Results ==="
echo "Passed: ${PASS}"
echo "Failed: ${FAIL}"
if [ -n "$ERRORS" ]; then
    echo "Errors:$ERRORS"
fi

if [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "Doctor check: ALL PASS"
    exit 0
else
    echo ""
    echo "Doctor check: ${FAIL} FAILURE(S)"
    exit 1
fi
