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
  lazybuddy-tooling.sh <remote-status|remote-doctor|remote-export-mcp> --tooling-root ABSOLUTE_DIRECTORY
  lazybuddy-tooling.sh <remote-enable|remote-disable> --tooling-root ABSOLUTE_DIRECTORY <context7|grep_app>
  lazybuddy-tooling.sh verify --target ABSOLUTE_TARGET_DIRECTORY <--dry-run|--run> [lint|typecheck|test|build ...]
  lazybuddy-tooling.sh <lsp-status|lsp-install|lsp-doctor|lsp-uninstall> --target ABSOLUTE_TARGET_DIRECTORY --tooling-root ABSOLUTE_DIRECTORY
  lazybuddy-tooling.sh <codegraph-status|codegraph-install|codegraph-init|codegraph-enable|codegraph-doctor|codegraph-uninstall|codegraph-export-mcp> --target ABSOLUTE_TARGET_DIRECTORY --tooling-root ABSOLUTE_DIRECTORY
  lazybuddy-tooling.sh setup --non-interactive --json
  lazybuddy-tooling.sh providers [--workspace ABSOLUTE_DIRECTORY] [--policy automatic|ask-once|always-ask] --json
  lazybuddy-tooling.sh providers configure --provider ID --credential-ref REFERENCE --consent yes --non-interactive --json
  lazybuddy-tooling.sh providers test [--workspace ABSOLUTE_DIRECTORY] [--policy automatic|ask-once|always-ask] --json
  lazybuddy-tooling.sh approval <grant|deny|revoke|check> --workspace ABSOLUTE_DIRECTORY --capability ID --provider ID [--scope once|workspace] --json
  lazybuddy-tooling.sh toolpack resolve [--toolpack-root ABSOLUTE_DIRECTORY] --json
  lazybuddy-tooling.sh capability run CAPABILITY --query QUERY [--workspace ABSOLUTE_DIRECTORY] [--toolpack-root ABSOLUTE_DIRECTORY]
  lazybuddy-tooling.sh detector detect --workspace ABSOLUTE_DIRECTORY --context-json JSON
  lazybuddy-tooling.sh detector fallback CAPABILITY --outcomes-json JSON [--result UNTRUSTED_RESULT]

install requires an existing, empty, non-symlink directory supplied by the caller.
status and doctor inspect only. uninstall deletes only a verified, receipt-owned root.
CodeGraph remains disabled until its caller explicitly installs, initializes, and enables it.
Context7 and experimental grep_app remain disabled until explicitly enabled.
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
    python3 -B - "$TOOLING_ROOT" "$(node_modules_digest)" <<'PY'
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
            ".lazybuddy-remote-capabilities.json",
            "node_modules",
            ".lazybuddy-tooling-receipt.json",
            ".lazybuddy-codegraph-receipt.json",
            ".lazybuddy-npm-runtime",
        ],
        "node_modules_digest": sys.argv[2],
    }, indent=2, sort_keys=True))
PY
}

remote_state_path() {
    printf '%s\n' "$TOOLING_ROOT/.lazybuddy-remote-capabilities.json"
}

remote_state_contents() {
    local context7_enabled="$1" grep_app_enabled="$2"
    python3 -B - "$context7_enabled" "$grep_app_enabled" <<'PY'
import json
import sys

values = sys.argv[1:]
if any(value not in {"true", "false"} for value in values):
    raise SystemExit(2)
print(json.dumps({
    "schema_version": 1,
    "owner": "lazybuddy-remote-capabilities",
    "capabilities": {
        "context7": {"enabled": values[0] == "true"},
        "grep_app": {"enabled": values[1] == "true"},
    },
}, indent=2, sort_keys=True))
PY
}

write_remote_state() {
    local context7_enabled="$1" grep_app_enabled="$2" state temporary
    state="$(remote_state_path)"
    temporary="${state}.tmp.$$"
    remote_state_contents "$context7_enabled" "$grep_app_enabled" > "$temporary"
    mv "$temporary" "$state"
}

remote_state_flag() {
    local capability="$1"
    python3 -B - "$(remote_state_path)" "$capability" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    state = json.load(source)
value = state["capabilities"][sys.argv[2]]["enabled"]
if not isinstance(value, bool):
    raise SystemExit(1)
print("true" if value else "false")
PY
}

remote_state_is_valid() {
    local state context7_enabled grep_app_enabled
    state="$(remote_state_path)"
    regular_unlinked_file "$state" || return 1
    context7_enabled="$(remote_state_flag context7)" || return 1
    grep_app_enabled="$(remote_state_flag grep_app)" || return 1
    cmp -s <(remote_state_contents "$context7_enabled" "$grep_app_enabled") "$state"
}

node_modules_digest() {
    python3 -B - "$TOOLING_ROOT/node_modules" <<'PY'
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
    [ -e "$TOOLING_ROOT/package.json" ] \
        && [ -e "$TOOLING_ROOT/package-lock.json" ] \
        && [ -e "$TOOLING_ROOT/capabilities.json" ] \
        && [ -e "$TOOLING_ROOT/.lazybuddy-remote-capabilities.json" ] \
        && [ -d "$TOOLING_ROOT/node_modules" ] \
        && [ ! -L "$TOOLING_ROOT/node_modules" ] \
        && [ -e "$TOOLING_ROOT/$RECEIPT_NAME" ] \
        && { [ ! -e "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json" ] || regular_unlinked_file "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json"; } \
        && { [ ! -e "$TOOLING_ROOT/.lazybuddy-npm-runtime" ] || { [ -d "$TOOLING_ROOT/.lazybuddy-npm-runtime" ] && [ ! -L "$TOOLING_ROOT/.lazybuddy-npm-runtime" ]; }; } \
        && { [ ! -e "$TOOLING_ROOT/.lazybuddy-codegraph-runtime" ] || { [ -d "$TOOLING_ROOT/.lazybuddy-codegraph-runtime" ] && [ ! -L "$TOOLING_ROOT/.lazybuddy-codegraph-runtime" ]; }; } \
        && find "$TOOLING_ROOT" -mindepth 1 -maxdepth 1 -print | sed 's#.*/##' | sort | cmp -s - <(
            {
                printf '%s\n' .lazybuddy-remote-capabilities.json capabilities.json node_modules package-lock.json package.json "$RECEIPT_NAME"
                [ ! -e "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json" ] || printf '%s\n' .lazybuddy-codegraph-receipt.json
                [ ! -e "$TOOLING_ROOT/.lazybuddy-npm-runtime" ] || printf '%s\n' .lazybuddy-npm-runtime
                [ ! -e "$TOOLING_ROOT/.lazybuddy-codegraph-runtime" ] || printf '%s\n' .lazybuddy-codegraph-runtime
            } | sort
        )
}

owned_root_is_valid() {
    root_is_safe_existing || return 1
    root_contains_only_owned_entries || return 1
    regular_unlinked_file "$TOOLING_ROOT/package.json" || return 1
    regular_unlinked_file "$TOOLING_ROOT/package-lock.json" || return 1
    regular_unlinked_file "$TOOLING_ROOT/capabilities.json" || return 1
    remote_state_is_valid || return 1
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
    local runtime_root
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
    write_remote_state false false
    prepare_npm_runtime
    runtime_root="$(npm_runtime_root)"
    export HOME="$runtime_root/home"
    export XDG_CACHE_HOME="$runtime_root/cache"
    export PYTHONPYCACHEPREFIX="$runtime_root/cache/python"
    export npm_config_cache="$runtime_root/cache"
    export npm_config_userconfig="$runtime_root/config/npmrc"
    export npm_config_update_notifier=false
    export NO_UPDATE_NOTIFIER=1
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
    if [ -e "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json" ]; then
        fail "refusing tooling uninstall: run codegraph-uninstall for the receipt-owned project index first"
    fi
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

parse_lsp() {
    TARGET_ROOT=""
    TOOLING_ROOT=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --target)
                [ "$#" -ge 2 ] || fail "--target requires an absolute path"
                TARGET_ROOT="$2"
                shift 2
                ;;
            --tooling-root)
                [ "$#" -ge 2 ] || fail "--tooling-root requires an absolute path"
                TOOLING_ROOT="$2"
                shift 2
                ;;
            *) fail "unsupported LSP option: $1" ;;
        esac
    done
    [ -n "$TARGET_ROOT" ] || fail "--target is required"
    [ -n "$TOOLING_ROOT" ] || fail "--tooling-root is required"
    [[ "$TARGET_ROOT" == /* ]] || fail "--target must be an absolute path"
    [[ "$TOOLING_ROOT" == /* ]] || fail "--tooling-root must be an absolute path"
    [[ "/$TARGET_ROOT/" != *"/../"* ]] || fail "target must not contain traversal"
    [[ "/$TOOLING_ROOT/" != *"/../"* ]] || fail "tooling root must not contain traversal"
    [ -d "$TARGET_ROOT" ] && [ ! -L "$TARGET_ROOT" ] || fail "target must be an existing non-symlink directory"
    [ "$(cd "$TARGET_ROOT" && pwd -P)" = "$TARGET_ROOT" ] || fail "target must not resolve through a symlink"
}

parse_codegraph() {
    parse_lsp "$@"
}

codegraph_binary() {
    local package_suffix
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64) package_suffix="darwin-arm64" ;;
        Darwin-x86_64) package_suffix="darwin-x64" ;;
        Linux-aarch64|Linux-arm64) package_suffix="linux-arm64" ;;
        Linux-x86_64) package_suffix="linux-x64" ;;
        Windows_NT-x86_64|MINGW64_NT-*) package_suffix="win32-x64" ;;
        *) return 1 ;;
    esac
    printf '%s\n' "$TOOLING_ROOT/node_modules/@colbymchenry/codegraph-$package_suffix/bin/codegraph"
}

codegraph_binary_is_available() {
    local binary
    binary="$(codegraph_binary 2>/dev/null || true)"
    [ -n "$binary" ] && [ -f "$binary" ] && [ ! -L "$binary" ] && [ -x "$binary" ]
}

codegraph_receipt_path() {
    printf '%s\n' "$TOOLING_ROOT/.lazybuddy-codegraph-receipt.json"
}

codegraph_runtime_root() {
    printf '%s\n' "$TOOLING_ROOT/.lazybuddy-codegraph-runtime"
}

npm_runtime_root() {
    printf '%s\n' "$TOOLING_ROOT/.lazybuddy-npm-runtime"
}

prepare_npm_runtime() {
    local runtime_root
    runtime_root="$(npm_runtime_root)"
    if [ -e "$runtime_root" ] && { [ ! -d "$runtime_root" ] || [ -L "$runtime_root" ]; }; then
        fail "npm runtime root must be a real directory inside the owned tooling root"
    fi
    mkdir -p "$runtime_root/home" "$runtime_root/cache" "$runtime_root/config"
}

prepare_codegraph_runtime() {
    local runtime_root
    runtime_root="$(codegraph_runtime_root)"
    if [ -e "$runtime_root" ] && { [ ! -d "$runtime_root" ] || [ -L "$runtime_root" ]; }; then
        fail "CodeGraph runtime root must be a real directory inside the owned tooling root"
    fi
    mkdir -p "$runtime_root/home" "$runtime_root/config" "$runtime_root/cache" "$runtime_root/install"
}

codegraph_receipt_is_valid() {
    local receipt created_index enabled
    receipt="$(codegraph_receipt_path)"
    owned_root_is_valid || return 1
    regular_unlinked_file "$receipt" || return 1
    python3 -B - "$receipt" "$TOOLING_ROOT" "$TARGET_ROOT" <<'PY'
import json
import sys

receipt_path, tooling_root, target_root = sys.argv[1:]
with open(receipt_path, encoding="utf-8") as source:
    receipt = json.load(source)
expected_index = f"{target_root}/.codegraph"
if receipt != {
    "schema_version": 1,
    "owner": "lazybuddy-codegraph",
    "tooling_root": tooling_root,
    "target_root": target_root,
    "index_path": expected_index,
    "created_index": receipt.get("created_index"),
    "enabled": receipt.get("enabled"),
}:
    raise SystemExit(1)
if not isinstance(receipt["created_index"], bool) or not isinstance(receipt["enabled"], bool):
    raise SystemExit(1)
PY
    created_index="$(codegraph_receipt_flag created_index)" || return 1
    enabled="$(codegraph_receipt_flag enabled)" || return 1
    cmp -s <(codegraph_receipt_contents "$created_index" "$enabled") "$receipt"
}

codegraph_receipt_flag() {
    python3 -B - "$(codegraph_receipt_path)" "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    value = json.load(source)[sys.argv[2]]
if not isinstance(value, bool):
    raise SystemExit(1)
print("true" if value else "false")
PY
}

codegraph_receipt_contents() {
    python3 -B - "$TOOLING_ROOT" "$TARGET_ROOT" "$1" "$2" <<'PY'
import json
import sys

created_index, enabled = sys.argv[3:]
if created_index not in {"true", "false"} or enabled not in {"true", "false"}:
    raise SystemExit(2)
print(json.dumps({
    "schema_version": 1,
    "owner": "lazybuddy-codegraph",
    "tooling_root": sys.argv[1],
    "target_root": sys.argv[2],
    "index_path": f"{sys.argv[2]}/.codegraph",
    "created_index": created_index == "true",
    "enabled": enabled == "true",
}, indent=2, sort_keys=True))
PY
}

write_codegraph_receipt() {
    local created_index="$1" enabled="$2" receipt temporary
    receipt="$(codegraph_receipt_path)"
    temporary="${receipt}.tmp.$$"
    codegraph_receipt_contents "$created_index" "$enabled" > "$temporary"
    mv "$temporary" "$receipt"
}

codegraph_index_state() {
    local index_path="$TARGET_ROOT/.codegraph"
    if [ -L "$index_path" ]; then
        printf '%s\n' incompatible
    elif [ -e "$index_path" ] && [ ! -d "$index_path" ]; then
        printf '%s\n' incompatible
    elif [ -d "$index_path" ]; then
        printf '%s\n' initialized
    else
        printf '%s\n' not-initialized
    fi
}

codegraph_status() {
    local index_state enabled
    if ! owned_root_is_valid; then
        echo "STATE: disabled"
        echo "REASON: CodeGraph is optional; run codegraph-install in an explicit empty tooling root"
        return 0
    fi
    if ! codegraph_binary_is_available; then
        echo "STATE: missing"
        echo "REASON: the pinned CodeGraph platform binary is unavailable in the verified owned tooling root"
        return 0
    fi
    index_state="$(codegraph_index_state)"
    if [ "$index_state" = incompatible ]; then
        echo "STATE: incompatible"
        echo "REASON: target .codegraph path must be a real directory, never a symlink or file"
        return 0
    fi
    if [ "$index_state" = not-initialized ]; then
        echo "STATE: not-initialized"
        echo "REASON: run codegraph-init explicitly before enabling CodeGraph"
        return 0
    fi
    enabled=false
    if codegraph_receipt_is_valid && [ "$(codegraph_receipt_flag enabled)" = true ]; then
        enabled=true
    fi
    if [ "$enabled" = true ]; then
        echo "STATE: ready"
        echo "PROVIDER: codegraph owned $(codegraph_binary)"
        echo "INDEX: $TARGET_ROOT/.codegraph"
    else
        echo "STATE: disabled"
        echo "REASON: CodeGraph index exists but requires explicit codegraph-enable"
    fi
}

codegraph_install() {
    (
        local runtime_root
        require_safe_existing_root
        if ! root_is_empty; then
            fail "CodeGraph tooling root must be empty when provisioning the pinned package"
        fi
        command -v npm >/dev/null 2>&1 || fail "npm is required to install the locked CodeGraph package"
        cp "$PACKAGE_SOURCE" "$TOOLING_ROOT/package.json"
        cp "$LOCK_SOURCE" "$TOOLING_ROOT/package-lock.json"
        cp "$REGISTRY_SOURCE" "$TOOLING_ROOT/capabilities.json"
        write_remote_state false false
        prepare_npm_runtime
        runtime_root="$(npm_runtime_root)"
        export HOME="$runtime_root/home"
        export XDG_CACHE_HOME="$runtime_root/cache"
        export PYTHONPYCACHEPREFIX="$runtime_root/cache/python"
        export npm_config_cache="$runtime_root/cache"
        export npm_config_userconfig="$runtime_root/config/npmrc"
        export npm_config_update_notifier=false
        export NO_UPDATE_NOTIFIER=1
        (
            cd "$TOOLING_ROOT"
            npm ci --ignore-scripts --no-audit --fund=false
        )
        receipt_contents > "$TOOLING_ROOT/$RECEIPT_NAME"
        if ! owned_root_is_valid; then
            fail "CodeGraph installation did not produce a verified receipt-owned root"
        fi
        codegraph_status
    )
}

codegraph_init() {
    local binary index_state created_index=false timeout_seconds
    require_safe_existing_root
    if ! owned_root_is_valid; then
        echo "STATE: missing"
        echo "REASON: install the pinned CodeGraph package in this tooling root first"
        return 0
    fi
    if ! codegraph_binary_is_available; then
        echo "STATE: missing"
        echo "REASON: the pinned CodeGraph platform binary is unavailable in the verified owned tooling root"
        return 0
    fi
    index_state="$(codegraph_index_state)"
    if [ "$index_state" = incompatible ]; then
        echo "STATE: incompatible"
        echo "REASON: target .codegraph path must be a real directory, never a symlink or file"
        return 0
    fi
    if [ "$index_state" = not-initialized ]; then
        created_index=true
    fi
    timeout_seconds="${LAZYBUDDY_CODEGRAPH_TIMEOUT_SECONDS:-300}"
    [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || fail "LAZYBUDDY_CODEGRAPH_TIMEOUT_SECONDS must be a positive integer"
    binary="$(codegraph_binary)"
    prepare_codegraph_runtime
    CODEGRAPH_RUNTIME_ROOT="$(codegraph_runtime_root)" \
        HOME="$(codegraph_runtime_root)/home" \
        XDG_CACHE_HOME="$(codegraph_runtime_root)/cache" \
        PYTHONPYCACHEPREFIX="$(codegraph_runtime_root)/cache/python" \
        CODEGRAPH_NO_DOWNLOAD=1 \
        CODEGRAPH_TELEMETRY=0 \
        CODEGRAPH_NO_WATCHDOG=1 \
        python3 -B - "$TARGET_ROOT" "$timeout_seconds" "$binary" <<'PY'
import os
import signal
import subprocess
import sys

target_root, timeout_seconds, binary = sys.argv[1:]
runtime_root = os.environ["CODEGRAPH_RUNTIME_ROOT"]
environment = os.environ | {
    "HOME": f"{runtime_root}/home",
    "XDG_CONFIG_HOME": f"{runtime_root}/config",
    "XDG_CACHE_HOME": f"{runtime_root}/cache",
    "CODEGRAPH_INSTALL_DIR": f"{runtime_root}/install",
    "CODEGRAPH_NO_DOWNLOAD": "1",
    "CODEGRAPH_TELEMETRY": "0",
    "CODEGRAPH_NO_WATCHDOG": "1",
}
process = subprocess.Popen([binary, "init"], cwd=target_root, start_new_session=True, env=environment)
try:
    raise SystemExit(process.wait(timeout=int(timeout_seconds)))
except subprocess.TimeoutExpired:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    print(f"ERROR: CodeGraph initialization exceeded {timeout_seconds}s", file=sys.stderr)
    raise SystemExit(124)
PY
    [ -d "$TARGET_ROOT/.codegraph" ] && [ ! -L "$TARGET_ROOT/.codegraph" ] || fail "CodeGraph initialization did not create a safe project-local index"
    write_codegraph_receipt "$created_index" false
    echo "STATE: initialized"
    echo "INDEX: $TARGET_ROOT/.codegraph"
}

codegraph_enable() {
    local created_index=false index_state
    require_safe_existing_root
    if ! owned_root_is_valid; then
        echo "STATE: missing"
        echo "REASON: install the pinned CodeGraph package in this tooling root first"
        return 0
    fi
    if ! codegraph_binary_is_available; then
        echo "STATE: missing"
        echo "REASON: the pinned CodeGraph platform binary is unavailable in the verified owned tooling root"
        return 0
    fi
    index_state="$(codegraph_index_state)"
    if [ "$index_state" = incompatible ]; then
        echo "STATE: incompatible"
        echo "REASON: target .codegraph path must be a real directory, never a symlink or file"
        return 0
    fi
    if [ "$index_state" = not-initialized ]; then
        echo "STATE: not-initialized"
        echo "REASON: run codegraph-init explicitly before enabling CodeGraph"
        return 0
    fi
    if codegraph_receipt_is_valid; then
        created_index="$(codegraph_receipt_flag created_index)"
    fi
    prepare_codegraph_runtime
    write_codegraph_receipt "$created_index" true
    echo "STATE: ready"
    echo "PROVIDER: codegraph owned $(codegraph_binary)"
    echo "INDEX: $TARGET_ROOT/.codegraph"
}

codegraph_doctor() {
    local source_counts files lines
    codegraph_status
    source_counts="$(python3 -B - "$TARGET_ROOT" <<'PY'
import os
import sys

root = sys.argv[1]
extensions = {".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".mjs", ".py", ".rb", ".rs", ".sh", ".ts", ".tsx"}
excluded = {".codegraph", ".git", "build", "dist", "node_modules"}
files = 0
lines = 0
for directory, directory_names, file_names in os.walk(root, followlinks=False):
    directory_names[:] = sorted(name for name in directory_names if name not in excluded)
    for name in sorted(file_names):
        if os.path.splitext(name)[1] not in extensions:
            continue
        path = os.path.join(directory, name)
        if os.path.islink(path):
            continue
        try:
            with open(path, "rb") as source:
                count = sum(chunk.count(b"\n") for chunk in iter(lambda: source.read(65536), b""))
        except OSError:
            continue
        files += 1
        lines += count
print(f"{files} {lines}")
PY
)"
    read -r files lines <<<"$source_counts"
    echo "SUPPORTED_SOURCE_FILES: $files"
    echo "SUPPORTED_SOURCE_LINES: $lines"
    if [ "$files" -ge 500 ] || [ "$lines" -ge 100000 ]; then
        echo "RECOMMENDATION: CodeGraph may materially improve architecture exploration; install, initialize, and enable it explicitly"
    else
        echo "RECOMMENDATION: CodeGraph remains optional below the architecture-exploration threshold"
    fi
    echo "DOCTOR: DEGRADED"
}

stop_owned_codegraph_processes() {
    python3 -B - "$TOOLING_ROOT" "$TARGET_ROOT" <<'PY'
import os
import signal
import shlex
import subprocess
import sys
import time

tooling_root, target_root = sys.argv[1:]
marker = f"{tooling_root}/node_modules/@colbymchenry/codegraph-"
output = subprocess.check_output(["ps", "-axo", "pid=,ppid=,command="], text=True)
processes = {}
children = {}
for line in output.splitlines():
    parts = line.strip().split(maxsplit=2)
    if len(parts) != 3:
        continue
    try:
        pid, parent_pid = (int(parts[0]), int(parts[1]))
    except ValueError:
        continue
    processes[pid] = (parent_pid, parts[2])
    children.setdefault(parent_pid, set()).add(pid)
roots = set()
for pid, (_, command) in processes.items():
    if marker not in command:
        continue
    try:
        tokens = shlex.split(command)
    except ValueError:
        continue
    if target_root in tokens:
        roots.add(pid)
pids = set(roots)
pending = list(roots)
while pending:
    parent_pid = pending.pop()
    for child_pid in children.get(parent_pid, set()):
        if child_pid not in pids:
            pids.add(child_pid)
            pending.append(child_pid)
for pid in sorted(pids, reverse=True):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
deadline = time.monotonic() + 5
while pids and time.monotonic() < deadline:
    pids = {
        pid for pid in pids
        if subprocess.run(["kill", "-0", str(pid)], capture_output=True).returncode == 0
    }
    if pids:
        time.sleep(0.1)
for pid in sorted(pids, reverse=True):
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
deadline = time.monotonic() + 2
while pids and time.monotonic() < deadline:
    pids = {
        pid for pid in pids
        if subprocess.run(["kill", "-0", str(pid)], capture_output=True).returncode == 0
    }
    if pids:
        time.sleep(0.1)
if pids:
    raise SystemExit(f"refusing uninstall: receipt-owned CodeGraph process did not terminate: {sorted(pids)}")
PY
}

codegraph_uninstall() {
    local created_index runtime_root
    require_safe_existing_root
    codegraph_receipt_is_valid || fail "refusing CodeGraph uninstall: project index is not verified by a matching LazyBuddy receipt"
    stop_owned_codegraph_processes
    created_index="$(codegraph_receipt_flag created_index)"
    if [ "$created_index" = true ]; then
        [ -d "$TARGET_ROOT/.codegraph" ] && [ ! -L "$TARGET_ROOT/.codegraph" ] || fail "refusing CodeGraph uninstall: receipt-owned index path is not a safe directory"
        rm -rf "$TARGET_ROOT/.codegraph"
        echo "INDEX: removed"
    else
        echo "INDEX: preserved (pre-existing before explicit LazyBuddy initialization)"
    fi
    runtime_root="$(codegraph_runtime_root)"
    [ ! -L "$runtime_root" ] || fail "refusing CodeGraph uninstall: runtime root must not be a symlink"
    rm -rf "$runtime_root"
    rm "$(codegraph_receipt_path)"
    echo "STATE: removed"
}

codegraph_export_mcp() {
    local status
    status="$(codegraph_status)"
    if ! grep -qx 'STATE: ready' <<<"$status"; then
        printf '%s\n' "$status" >&2
        fail "CodeGraph MCP export requires explicit codegraph-init and codegraph-enable"
    fi
    python3 -B - "$PLUGIN_ROOT/mcp/codegraph/server.sh" "$TOOLING_ROOT" <<'PY'
import json
import sys

print(json.dumps({
    "codegraph": {
        "command": "bash",
        "args": [sys.argv[1]],
        "cwd": ".",
        "env": {"LAZYBUDDY_TOOLING_ROOT": sys.argv[2]},
        "required": False,
    },
}, indent=2, sort_keys=True))
PY
}

parse_remote() {
    TOOLING_ROOT=""
    REMOTE_CAPABILITY=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --tooling-root)
                [ "$#" -ge 2 ] || fail "--tooling-root requires an absolute path"
                TOOLING_ROOT="$2"
                shift 2
                ;;
            context7|grep_app)
                [ -z "$REMOTE_CAPABILITY" ] || fail "choose exactly one remote capability"
                REMOTE_CAPABILITY="$1"
                shift
                ;;
            *) fail "unsupported remote capability option: $1" ;;
        esac
    done
    [ -n "$TOOLING_ROOT" ] || fail "--tooling-root is required"
    [[ "$TOOLING_ROOT" == /* ]] || fail "--tooling-root must be an absolute path"
    [[ "/$TOOLING_ROOT/" != *"/../"* ]] || fail "tooling root must not contain traversal"
}

remote_status() {
    local context7_enabled grep_app_enabled
    if ! owned_root_is_valid; then
        echo "STATE: unavailable"
        echo "REASON: install package-owned tooling in an explicit root before selecting optional remote capabilities"
        return 0
    fi
    context7_enabled="$(remote_state_flag context7)"
    grep_app_enabled="$(remote_state_flag grep_app)"
    echo "CAPABILITY: context7"
    echo "STATE: $([ "$context7_enabled" = true ] && printf enabled || printf disabled)"
    echo "TRANSPORT: remote (not contacted)"
    echo "ENDPOINT: https://mcp.context7.com/mcp"
    echo "CAPABILITY: grep_app"
    echo "STATE: $([ "$grep_app_enabled" = true ] && printf enabled || printf disabled)"
    echo "TRANSPORT: remote (not contacted)"
    echo "ENDPOINT: https://mcp.grep.app"
    echo "EXPERIMENTAL: true"
    echo "VERSIONING: unpinned"
}

remote_enable_disable() {
    local enabled="$1" context7_enabled grep_app_enabled
    [ -n "$REMOTE_CAPABILITY" ] || fail "remote enable/disable requires context7 or grep_app"
    require_safe_existing_root
    owned_root_is_valid || fail "remote capability selection requires a verified receipt-owned tooling root"
    context7_enabled="$(remote_state_flag context7)"
    grep_app_enabled="$(remote_state_flag grep_app)"
    case "$REMOTE_CAPABILITY" in
        context7) context7_enabled="$enabled" ;;
        grep_app) grep_app_enabled="$enabled" ;;
        *) fail "unsupported remote capability: $REMOTE_CAPABILITY" ;;
    esac
    write_remote_state "$context7_enabled" "$grep_app_enabled"
    echo "CAPABILITY: $REMOTE_CAPABILITY"
    echo "STATE: $([ "$enabled" = true ] && printf enabled || printf disabled)"
    echo "REMOTE: not contacted"
}

remote_export_mcp() {
    local context7_enabled grep_app_enabled
    require_safe_existing_root
    owned_root_is_valid || fail "remote MCP export requires a verified receipt-owned tooling root"
    context7_enabled="$(remote_state_flag context7)"
    grep_app_enabled="$(remote_state_flag grep_app)"
    python3 -B - "$context7_enabled" "$grep_app_enabled" <<'PY'
import json
import sys

context7_enabled, grep_app_enabled = (value == "true" for value in sys.argv[1:])
servers = {}
if context7_enabled:
    servers["lazybuddy_context7"] = {
        "url": "https://mcp.context7.com/mcp",
        "required": False,
    }
if grep_app_enabled:
    servers["lazybuddy_grep_app"] = {
        "url": "https://mcp.grep.app",
        "required": False,
        "experimental": True,
        "versioning": "unpinned",
    }
print(json.dumps({"mcpServers": servers}, indent=2, sort_keys=True))
PY
}

remote_doctor() {
    remote_status
    echo "DOCTOR: PASS (optional remote capabilities)"
}

lsp_language() {
    if [ -f "$TARGET_ROOT/tsconfig.json" ] || [ -f "$TARGET_ROOT/jsconfig.json" ] \
        || find "$TARGET_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) -print -quit | grep -q .; then
        printf '%s\n' typescript
    elif [ -f "$TARGET_ROOT/pyproject.toml" ] || [ -f "$TARGET_ROOT/setup.py" ] || [ -f "$TARGET_ROOT/setup.cfg" ] || [ -f "$TARGET_ROOT/requirements.txt" ] \
        || find "$TARGET_ROOT" -type f -name '*.py' -print -quit | grep -q .; then
        printf '%s\n' python
    fi
}

lsp_command_name() {
    case "$1" in
        typescript) printf '%s\n' typescript-language-server ;;
        python) printf '%s\n' basedpyright-langserver ;;
        *) return 1 ;;
    esac
}

lsp_source_dir() {
    printf '%s\n' "$TOOLING_SOURCE/lsp/$1"
}

lsp_owned_binary() {
    local language="$1" command_name
    command_name="$(lsp_command_name "$language")"
    printf '%s\n' "$TOOLING_ROOT/lsp/$language/node_modules/.bin/$command_name"
}

lsp_project_binary() {
    local language="$1" command_name
    command_name="$(lsp_command_name "$language")"
    printf '%s\n' "$TARGET_ROOT/node_modules/.bin/$command_name"
}

lsp_binary_works() {
    [ -e "$1" ] && [ -x "$1" ]
}

lsp_provider() {
    local language="$1" command_name candidate
    command_name="$(lsp_command_name "$language")"
    candidate="$(lsp_project_binary "$language")"
    if lsp_binary_works "$candidate"; then
        printf 'project %s\n' "$candidate"
        return 0
    fi
    candidate="$(command -v "$command_name" 2>/dev/null || true)"
    if [ -n "$candidate" ] && lsp_binary_works "$candidate"; then
        printf 'host %s\n' "$candidate"
        return 0
    fi
    candidate="$(lsp_owned_binary "$language")"
    if lsp_binary_works "$candidate" && lsp_root_is_valid; then
        printf 'owned %s\n' "$candidate"
        return 0
    fi
    return 1
}

typescript_runtime_ready() {
    local runtime_root
    command -v node >/dev/null 2>&1 || return 1
    if lsp_npm_runtime_is_valid; then
        runtime_root="$(lsp_npm_runtime_root)"
        env -i \
            PATH="$PATH" \
            HOME="$runtime_root/home" \
            XDG_CONFIG_HOME="$runtime_root/config" \
            XDG_CACHE_HOME="$runtime_root/cache" \
            TMPDIR="$runtime_root/tmp" \
            NODE_COMPILE_CACHE="$runtime_root/cache/node-compile-cache" \
            node -p 'Number(process.versions.node.split(".")[0]) >= 20' 2>/dev/null | grep -Fxq true
    else
        env -i PATH="$PATH" node -p 'Number(process.versions.node.split(".")[0]) >= 20' 2>/dev/null | grep -Fxq true
    fi
}

lsp_node_modules_digest() {
    python3 -B - "$TOOLING_ROOT/lsp" <<'PY'
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
    entries.append(f"d {os.path.relpath(directory, root)}")
    for name in directory_names + file_names:
        path = os.path.join(directory, name)
        relative = os.path.relpath(path, root)
        status = os.lstat(path)
        if stat.S_ISLNK(status.st_mode):
            resolved = os.path.realpath(path)
            if os.path.commonpath((root, resolved)) != root:
                raise SystemExit(2)
            entries.append(f"l {relative} {os.readlink(path)}")
        elif stat.S_ISREG(status.st_mode) and status.st_nlink == 1:
            digest = hashlib.sha256()
            with open(path, "rb") as source:
                for chunk in iter(lambda: source.read(65536), b""):
                    digest.update(chunk)
            entries.append(f"f {relative} {digest.hexdigest()}")
        elif not stat.S_ISDIR(status.st_mode):
            raise SystemExit(2)
print(hashlib.sha256("\n".join(entries).encode()).hexdigest())
PY
}

lsp_receipt_contents() {
    python3 -B - "$TOOLING_ROOT" "$(lsp_node_modules_digest)" <<'PY'
import json
import sys

print(json.dumps({
    "schema_version": 1,
    "owner": "lazybuddy-lsp-tooling",
    "root": sys.argv[1],
    "owned_entries": ["lsp", ".lazybuddy-lsp-npm-runtime", ".lazybuddy-lsp-receipt.json"],
    "lsp_digest": sys.argv[2],
}, indent=2, sort_keys=True))
PY
}

lsp_root_is_valid() {
    root_is_safe_existing || return 1
    [ "$(find "$TOOLING_ROOT" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = "3" ] || return 1
    [ -d "$TOOLING_ROOT/lsp" ] && [ ! -L "$TOOLING_ROOT/lsp" ] || return 1
    lsp_npm_runtime_is_valid || return 1
    regular_unlinked_file "$TOOLING_ROOT/.lazybuddy-lsp-receipt.json" || return 1
    local language source
    for language in typescript python; do
        source="$(lsp_source_dir "$language")"
        if [ -d "$TOOLING_ROOT/lsp/$language" ]; then
            [ ! -L "$TOOLING_ROOT/lsp/$language" ] || return 1
            regular_unlinked_file "$TOOLING_ROOT/lsp/$language/package.json" || return 1
            regular_unlinked_file "$TOOLING_ROOT/lsp/$language/package-lock.json" || return 1
            [ -d "$TOOLING_ROOT/lsp/$language/node_modules" ] || return 1
            cmp -s "$source/package.json" "$TOOLING_ROOT/lsp/$language/package.json" || return 1
            cmp -s "$source/package-lock.json" "$TOOLING_ROOT/lsp/$language/package-lock.json" || return 1
        fi
    done
    find "$TOOLING_ROOT/lsp" -mindepth 1 -maxdepth 1 -type d -print | sed 's#.*/##' | sort | cmp -s - <(find "$TOOLING_ROOT/lsp" -mindepth 1 -maxdepth 1 -type d -print | sed 's#.*/##' | grep -Ex 'typescript|python' | sort) || return 1
    lsp_node_modules_digest >/dev/null 2>&1 || return 1
    cmp -s <(lsp_receipt_contents) "$TOOLING_ROOT/.lazybuddy-lsp-receipt.json"
}

lsp_npm_runtime_root() {
    printf '%s\n' "$TOOLING_ROOT/.lazybuddy-lsp-npm-runtime"
}

lsp_npm_runtime_is_valid() {
    local runtime_root
    runtime_root="$(lsp_npm_runtime_root)"
    [ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] || return 1
    [ -d "$runtime_root/home" ] && [ ! -L "$runtime_root/home" ] || return 1
    [ -d "$runtime_root/cache" ] && [ ! -L "$runtime_root/cache" ] || return 1
    [ -d "$runtime_root/config" ] && [ ! -L "$runtime_root/config" ] || return 1
    [ -d "$runtime_root/tmp" ] && [ ! -L "$runtime_root/tmp" ] || return 1
    find "$runtime_root" -mindepth 1 -maxdepth 1 -print | sed 's#.*/##' | sort | cmp -s - <(printf '%s\n' cache config home tmp | sort)
}

prepare_lsp_npm_runtime() {
    local runtime_root
    runtime_root="$(lsp_npm_runtime_root)"
    if [ -e "$runtime_root" ] && ! lsp_npm_runtime_is_valid; then
        fail "LSP npm runtime root must contain only real home, cache, config, and tmp directories"
    fi
    mkdir -p "$runtime_root/home" "$runtime_root/cache" "$runtime_root/config" "$runtime_root/tmp"
}

lsp_npm_ci() {
    local runtime_root
    prepare_lsp_npm_runtime
    runtime_root="$(lsp_npm_runtime_root)"
    (
        cd "$TOOLING_ROOT/lsp/$language"
        env -i \
            PATH="$PATH" \
            HOME="$runtime_root/home" \
            XDG_CONFIG_HOME="$runtime_root/config" \
            XDG_CACHE_HOME="$runtime_root/cache" \
            TMPDIR="$runtime_root/tmp" \
            NODE_COMPILE_CACHE="$runtime_root/cache/node-compile-cache" \
            PYTHONPYCACHEPREFIX="$runtime_root/cache/python" \
            npm_config_cache="$runtime_root/cache" \
            npm_config_userconfig="$runtime_root/config/npmrc" \
            npm_config_update_notifier=false \
            NO_UPDATE_NOTIFIER=1 \
            npm ci --ignore-scripts --no-audit --fund=false
    )
}

lsp_status() {
    local language provider
    language="$(lsp_language)"
    if [ -z "$language" ]; then
        echo "STATE: unsupported"
        echo "REASON: no supported JavaScript/TypeScript or Python source/configuration detected"
        return 0
    fi
    if [ "$language" = "typescript" ] && ! typescript_runtime_ready; then
        echo "STATE: incompatible"
        echo "LANGUAGE: typescript"
        echo "REASON: typescript-language-server@5.3.0 requires Node.js 20 or newer"
        return 0
    fi
    if provider="$(lsp_provider "$language")"; then
        echo "STATE: ready"
        echo "LANGUAGE: $language"
        echo "PROVIDER: $provider"
    else
        echo "STATE: missing"
        echo "LANGUAGE: $language"
        echo "REASON: no compatible project, host, or receipt-owned LSP provider is available"
    fi
}

lsp_install() {
    local language provider source
    language="$(lsp_language)"
    if [ -z "$language" ]; then
        echo "STATE: unsupported"
        echo "REASON: no supported JavaScript/TypeScript or Python source/configuration detected"
        return 0
    fi
    if [ "$language" = "typescript" ] && ! typescript_runtime_ready; then
        echo "STATE: incompatible"
        echo "LANGUAGE: typescript"
        echo "REASON: typescript-language-server@5.3.0 requires Node.js 20 or newer"
        return 0
    fi
    if provider="$(lsp_provider "$language")"; then
        echo "STATE: ready"
        echo "LANGUAGE: $language"
        echo "PROVIDER: $provider"
        return 0
    fi
    require_safe_existing_root
    if ! root_is_empty; then
        fail "LSP tooling root must be empty when provisioning a provider"
    fi
    command -v npm >/dev/null 2>&1 || fail "npm is required to install the locked LSP provider"
    source="$(lsp_source_dir "$language")"
    mkdir -p "$TOOLING_ROOT/lsp/$language"
    cp "$source/package.json" "$TOOLING_ROOT/lsp/$language/package.json"
    cp "$source/package-lock.json" "$TOOLING_ROOT/lsp/$language/package-lock.json"
    lsp_npm_ci
    lsp_receipt_contents > "$TOOLING_ROOT/.lazybuddy-lsp-receipt.json"
    if ! lsp_root_is_valid || ! provider="$(lsp_provider "$language")"; then
        fail "LSP installation did not produce a verified receipt-owned provider"
    fi
    echo "STATE: ready"
    echo "LANGUAGE: $language"
    echo "PROVIDER: $provider"
}

lsp_doctor() {
    local output
    output="$(lsp_status)"
    printf '%s\n' "$output"
    grep -qx 'STATE: ready' <<<"$output" && { echo "DOCTOR: PASS"; return 0; }
    echo "DOCTOR: DEGRADED"
    return 0
}

lsp_uninstall() {
    if ! lsp_root_is_valid; then
        fail "refusing LSP uninstall: root is not an unmodified receipt-owned installation"
    fi
    rm -rf "$TOOLING_ROOT"
    echo "STATE: removed"
    echo "ROOT: $TOOLING_ROOT"
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
            python3 -B - "$TARGET_ROOT/package.json" <<'PY'
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
            python3 -B - "$TARGET_ROOT/pyproject.toml" <<'PY'
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
            python3 -B - "$TARGET_ROOT/pyproject.toml" "$task_name" <<'PY'
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
    python3 -B - "$TARGET_ROOT" "$VERIFY_TIMEOUT_SECONDS" "$@" <<'PY'
import json
import os
import signal
import subprocess
import sys
import tempfile

target, timeout_text, *command = sys.argv[1:]
environment = os.environ.copy()
runtime = None
if command and command[0] == "npm":
    runtime = tempfile.TemporaryDirectory(prefix="lazybuddy-verify-npm-")
    for name in ("home", "cache", "config", "tmp"):
        os.makedirs(os.path.join(runtime.name, name), exist_ok=True)
    for name in tuple(environment):
        if name.lower().startswith("npm_config_"):
            environment.pop(name)
    environment.update({
        "HOME": os.path.join(runtime.name, "home"),
        "XDG_CONFIG_HOME": os.path.join(runtime.name, "config"),
        "XDG_CACHE_HOME": os.path.join(runtime.name, "cache"),
        "TMPDIR": os.path.join(runtime.name, "tmp"),
        "NODE_COMPILE_CACHE": os.path.join(runtime.name, "cache", "node-compile-cache"),
        "npm_config_cache": os.path.join(runtime.name, "cache"),
        "npm_config_userconfig": os.path.join(runtime.name, "config", "npmrc"),
        "npm_config_update_notifier": "false",
        "NO_UPDATE_NOTIFIER": "1",
    })
process = subprocess.Popen(command, cwd=target, start_new_session=True, env=environment)
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
finally:
    if runtime is not None:
        runtime.cleanup()
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
            python3 -B - "$TARGET_ROOT/pyproject.toml" "$task_name" <<'PY'
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
    setup|providers|approval|toolpack)
        exec python3 -B "$PLUGIN_ROOT/tooling/lazybuddy_policy.py" "$COMMAND" "$@"
        ;;
    capability)
        exec python3 -B "$PLUGIN_ROOT/tooling/lazybuddy_capability.py" "$COMMAND" "$@"
        ;;
    detector)
        exec python3 -B "$PLUGIN_ROOT/tooling/lazybuddy_detector.py" "$@"
        ;;
    remote-status|remote-doctor|remote-enable|remote-disable|remote-export-mcp)
        parse_remote "$@"
        case "$COMMAND" in
            remote-status) remote_status ;;
            remote-doctor) remote_doctor ;;
            remote-enable) remote_enable_disable true ;;
            remote-disable) remote_enable_disable false ;;
            remote-export-mcp) remote_export_mcp ;;
        esac
        ;;
    verify) parse_verify "$@"; verify_target ;;
    lsp-status|lsp-install|lsp-doctor|lsp-uninstall)
        parse_lsp "$@"
        case "$COMMAND" in
            lsp-status) lsp_status ;;
            lsp-install) lsp_install ;;
            lsp-doctor) lsp_doctor ;;
            lsp-uninstall) lsp_uninstall ;;
        esac
        ;;
    codegraph-status|codegraph-install|codegraph-init|codegraph-enable|codegraph-doctor|codegraph-uninstall|codegraph-export-mcp)
        parse_codegraph "$@"
        case "$COMMAND" in
            codegraph-status) codegraph_status ;;
            codegraph-install) codegraph_install ;;
            codegraph-init) codegraph_init ;;
            codegraph-enable) codegraph_enable ;;
            codegraph-doctor) codegraph_doctor ;;
            codegraph-uninstall) codegraph_uninstall ;;
            codegraph-export-mcp) codegraph_export_mcp ;;
        esac
        ;;
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
