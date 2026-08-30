#!/usr/bin/env bash
state_require_safe_run_id() {
    local run_id="${1:-}"

    if [ -z "$run_id" ] || [ "$run_id" = "." ] || [ "$run_id" = ".." ] || \
       [[ "$run_id" == /* || "$run_id" == *"/"* || "$run_id" == *\\* ]] || \
       ! [[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
        echo "Error: invalid run_id" >&2
        return 1
    fi
}

state_recover_transaction() {
    local run_dir="${1:-}"
    local state_script_dir
    state_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$state_script_dir/state-transaction.py" recover "$run_dir" >/dev/null
}

state_commit_transaction() {
    local run_dir="${1:-}"
    local operation="${2:-}"
    shift 2
    local state_script_dir
    state_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$state_script_dir/state-transaction.py" commit "$run_dir" "$operation" "$@" >/dev/null
}

state_transaction_write_arg() {
    local relative_path="${1:-}"
    local target_path="${2:-}"
    local source_path="${3:-}"
    local digest="missing"
    if [ -f "$target_path" ]; then
        digest="$(shasum -a 256 "$target_path" | awk '{print $1}')"
    fi
    printf '%s|%s|%s\n' "$relative_path" "$digest" "$source_path"
}

state_prepare_runs_dir() {
    local cwd="${1:-.}"
    local state_dir="$cwd/.lazybuddy"
    local runs_dir="$state_dir/runs"

    if [ -L "$state_dir" ] || [ -L "$runs_dir" ]; then
        echo "Error: LazyBuddy state directories must not be symlinks" >&2
        return 1
    fi
    mkdir -p "$runs_dir"

    STATE_RUNS_DIR="$runs_dir"
}

state_require_run_dir() {
    local cwd="${1:-.}"
    local run_id="${2:-}"

    local state_dir="$cwd/.lazybuddy"
    local runs_dir="$state_dir/runs"

    state_require_safe_run_id "$run_id" || return 1
    if [ ! -d "$runs_dir" ]; then
        echo "Error: run directory not found" >&2
        return 1
    fi
    if [ -L "$state_dir" ] || [ -L "$runs_dir" ]; then
        echo "Error: LazyBuddy state directories must not be symlinks" >&2
        return 1
    fi

    STATE_RUNS_DIR="$runs_dir"
    STATE_RUN_DIR="$runs_dir/$run_id"
    if [ -L "$STATE_RUN_DIR" ]; then
        echo "Error: run directory must not be a symlink" >&2
        return 1
    fi
}

state_require_safe_run_file() {
    local path="${1:-}"
    local label="${2:-run file}"

    if [ -L "$path" ]; then
        echo "Error: $label must not be a symlink" >&2
        return 1
    fi
    if [ -e "$path" ] && [ ! -f "$path" ]; then
        echo "Error: $label must be a regular file" >&2
        return 1
    fi
}

state_require_existing_run_file() {
    local path="${1:-}"
    local label="${2:-run file}"

    state_require_safe_run_file "$path" "$label" || return 1
    if [ ! -f "$path" ]; then
        echo "Error: $label not found" >&2
        return 1
    fi
}

state_resolve_plan_reference() {
    local cwd="${1:-.}"
    local reference="${2:-}"
    local resolved

    if [ -z "$reference" ]; then
        echo "Error: plan_reference must be a relative .lazybuddy path" >&2
        return 1
    fi

    if ! resolved=$(python3 - "$cwd" "$reference" <<'PY'
import os
import sys

cwd, reference = sys.argv[1:]
if os.path.isabs(reference):
    raise SystemExit("plan_reference must be relative")
parts = reference.replace("\\", "/").split("/")
if any(part in ("", ".", "..") for part in parts):
    raise SystemExit("plan_reference must not contain traversal")

project_root = os.path.realpath(cwd)
state_root = os.path.join(project_root, ".lazybuddy")
candidate = os.path.normpath(os.path.join(project_root, reference))
if os.path.commonpath((candidate, state_root)) != state_root:
    raise SystemExit("plan_reference must stay under .lazybuddy")

probe = project_root
for part in parts:
    probe = os.path.join(probe, part)
    if os.path.islink(probe):
        raise SystemExit("plan_reference must not traverse symlinks")

print(candidate)
PY
); then
        echo "Error: plan_reference must not be a symlink and must stay under .lazybuddy" >&2
        return 1
    fi

    STATE_PLAN_PATH="$resolved"
}

state_prepare_safe_run_directory() {
    local path="${1:-}"
    local label="${2:-run directory}"

    if [ -L "$path" ]; then
        echo "Error: $label must not be a symlink" >&2
        return 1
    fi
    if [ -e "$path" ] && [ ! -d "$path" ]; then
        echo "Error: $label must be a directory" >&2
        return 1
    fi
    mkdir -p "$path"
    if [ -L "$path" ] || [ ! -d "$path" ]; then
        echo "Error: $label must be a directory" >&2
        return 1
    fi
}

state_require_safe_run_directory() {
    local path="${1:-}"
    local label="${2:-run directory}"

    if [ -L "$path" ]; then
        echo "Error: $label must not be a symlink" >&2
        return 1
    fi
    if [ ! -d "$path" ]; then
        echo "Error: $label not found" >&2
        return 1
    fi
}
