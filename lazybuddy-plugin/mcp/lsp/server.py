#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

from session import LspSession, position, source_path

MCP_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = MCP_ROOT.parent
if str(MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(MCP_ROOT))
from jsonrpc import serve
TOOLING = PLUGIN_ROOT / "scripts" / "lazybuddy-tooling.sh"
TARGET_ROOT = Path(os.environ.get("CWD", os.getcwd())).resolve()
TOOLING_ROOT = os.environ.get("LAZYBUDDY_TOOLING_ROOT", "")
TIMEOUT_SECONDS = float(os.environ.get("LAZYBUDDY_LSP_TIMEOUT_SECONDS", "8"))


def json_line(value: dict[str, object]) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def mcp_result(request_id: object, result: dict[str, object], notification: bool) -> None:
    if not notification:
        json_line({"jsonrpc": "2.0", "id": request_id, "result": result})


def mcp_error(request_id: object, code: int, message: str, notification: bool) -> None:
    if not notification:
        json_line({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def tooling_status() -> dict[str, str]:
    if not TOOLING_ROOT:
        return {"STATE": "missing", "REASON": "LAZYBUDDY_TOOLING_ROOT is required for an owned provider"}
    try:
        completed = subprocess.run(
            ["bash", str(TOOLING), "lsp-status", "--target", str(TARGET_ROOT), "--tooling-root", TOOLING_ROOT],
            capture_output=True,
            cwd=TARGET_ROOT,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"STATE": "unavailable", "REASON": "LSP status inspection exceeded bounded timeout"}
    result: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        key, separator, value = line.partition(": ")
        if separator:
            result[key] = value
    if "STATE" not in result:
        return {"STATE": "missing", "REASON": "LSP status inspection failed without changing the target"}
    return result


def provider_command(status: dict[str, str]) -> Optional[Tuple[str, str]]:
    provider = status.get("PROVIDER", "")
    owner, separator, path = provider.partition(" ")
    if not separator or owner not in {"project", "host", "owned"} or not path:
        return None
    language = status.get("LANGUAGE", "")
    if language == "typescript":
        return path, "typescript"
    if language == "python":
        return path, "python"
    return None


def advertised_operations(capabilities: dict[str, object]) -> list[str]:
    operations: list[str] = []
    if capabilities.get("definitionProvider"):
        operations.append("definition")
    if capabilities.get("referencesProvider"):
        operations.append("references")
    if capabilities.get("documentSymbolProvider"):
        operations.append("symbols")
    if capabilities.get("hoverProvider"):
        operations.append("hover")
    operations.append("diagnostics")
    return operations


def bridge_capabilities(status: dict[str, str]) -> Tuple[List[str], Optional[str]]:
    provider = provider_command(status)
    if provider is None:
        return ["lsp_status"], None
    command, language = provider
    session = LspSession(command, language, TARGET_ROOT, TIMEOUT_SECONDS)
    try:
        return ["lsp_status", *advertised_operations(session.initialize())], None
    except (OSError, RuntimeError, TimeoutError, json.JSONDecodeError) as exc:
        return ["lsp_status"], str(exc)
    finally:
        session.close()


def tool_schema(name: str) -> dict[str, object]:
    if name == "lsp_status":
        return {"name": name, "description": "Inspect the bounded read-only LSP provider state.", "inputSchema": {"type": "object", "properties": {}}}
    properties: dict[str, object] = {"path": {"type": "string", "description": "Repository-relative source file"}}
    if name in {"definition", "references", "hover"}:
        properties["line"] = {"type": "integer", "minimum": 0}
        properties["character"] = {"type": "integer", "minimum": 0}
    if name == "references":
        properties["includeDeclaration"] = {"type": "boolean", "default": True}
    return {"name": name, "description": f"Read-only LSP {name} operation when advertised by the active provider.", "inputSchema": {"type": "object", "properties": properties, "required": ["path"]}}


def content(value: object) -> dict[str, object]:
    return {"content": [{"type": "text", "text": json.dumps(value, sort_keys=True)}]}


def call_tool(name: str, arguments: dict[str, object], status: dict[str, str], operations: list[str]) -> dict[str, object]:
    if name == "lsp_status":
        return content(status)
    if name == "rename":
        raise ValueError("rename is intentionally unsupported; LazyBuddy exposes read-only LSP operations only")
    if name not in operations:
        raise ValueError(f"operation is unavailable because the active LSP provider did not advertise it: {name}")
    provider = provider_command(status)
    if provider is None:
        raise ValueError(status.get("REASON", "no LSP provider is available"))
    command, language = provider
    path = source_path(TARGET_ROOT, arguments.get("path"))
    session = LspSession(command, language, TARGET_ROOT, TIMEOUT_SECONDS)
    try:
        capabilities = session.initialize()
        if name not in advertised_operations(capabilities):
            raise ValueError(f"operation is unavailable because the active LSP provider did not advertise it: {name}")
        session.open_file(path)
        session.wait_for_document_ready()
        text_document = {"uri": path.as_uri()}
        if name == "definition":
            result = session.request("textDocument/definition", {"textDocument": text_document, "position": position(arguments)})
        elif name == "references":
            result = session.request("textDocument/references", {"textDocument": text_document, "position": position(arguments), "context": {"includeDeclaration": arguments.get("includeDeclaration", True)}})
        elif name == "symbols":
            result = session.request("textDocument/documentSymbol", {"textDocument": text_document})
        elif name == "hover":
            result = session.request("textDocument/hover", {"textDocument": text_document, "position": position(arguments)})
        else:
            result = session.diagnostics()
        return content(result)
    finally:
        session.close()


def handle(request: dict[str, object], notification: bool) -> None:
    request_id = request.get("id", 0)
    method = request.get("method")
    if method == "initialize":
        mcp_result(request_id, {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "lazybuddy-lsp", "version": "0.19.0"}}, notification)
        return
    status = tooling_status()
    operations, bridge_error = bridge_capabilities(status) if status.get("STATE") == "ready" else (["lsp_status"], None)
    if method == "tools/list":
        result: dict[str, object] = {"tools": [tool_schema(name) for name in operations]}
        if bridge_error:
            result["warning"] = f"LSP provider handshake failed without changing the target: {bridge_error}"
        mcp_result(request_id, result, notification)
        return
    if method != "tools/call":
        mcp_error(request_id, -32601, "unsupported method", notification)
        return
    params = request.get("params")
    if not isinstance(params, dict):
        mcp_error(request_id, -32602, "tools/call requires object params", notification)
        return
    name = params.get("name")
    arguments = params.get("arguments", {})
    if not isinstance(name, str) or not isinstance(arguments, dict):
        mcp_error(request_id, -32602, "tools/call requires a tool name and object arguments", notification)
        return
    try:
        mcp_result(request_id, call_tool(name, arguments, status, operations), notification)
    except (OSError, RuntimeError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        mcp_error(request_id, -32602, str(exc), notification)


def main() -> int:
    serve(handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
