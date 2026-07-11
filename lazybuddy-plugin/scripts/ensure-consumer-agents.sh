#!/usr/bin/env bash
set -euo pipefail

fail() {
    echo "ensure-consumer-agents: $1" >&2
    exit 1
}

reject_symlinked_path_components() {
    local label="$1"
    local path="$2"
    local remaining
    local prefix
    local component
    local candidate

    case "$path" in
        /*)
            prefix=/
            remaining="${path#/}"
            ;;
        *)
            prefix="$(CDPATH= cd -P -- . && pwd -P)" || fail "$label is unavailable"
            remaining="$path"
            ;;
    esac

    while [ -n "$remaining" ]; do
        component="${remaining%%/*}"
        if [ "$component" = "$remaining" ]; then
            remaining=
        else
            remaining="${remaining#*/}"
        fi

        [ -n "$component" ] || continue
        case "$component" in
            .)
                continue
                ;;
            ..)
                prefix="$prefix/.."
                continue
                ;;
        esac

        if [ "$prefix" = / ]; then
            candidate="/$component"
        else
            candidate="$prefix/$component"
        fi

        [ ! -L "$candidate" ] || fail "$label path must not be symlinked"
        prefix="$candidate"
    done
}

resolve_directory() {
    local label="$1"
    local path="$2"
    local physical_path

    [ -n "$path" ] || fail "$label must be set"
    reject_symlinked_path_components "$label" "$path"
    [ -d "$path" ] || fail "$label is unavailable"
    [ ! -L "$path" ] || fail "$label must not be a symlink"
    physical_path="$(CDPATH= cd -P -- "$path" && pwd -P)" || fail "$label is unavailable"
    printf '%s\n' "$physical_path"
}

PROJECT_ROOT="$(resolve_directory CWD "${CWD:-}")"
PLUGIN_ROOT="$(resolve_directory CODEBUDDY_PLUGIN_ROOT "${CODEBUDDY_PLUGIN_ROOT:-}")"
TEMPLATE="$PLUGIN_ROOT/templates/AGENTS.md"
DESTINATION="$PROJECT_ROOT/AGENTS.md"

[ -f "$TEMPLATE" ] && [ ! -L "$TEMPLATE" ] || fail "consumer AGENTS template is unavailable"

if [ -L "$DESTINATION" ]; then
    fail "AGENTS.md destination must not be a symlink"
fi

if [ -e "$DESTINATION" ]; then
    [ -f "$DESTINATION" ] || fail "AGENTS.md destination must be absent or regular"
    echo "AGENTS_STATUS=preserved path=$DESTINATION"
    exit 0
fi

if ! (
    set -o noclobber
    exec 3> "$DESTINATION"
    cat "$TEMPLATE" >&3
    exec 3>&-
); then
    fail "could not create AGENTS.md destination"
fi

echo "AGENTS_STATUS=created path=$DESTINATION"
