#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh --project-dir <absolute-project-root>

Read-only check for the package inputs used by the observed WorkBuddy build's
cache-preparation route. This command never changes WorkBuddy host state.
EOF
}

refuse_apply() {
    printf '%s\n' \
        "ERROR: --apply is unsupported: the observed WorkBuddy build's installed_plugins.json uses a private, unverified schema; no host state was changed." >&2
    exit 2
}

for argument in "$@"; do
    if [ "$argument" = '--apply' ]; then
        refuse_apply
    fi
done

PROJECT_DIR=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --project-dir)
            if [ "$#" -lt 2 ] || [ -z "$2" ]; then
                printf 'ERROR: --project-dir requires an absolute project root\n' >&2
                exit 2
            fi
            PROJECT_DIR="$2"
            shift 2
            ;;
        --apply)
            refuse_apply
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'ERROR: unknown argument; run with --help for supported options\n' >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [ -z "$PROJECT_DIR" ]; then
    printf 'ERROR: --project-dir is required\n' >&2
    usage >&2
    exit 2
fi
case "$PROJECT_DIR" in
    /*) ;;
    *)
        printf 'ERROR: project root must be an absolute path\n' >&2
        exit 2
        ;;
esac
if [ ! -d "$PROJECT_DIR" ]; then
    printf 'ERROR: project root directory is missing\n' >&2
    exit 1
fi
if ! PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_DIR" 2>/dev/null && pwd -P)"; then
    printf 'ERROR: project root directory is inaccessible\n' >&2
    exit 1
fi

if ! SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)" \
    || ! PLUGIN_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P)" \
    || ! RELEASE_ROOT="$(CDPATH= cd -- "$PLUGIN_ROOT/.." 2>/dev/null && pwd -P)"; then
    printf 'ERROR: LazyBuddy package location is inaccessible\n' >&2
    exit 1
fi

if [ ! -f "$PLUGIN_ROOT/.workbuddy-plugin/plugin.json" ] \
    || [ ! -f "$PLUGIN_ROOT/.mcp.json" ] \
    || [ ! -f "$RELEASE_ROOT/.codebuddy-plugin/marketplace.json" ]; then
    printf '%s\n' \
        'ERROR: LazyBuddy plugin root is unavailable; keep this script under the v1.0.2 lazybuddy-plugin/scripts directory.' >&2
    exit 1
fi

if [ -z "${HOME:-}" ]; then
    printf 'ERROR: HOME must identify the WorkBuddy user profile for this read-only plan\n' >&2
    exit 2
fi
case "$HOME" in
    /*) ;;
    *)
        printf 'ERROR: HOME must be an absolute path\n' >&2
        exit 2
        ;;
esac

python3 - "$PLUGIN_ROOT" "$RELEASE_ROOT" "$PROJECT_ROOT" "$HOME" <<'PY'
import json
import os
from pathlib import Path
import stat
import sys

plugin_root = Path(sys.argv[1]).resolve()
release_root = Path(sys.argv[2]).resolve()
project_root = Path(sys.argv[3]).resolve()
home_root = Path(os.path.abspath(sys.argv[4]))
version = "1.0.2"
server_names = (
    "run-ledger",
    "verification",
    "status-dashboard",
    "context-graph",
    "code-intel",
    "docs",
)


def load_object(path: Path, label: str):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        raise ValueError(f"{label} is unavailable") from None
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"{label} is invalid JSON at line {exc.lineno}, column {exc.colno}"
        ) from None
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


try:
    work_manifest = load_object(
        plugin_root / ".workbuddy-plugin" / "plugin.json",
        "WorkBuddy manifest",
    )
    if work_manifest.get("name") != "lazybuddy" or work_manifest.get("version") != version:
        raise ValueError("WorkBuddy manifest must identify lazybuddy version 1.0.2")

    marketplace = load_object(
        release_root / ".codebuddy-plugin" / "marketplace.json",
        "release marketplace",
    )
    entries = marketplace.get("plugins")
    if marketplace.get("name") != "lazybuddy" or not isinstance(entries, list):
        raise ValueError("release marketplace must identify lazybuddy and contain a plugins array")
    entry = next(
        (
            item
            for item in entries
            if isinstance(item, dict) and item.get("name") == "lazybuddy"
        ),
        None,
    )
    if entry is None or entry.get("version") != version or entry.get("source") != "./lazybuddy-plugin":
        raise ValueError("release marketplace must contain lazybuddy 1.0.2 from ./lazybuddy-plugin")
    if (release_root / entry["source"]).resolve() != plugin_root:
        raise ValueError("release marketplace source does not resolve to this plugin root")

    source_mcp = load_object(plugin_root / ".mcp.json", "MCP configuration")
    if set(source_mcp) != {"mcpServers"}:
        raise ValueError("MCP configuration must contain only the mcpServers object")
    servers = source_mcp.get("mcpServers")
    if not isinstance(servers, dict) or tuple(servers) != server_names:
        raise ValueError("MCP configuration must declare the six LazyBuddy servers in canonical order")

    rendered = {}
    for name in server_names:
        source = servers[name]
        if not isinstance(source, dict):
            raise ValueError(f"MCP server {name} must be a JSON object")
        if set(source) != {"command", "args", "cwd", "required"}:
            raise ValueError(
                f"MCP server {name} fields are unsupported; "
                "expected exactly command, args, cwd, and required"
            )
        expected_arg = f"${{CODEBUDDY_PLUGIN_ROOT}}/mcp/{name}/server.sh"
        if source.get("command") != "bash" or source.get("args") != [expected_arg]:
            raise ValueError(f"MCP server {name} must use its package launcher")
        if source.get("cwd") != "${CODEBUDDY_PROJECT_DIR}":
            raise ValueError(f"MCP server {name} must use CODEBUDDY_PROJECT_DIR as cwd")
        if source.get("required") is not False:
            raise ValueError(f"MCP server {name} must declare required=false")
        launcher = plugin_root / "mcp" / name / "server.sh"
        try:
            launcher_mode = launcher.lstat().st_mode
        except OSError:
            raise ValueError(
                f"MCP server {name} launcher must be a regular, non-symlink executable"
            ) from None
        if (
            stat.S_ISLNK(launcher_mode)
            or not stat.S_ISREG(launcher_mode)
            or not os.access(launcher, os.X_OK)
        ):
            raise ValueError(
                f"MCP server {name} launcher must be a regular, non-symlink executable"
            )
        try:
            resolved_launcher = launcher.resolve(strict=True)
        except OSError:
            raise ValueError(
                f"MCP server {name} launcher must be a regular, non-symlink executable"
            ) from None
        if resolved_launcher != launcher:
            raise ValueError(
                f"MCP server {name} launcher path must not contain symlinks"
            )
        rendered[name] = {
            "command": "bash",
            "args": [str(launcher)],
            "cwd": str(project_root),
            "env": {
                "CWD": str(project_root),
                "CODEBUDDY_PROJECT_DIR": str(project_root),
            },
        }

    print(
        "MCP_RENDER_JSON="
        + json.dumps({"mcpServers": rendered}, ensure_ascii=False, separators=(",", ":"))
    )
    print(
        "PATHS_JSON="
        + json.dumps(
            {
                "pluginRoot": str(plugin_root),
                "releaseRoot": str(release_root),
                "projectRoot": str(project_root),
                "cacheTarget": str(
                    home_root / ".workbuddy" / "plugins" / "cache" / "lazybuddy" / "lazybuddy" / version
                ),
                "registryTarget": str(
                    home_root / ".workbuddy" / "plugins" / "installed_plugins.json"
                ),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
except ValueError as exc:
    print(f"ERROR: {exc}", file=sys.stderr)
    raise SystemExit(1)
PY

printf 'OBSERVED_WORKBUDDY_BUILD=5.2.6\n'
printf 'MCP_RENDER=ready (6 absolute launchers; cwd, CWD, and CODEBUDDY_PROJECT_DIR set)\n'
printf 'PACKAGE_PREPARATION=ready\n'
printf 'HOST_PREPARATION=not-applied\n'
printf 'HOST_MUTATION=none\n'
printf 'HOST_READINESS=pending\n'
