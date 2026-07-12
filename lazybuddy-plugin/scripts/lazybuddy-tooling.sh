#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TOOLING_SOURCE="$PLUGIN_ROOT/tooling"
PACKAGE_SOURCE="$TOOLING_SOURCE/package.json"
LOCK_SOURCE="$TOOLING_SOURCE/package-lock.json"
REGISTRY_SOURCE="$TOOLING_SOURCE/capabilities.json"
RECEIPT_NAME=".lazybuddy-tooling-receipt.json"

usage() {
    cat <<'EOF'
Usage:
  lazybuddy-tooling.sh <detect|install|status|doctor|uninstall> --tooling-root ABSOLUTE_EMPTY_DIRECTORY
  lazybuddy-tooling.sh verify --target ABSOLUTE_TARGET_DIRECTORY <--dry-run|--run> [lint|typecheck|test|build ...]

install requires an existing, empty, non-symlink directory supplied by the caller.
status and doctor inspect only. uninstall deletes only a verified, receipt-owned root.
EOF
}

fail() {
    echo "ERROR: $1" >&2
    exit 2
}

parse_root() {
    if [ "$#" -ne 2 ] || [ "$1" != "--tooling-root" ]; then
        usage >&2
        exit 2
    fi
    TOOLING_ROOT="$2"
    if [[ "$TOOLING_ROOT" != /* ]]; then
        fail "--tooling-root must be an absolute path"
    fi
}

root_is_safe_existing() {
    [[ "/$TOOLING_ROOT/" != *"/../"* ]] \
        && [ -d "$TOOLING_ROOT" ] \
        && [ ! -L "$TOOLING_ROOT" ] \
        && [ "$(cd "$TOOLING_ROOT" && pwd -P)" = "$TOOLING_ROOT" ]
}

require_safe_existing_root() {
    if [[ "/$TOOLING_ROOT/" == *"/../"* ]]; then
        fail "tooling root must not contain traversal"
    fi
    if [ ! -e "$TOOLING_ROOT" ] || [ ! -d "$TOOLING_ROOT" ]; then
        fail "tooling root must be an existing directory"
    fi
    if [ -L "$TOOLING_ROOT" ]; then
        fail "tooling root must not be a symlink"
    fi
    if [ "$(cd "$TOOLING_ROOT" && pwd -P)" != "$TOOLING_ROOT" ]; then
        fail "tooling root must not resolve through a symlink"
    fi
}

root_is_empty() {
    [ -z "$(find "$TOOLING_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]
}

link_count() {
    stat -f '%l' "$1" 2>/dev/null || stat -c '%h' "$1"
}

regular_unlinked_file() {
    [ -f "$1" ] && [ ! -L "$1" ] && [ "$(link_count "$1")" = "1" ]
}

receipt_contents() {
    python3 - "$TOOLING_ROOT" "$(node_modules_digest)" <<'PY'
import json
import sys

print(json.dumps({
    "schema_version": 1,
    "owner": "lazybuddy-tooling",
    "root": sys.argv[1],
        "owned_entries": [
            "package.json",
            "package-lock.json",
            "capabilities.json",
            "node_modules",
            ".lazybuddy-tooling-receipt.json",
        ],
        "node_modules_digest": sys.argv[2],
    }, indent=2, sort_keys=True))
PY
}

node_modules_digest() {
    python3 - "$TOOLING_ROOT/node_modules" <<'PY'
import hashlib
import os
import stat
import sys

root = os.path.realpath(sys.argv[1])
if not os.path.isdir(root) or os.path.islink(sys.argv[1]):
    raise SystemExit(2)
entries = []
for directory, directory_names, file_names in os.walk(root, followlinks=False):
    directory_names.sort()
    file_names.sort()
    relative_directory = os.path.relpath(directory, root)
    entries.append(f"d {relative_directory}")
    for name in directory_names + file_names:
        path = os.path.join(directory, name)
        relative = os.path.relpath(path, root)
        status = os.lstat(path)
        if stat.S_ISLNK(status.st_mode):
            resolved = os.path.realpath(path)
            if os.path.commonpath((root, resolved)) != root:
                raise SystemExit(2)
            entries.append(f"l {relative} {os.readlink(path)}")
            continue
        if stat.S_ISDIR(status.st_mode):
            continue
        if not stat.S_ISREG(status.st_mode) or status.st_nlink != 1:
            raise SystemExit(2)
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for chunk in iter(lambda: source.read(65536), b""):
                digest.update(chunk)
        entries.append(f"f {relative} {digest.hexdigest()}")
print(hashlib.sha256("\n".join(entries).encode()).hexdigest())
PY
}

root_contains_only_owned_entries() {
    [ "$(find "$TOOLING_ROOT" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = "5" ] \
        && [ -e "$TOOLING_ROOT/package.json" ] \
        && [ -e "$TOOLING_ROOT/package-lock.json" ] \
        && [ -e "$TOOLING_ROOT/capabilities.json" ] \
        && [ -d "$TOOLING_ROOT/node_modules" ] \
        && [ ! -L "$TOOLING_ROOT/node_modules" ] \
        && [ -e "$TOOLING_ROOT/$RECEIPT_NAME" ]
}

owned_root_is_valid() {
    root_is_safe_existing || return 1
    root_contains_only_owned_entries || return 1
    regular_unlinked_file "$TOOLING_ROOT/package.json" || return 1
    regular_unlinked_file "$TOOLING_ROOT/package-lock.json" || return 1
    regular_unlinked_file "$TOOLING_ROOT/capabilities.json" || return 1
    regular_unlinked_file "$TOOLING_ROOT/$RECEIPT_NAME" || return 1
    cmp -s "$PACKAGE_SOURCE" "$TOOLING_ROOT/package.json" || return 1
    cmp -s "$LOCK_SOURCE" "$TOOLING_ROOT/package-lock.json" || return 1
    cmp -s "$REGISTRY_SOURCE" "$TOOLING_ROOT/capabilities.json" || return 1
    node_modules_digest >/dev/null 2>&1 || return 1
    cmp -s <(receipt_contents) "$TOOLING_ROOT/$RECEIPT_NAME"
}

print_status() {
    if [ ! -e "$TOOLING_ROOT" ]; then
        echo "STATE: unavailable"
        echo "REASON: tooling root does not exist"
        return 0
    fi
    if owned_root_is_valid >/dev/null 2>&1; then
        echo "STATE: ready"
        echo "OWNER: lazybuddy-tooling"
        echo "ROOT: $TOOLING_ROOT"
    else
        echo "STATE: unavailable"
        echo "REASON: tooling root is not a verified LazyBuddy receipt-owned installation"
    fi
}

compatible_host_provider() {
    local command_name="$1"
    local candidate
    candidate="$(command -v "$command_name" 2>/dev/null || true)"
    [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1
}

owned_provider() {
    local binary="$1"
    owned_root_is_valid >/dev/null 2>&1 \
        && regular_unlinked_file "$binary" \
        && [ -x "$binary" ] \
        && "$binary" --version >/dev/null 2>&1
}

owned_rg_path() {
    local package_suffix
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64) package_suffix="darwin-arm64" ;;
        Darwin-x86_64) package_suffix="darwin-x64" ;;
        Linux-aarch64|Linux-arm64) package_suffix="linux-arm64" ;;
        Linux-x86_64) package_suffix="linux-x64" ;;
        *) return 1 ;;
    esac
    printf '%s\n' "$TOOLING_ROOT/node_modules/@vscode/ripgrep-$package_suffix/bin/rg"
}

print_provider() {
    local capability="$1"
    local command_name="$2"
    local owned_binary="$3"
    local candidate
    echo "CAPABILITY: $capability"
    if compatible_host_provider "$command_name"; then
        candidate="$(command -v "$command_name")"
        echo "PROVIDER: $command_name host $candidate"
    elif owned_provider "$owned_binary"; then
        echo "PROVIDER: $command_name owned $owned_binary"
    else
        echo "PROVIDER: $command_name unavailable"
    fi
}

detect_tooling() {
    local rg_binary=""
    rg_binary="$(owned_rg_path 2>/dev/null || true)"
    print_status
    echo "REGISTRY: $REGISTRY_SOURCE"
    print_provider "local_search" "rg" "$rg_binary"
    print_provider "structural_search" "sg" "$TOOLING_ROOT/node_modules/@ast-grep/cli/sg"
}

install_tooling() {
    require_safe_existing_root
    if ! root_is_empty; then
        fail "tooling root must be empty"
    fi
    if compatible_host_provider "rg" && compatible_host_provider "sg"; then
        echo "STATE: ready"
        echo "OWNER: host"
        echo "REASON: compatible host providers already satisfy local search"
        return 0
    fi
    if ! command -v npm >/dev/null 2>&1; then
        fail "npm is required to install the locked tooling manifest"
    fi
    cp "$PACKAGE_SOURCE" "$TOOLING_ROOT/package.json"
    cp "$LOCK_SOURCE" "$TOOLING_ROOT/package-lock.json"
    cp "$REGISTRY_SOURCE" "$TOOLING_ROOT/capabilities.json"
    (
        cd "$TOOLING_ROOT"
        npm ci --ignore-scripts --no-audit --fund=false
    )
    receipt_contents > "$TOOLING_ROOT/$RECEIPT_NAME"
    if ! owned_root_is_valid; then
        fail "installation did not produce a verified receipt-owned root"
    fi
    echo "STATE: ready"
    echo "ROOT: $TOOLING_ROOT"
}

doctor_tooling() {
    local status_output
    status_output="$(print_status)"
    printf '%s\n' "$status_output"
    if grep -qx 'STATE: ready' <<<"$status_output"; then
        echo "DOCTOR: PASS"
        return 0
    fi
    echo "DOCTOR: FAIL"
    return 1
}

uninstall_tooling() {
    if ! owned_root_is_valid; then
        fail "refusing uninstall: root is not an unmodified receipt-owned installation"
    fi
    rm -rf "$TOOLING_ROOT"
    echo "STATE: removed"
    echo "ROOT: $TOOLING_ROOT"
}

parse_verify() {
    TARGET_ROOT=""
    VERIFY_MODE=""
    VERIFY_SELECTION=()
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --target)
                [ "$#" -ge 2 ] || fail "--target requires an absolute path"
                TARGET_ROOT="$2"
                shift 2
                ;;
            --dry-run|--run)
                [ -z "$VERIFY_MODE" ] || fail "choose exactly one verification mode"
                VERIFY_MODE="$1"
                shift
                ;;
            lint|typecheck|test|build)
                VERIFY_SELECTION+=("$1")
                shift
                ;;
            *) fail "unsupported verification selection: $1" ;;
        esac
    done
    [ -n "$TARGET_ROOT" ] || fail "--target is required"
    [ -n "$VERIFY_MODE" ] || fail "choose --dry-run or --run"
    [[ "$TARGET_ROOT" == /* ]] || fail "--target must be an absolute path"
    [[ "/$TARGET_ROOT/" != *"/../"* ]] || fail "target must not contain traversal"
    [ -d "$TARGET_ROOT" ] && [ ! -L "$TARGET_ROOT" ] || fail "target must be an existing non-symlink directory"
    [ "$(cd "$TARGET_ROOT" && pwd -P)" = "$TARGET_ROOT" ] || fail "target must not resolve through a symlink"
    if [ "$VERIFY_MODE" = "--run" ] && [ "${#VERIFY_SELECTION[@]}" -eq 0 ]; then
        fail "--run requires at least one explicit declared selection"
    fi
    VERIFY_TIMEOUT_SECONDS="${LAZYBUDDY_VERIFY_TIMEOUT_SECONDS:-60}"
    [[ "$VERIFY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "LAZYBUDDY_VERIFY_TIMEOUT_SECONDS must be a positive integer"
    export LAZYBUDDY_VERIFY_TIMEOUT_SECONDS="$VERIFY_TIMEOUT_SECONDS"
}

detect_verification_kind() {
    if [ -f "$TARGET_ROOT/package.json" ]; then
        if [ -f "$TARGET_ROOT/package-lock.json" ]; then
            VERIFY_KIND="npm"
        elif [ -f "$TARGET_ROOT/pnpm-lock.yaml" ]; then
            VERIFY_KIND="pnpm"
        elif [ -f "$TARGET_ROOT/yarn.lock" ]; then
            VERIFY_KIND="yarn"
        elif [ -f "$TARGET_ROOT/bun.lock" ] || [ -f "$TARGET_ROOT/bun.lockb" ]; then
            VERIFY_KIND="bun"
        else
            VERIFY_KIND=""
        fi
    elif [ -f "$TARGET_ROOT/pyproject.toml" ]; then
        VERIFY_KIND="python"
    elif [ -f "$TARGET_ROOT/Makefile" ] || [ -f "$TARGET_ROOT/makefile" ]; then
        VERIFY_KIND="make"
    else
        VERIFY_KIND=""
    fi
}

declared_tasks() {
    case "$VERIFY_KIND" in
        npm|pnpm|yarn|bun)
            python3 - "$TARGET_ROOT/package.json" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        manifest = json.load(source)
except (OSError, json.JSONDecodeError):
    raise SystemExit(0)
scripts = manifest.get("scripts", {})
for name in ("lint", "typecheck", "test", "build"):
    if isinstance(scripts.get(name), str) and scripts[name].strip():
        print(name)
PY
            ;;
        make)
            grep -E '^(lint|typecheck|test|build):' "$TARGET_ROOT"/[Mm]akefile 2>/dev/null | sed -E 's/:.*//' | sort -u
            ;;
        python)
            python3 - "$TARGET_ROOT/pyproject.toml" <<'PY'
import json
import sys

verification = {}
active = False
with open(sys.argv[1], encoding="utf-8") as source:
    for line in source:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            active = stripped == "[tool.lazyseries.verification]"
            continue
        if active and "=" in stripped:
            name, raw_command = (part.strip() for part in stripped.split("=", 1))
            if name in {"lint", "typecheck", "test", "build"}:
                try:
                    verification[name] = json.loads(raw_command)
                except json.JSONDecodeError:
                    continue
for name in ("lint", "typecheck", "test", "build"):
    command = verification.get(name)
    if isinstance(command, list) and command and all(isinstance(part, str) and part for part in command):
        print(name)
PY
            ;;
    esac
}

has_declared_task() {
    declared_tasks | grep -Fxq "$1"
}

print_command() {
    local task_name="$1"
    case "$VERIFY_KIND" in
        npm) echo "COMMAND: npm run $task_name" ;;
        pnpm) echo "COMMAND: pnpm run $task_name" ;;
        yarn) echo "COMMAND: yarn run $task_name" ;;
        bun) echo "COMMAND: bun run $task_name" ;;
        make) echo "COMMAND: make $task_name" ;;
        python)
            python3 - "$TARGET_ROOT/pyproject.toml" "$task_name" <<'PY'
import json
import shlex
import sys

verification = {}
active = False
with open(sys.argv[1], encoding="utf-8") as source:
    for line in source:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            active = stripped == "[tool.lazyseries.verification]"
            continue
        if active and "=" in stripped:
            name, raw_command = (part.strip() for part in stripped.split("=", 1))
            if name in {"lint", "typecheck", "test", "build"}:
                try:
                    verification[name] = json.loads(raw_command)
                except json.JSONDecodeError:
                    continue
command = verification[sys.argv[2]]
print("COMMAND: " + shlex.join(command))
PY
            ;;
    esac
}

run_with_timeout() {
    python3 - "$TARGET_ROOT" "$VERIFY_TIMEOUT_SECONDS" "$@" <<'PY'
import json
import os
import signal
import subprocess
import sys

target, timeout_text, *command = sys.argv[1:]
process = subprocess.Popen(command, cwd=target, start_new_session=True)
try:
    raise SystemExit(process.wait(timeout=int(timeout_text)))
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    print(f"ERROR: verification command exceeded {timeout_text}s", file=sys.stderr)
    raise SystemExit(124)
PY
}

run_command() {
    local task_name="$1"
    case "$VERIFY_KIND" in
        npm) run_with_timeout npm run "$task_name" ;;
        pnpm) run_with_timeout pnpm run "$task_name" ;;
        yarn) run_with_timeout yarn run "$task_name" ;;
        bun) run_with_timeout bun run "$task_name" ;;
        make) run_with_timeout make "$task_name" ;;
        python)
            python3 - "$TARGET_ROOT/pyproject.toml" "$task_name" <<'PY'
import json
import os
import signal
import subprocess
import sys
verification = {}
active = False
with open(sys.argv[1], encoding="utf-8") as source:
    for line in source:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            active = stripped == "[tool.lazyseries.verification]"
            continue
        if active and "=" in stripped:
            name, raw_command = (part.strip() for part in stripped.split("=", 1))
            if name in {"lint", "typecheck", "test", "build"}:
                try:
                    verification[name] = json.loads(raw_command)
                except json.JSONDecodeError:
                    continue
command = verification[sys.argv[2]]
timeout = int(os.environ["LAZYBUDDY_VERIFY_TIMEOUT_SECONDS"])
process = subprocess.Popen(command, cwd=sys.argv[1].rsplit("/", 1)[0], start_new_session=True)
try:
    raise SystemExit(process.wait(timeout=timeout))
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    print(f"ERROR: verification command exceeded {timeout}s", file=sys.stderr)
    raise SystemExit(124)
PY
            ;;
    esac
}

verify_target() {
    detect_verification_kind
    if [ -z "$VERIFY_KIND" ]; then
        echo "STATE: unsupported"
        echo "REASON: no supported declared verification manifest and lockfile"
        return 0
    fi
    case "$VERIFY_KIND" in
        npm|pnpm|yarn|bun|make)
            command -v "$VERIFY_KIND" >/dev/null 2>&1 || {
                echo "STATE: unavailable"
                echo "REASON: required project toolchain is unavailable: $VERIFY_KIND"
                return 0
            }
            ;;
        python) command -v python3 >/dev/null 2>&1 || fail "python3 is required to inspect declared pyproject verification" ;;
    esac
    local tasks=()
    while IFS= read -r task_name; do
        [ -n "$task_name" ] && tasks+=("$task_name")
    done < <(declared_tasks)
    if [ "${#tasks[@]}" -eq 0 ]; then
        echo "STATE: unsupported"
        echo "REASON: no declared allowlisted verification commands"
        return 0
    fi
    local selected=()
    if [ "${#VERIFY_SELECTION[@]}" -eq 0 ]; then
        selected=("${tasks[@]}")
    else
        selected=("${VERIFY_SELECTION[@]}")
    fi
    for task_name in "${selected[@]}"; do
        has_declared_task "$task_name" || fail "verification command is not declared and allowlisted: $task_name"
    done
    echo "STATE: ready"
    echo "MANAGER: $VERIFY_KIND"
    echo "MODE: ${VERIFY_MODE#--}"
    for task_name in "${selected[@]}"; do
        print_command "$task_name"
    done
    if [ "$VERIFY_MODE" = "--run" ]; then
        for task_name in "${selected[@]}"; do
            run_command "$task_name"
        done
    fi
}

if [ "$#" -lt 1 ]; then
    usage >&2
    exit 2
fi

COMMAND="$1"
shift

case "$COMMAND" in
    verify) parse_verify "$@"; verify_target ;;
    detect|install|status|doctor|uninstall)
        parse_root "$@"
        case "$COMMAND" in
            detect) detect_tooling ;;
            install) install_tooling ;;
            status) print_status ;;
            doctor) doctor_tooling ;;
            uninstall) uninstall_tooling ;;
        esac
        ;;
    *) usage >&2; exit 2 ;;
esac
