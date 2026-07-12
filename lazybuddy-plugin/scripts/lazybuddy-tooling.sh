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
Usage: lazybuddy-tooling.sh <detect|install|status|doctor|uninstall> --tooling-root ABSOLUTE_EMPTY_DIRECTORY

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
    python3 - "$TOOLING_ROOT" <<'PY'
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
        ".lazybuddy-tooling-receipt.json",
    ],
}, indent=2, sort_keys=True))
PY
}

root_contains_only_owned_entries() {
    [ "$(find "$TOOLING_ROOT" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = "4" ] \
        && [ -e "$TOOLING_ROOT/package.json" ] \
        && [ -e "$TOOLING_ROOT/package-lock.json" ] \
        && [ -e "$TOOLING_ROOT/capabilities.json" ] \
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

detect_tooling() {
    print_status
    echo "REGISTRY: $REGISTRY_SOURCE"
    echo "PROVIDERS: none configured"
}

install_tooling() {
    require_safe_existing_root
    if ! root_is_empty; then
        fail "tooling root must be empty"
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
    rm -f \
        "$TOOLING_ROOT/package.json" \
        "$TOOLING_ROOT/package-lock.json" \
        "$TOOLING_ROOT/capabilities.json" \
        "$TOOLING_ROOT/$RECEIPT_NAME"
    rmdir "$TOOLING_ROOT"
    echo "STATE: removed"
    echo "ROOT: $TOOLING_ROOT"
}

if [ "$#" -lt 1 ]; then
    usage >&2
    exit 2
fi

COMMAND="$1"
shift
parse_root "$@"

case "$COMMAND" in
    detect) detect_tooling ;;
    install) install_tooling ;;
    status) print_status ;;
    doctor) doctor_tooling ;;
    uninstall) uninstall_tooling ;;
    *) usage >&2; exit 2 ;;
esac
