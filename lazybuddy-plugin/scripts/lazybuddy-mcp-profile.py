#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# How to run: python3 lazybuddy-mcp-profile.py --mode direct --project-dir /workspace --plugin-data /plugin-data
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Final, TypedDict


class LspDeclaration(TypedDict):
    command: str
    args: list[str]
    extensionToLanguage: dict[str, str]


class ProfileError(Exception):
    def __init__(self, message: str, exit_code: int = 2) -> None:
        super().__init__(message)
        self.exit_code = exit_code


SERVER_NAMES: Final = (
    "run-ledger",
    "verification",
    "status-dashboard",
    "context-graph",
    "code-intel",
    "docs",
)
DEFERRED_SERVERS: Final = frozenset(("context-graph", "code-intel", "docs"))
MODE_SERVERS: Final[dict[str, tuple[str, ...]]] = {
    "direct": SERVER_NAMES[:3],
    "assisted": SERVER_NAMES[:5],
    "planned": SERVER_NAMES[:4] + (SERVER_NAMES[5],),
    "orchestrated": SERVER_NAMES,
    "long-horizon": SERVER_NAMES,
}


def parse_mode(raw: str) -> str:
    if raw in MODE_SERVERS:
        return raw
    raise ProfileError(f"unsupported MCP mode: {raw}")


def absolute_path(raw: str, label: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise ProfileError(f"{label} must be absolute")
    if path.is_symlink():
        raise ProfileError(f"{label} must not be a symlink")
    return path.resolve(strict=False)


def path_contains(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ProfileError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def load_declarations(plugin_root: Path) -> dict[str, dict[str, str | bool | list[str] | dict[str, str]]]:
    path = plugin_root / ".mcp.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
        servers = document["mcpServers"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise ProfileError(f"MCP declaration is unavailable: {error}") from None
    if not isinstance(document, dict) or set(document) != {"mcpServers"}:
        raise ProfileError("MCP declaration must contain only mcpServers")
    if not isinstance(servers, dict) or tuple(servers) != SERVER_NAMES:
        raise ProfileError("MCP declaration must contain the canonical six-server inventory")
    return servers


def render_profile(
    declarations: dict[str, dict[str, str | bool | list[str] | dict[str, str]]],
    selected: tuple[str, ...],
    plugin_root: Path,
    project_root: Path,
    plugin_data: Path,
    mode: str,
) -> dict[str, dict[str, dict[str, str | bool | list[str] | dict[str, str]]]]:
    rendered = {}
    for name in selected:
        declaration = declarations[name]
        expected_fields = {"type", "command", "args", "env", "defer_loading"}
        if set(declaration) != expected_fields or declaration.get("type") != "stdio":
            raise ProfileError(f"MCP declaration {name} must be a typed stdio server")
        expected_arg = f"${{CODEBUDDY_PLUGIN_ROOT}}/mcp/{name}/server.sh"
        if declaration.get("command") != "bash" or declaration.get("args") != [expected_arg]:
            raise ProfileError(f"MCP declaration {name} has an invalid launcher")
        launcher = plugin_root / "mcp" / name / "server.sh"
        if launcher.is_symlink() or not launcher.is_file() or not os.access(launcher, os.X_OK):
            raise ProfileError(f"MCP declaration {name} launcher is unavailable")
        expected_env = {
            "CWD": "${CODEBUDDY_PROJECT_DIR}",
            "CODEBUDDY_PROJECT_DIR": "${CODEBUDDY_PROJECT_DIR}",
            "LAZYBUDDY_MCP_MODE": "${user_config.mcp_mode}",
            "LAZYBUDDY_DEPENDENCY_ROOT": "${CODEBUDDY_PLUGIN_DATA}/dependencies",
            "LAZYBUDDY_CACHE_ROOT": "${CODEBUDDY_PLUGIN_DATA}/cache",
        }
        if declaration.get("env") != expected_env:
            raise ProfileError(f"MCP declaration {name} has invalid process paths")
        expected_deferred = name in DEFERRED_SERVERS
        if declaration.get("defer_loading") is not expected_deferred:
            raise ProfileError(f"MCP declaration {name} has invalid deferred loading")
        rendered[name] = {
            "type": "stdio",
            "command": "bash",
            "args": [str(plugin_root / "mcp" / name / "server.sh")],
            "env": {
                "CWD": str(project_root),
                "CODEBUDDY_PROJECT_DIR": str(project_root),
                "LAZYBUDDY_MCP_MODE": mode,
                "LAZYBUDDY_DEPENDENCY_ROOT": str(plugin_data / "dependencies"),
                "LAZYBUDDY_CACHE_ROOT": str(plugin_data / "cache"),
            },
            "defer_loading": expected_deferred,
        }
    return {"mcpServers": rendered}


def project_languages(project_root: Path) -> tuple[str, ...]:
    found: set[str] = set()
    visited = 0
    for base, directories, files in os.walk(project_root):
        directories[:] = [name for name in directories if name not in {".git", "node_modules", ".lazybuddy"}]
        visited += len(files)
        if visited > 20000:
            break
        suffixes = {Path(name).suffix for name in files}
        if suffixes.intersection({".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}):
            found.add("typescript")
        if ".py" in suffixes:
            found.add("python")
        if found == {"typescript", "python"}:
            break
    return tuple(name for name in ("typescript", "python") if name in found)


def detected_lsp(project_root: Path) -> dict[str, LspDeclaration]:
    detected: dict[str, LspDeclaration] = {}
    for language in project_languages(project_root):
        if language == "typescript" and shutil.which("typescript-language-server"):
            detected[language] = {
                "command": "typescript-language-server",
                "args": ["--stdio"],
                "extensionToLanguage": {".js": "javascript", ".jsx": "javascriptreact", ".ts": "typescript", ".tsx": "typescriptreact"},
            }
        if language == "python" and shutil.which("basedpyright-langserver"):
            detected[language] = {
                "command": "basedpyright-langserver",
                "args": ["--stdio"],
                "extensionToLanguage": {".py": "python"},
            }
    return detected


def write_lsp_cache(plugin_data: Path, declarations: dict[str, LspDeclaration]) -> Path:
    target = plugin_data / "cache" / "lsp" / ".lsp.json"
    target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(declarations, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)
    return target


def run(arguments: argparse.Namespace) -> int:
    mode = parse_mode(arguments.mode)
    plugin_root = Path(__file__).resolve().parent.parent
    project_root = absolute_path(arguments.project_dir, "project directory")
    plugin_data = absolute_path(arguments.plugin_data, "plugin data")
    if not project_root.is_dir():
        raise ProfileError("project directory is unavailable")
    if path_contains(plugin_root, plugin_data) or path_contains(project_root, plugin_data):
        raise ProfileError("plugin data must stay outside the plugin and project roots")
    if plugin_data.exists() and not plugin_data.is_dir():
        raise ProfileError("plugin data must be a directory")

    selected = MODE_SERVERS[mode]
    requested = arguments.request_server
    if requested is not None:
        if requested not in SERVER_NAMES:
            raise ProfileError(f"unknown MCP server: {requested}")
        if requested not in selected:
            raise ProfileError(f"MCP_PROFILE_DEFERRED server={requested} mode={mode}", exit_code=3)

    declarations = load_declarations(plugin_root)
    profile = render_profile(declarations, selected, plugin_root, project_root, plugin_data, mode)
    print(f"PROFILE_MODE={mode}")
    print("SELECTED_SERVERS=" + ",".join(selected))
    if requested is not None:
        loading = "deferred" if requested in DEFERRED_SERVERS else "direct"
        print(f"MCP_PROFILE_AVAILABLE server={requested} mode={mode} loading={loading}")
    print("MCP_PROFILE_JSON=" + json.dumps(profile, separators=(",", ":")))

    if arguments.detect_lsp:
        lsp = detected_lsp(project_root)
        if lsp:
            if not plugin_data.is_dir():
                raise ProfileError("plugin data must exist before writing detected LSP cache")
            print(f"LSP_STATE=detected path={write_lsp_cache(plugin_data, lsp)}")
        else:
            print("LSP_STATE=unavailable")
    print("NETWORK=not-used")
    print("RUNTIME_INSTALL=none")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--plugin-data", required=True)
    parser.add_argument("--request-server")
    parser.add_argument("--detect-lsp", action="store_true")
    try:
        return run(parser.parse_args())
    except ProfileError as error:
        print(str(error), file=sys.stderr)
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
