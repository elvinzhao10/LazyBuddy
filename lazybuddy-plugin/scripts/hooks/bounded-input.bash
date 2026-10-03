#!/usr/bin/env bash
# Capture at most 1 MiB plus one overflow byte before any hook side effects.
hook_read_input() {
    HOOK_INPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/lazy-hook-input.XXXXXX") || return 1
    trap 'rm -f "$HOOK_INPUT_FILE"' EXIT
    if ! head -c 1048577 >"$HOOK_INPUT_FILE"; then
        printf '%s\n' '{"error":"hook_input_unreadable"}' >&2
        return 1
    fi
    if [ "$(wc -c <"$HOOK_INPUT_FILE")" -gt 1048576 ]; then
        printf '%s\n' '{"error":"hook_input_too_large","limit_bytes":1048576}' >&2
        return 1
    fi
}
