#!/usr/bin/env python3
import json
import sys
from pathlib import Path

VERSION = json.loads((Path(__file__).resolve().parent.parent / ".codebuddy-plugin" / "plugin.json").read_text(encoding="utf-8"))["version"]


def respond(request):
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
    method = request.get("method")
    if method == "notifications/initialized":
        return None
    if "id" not in request:
        return None
    response = {"jsonrpc": "2.0", "id": request["id"]}
    if method == "initialize":
        params = request.get("params")
        version = params.get("protocolVersion") if isinstance(params, dict) else None
        response["result"] = {
            "protocolVersion": version if isinstance(version, str) else "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": f"lazybuddy-deferred-{sys.argv[1]}", "version": VERSION},
        }
    elif method == "tools/list":
        response["result"] = {"tools": []}
    elif method == "ping":
        response["result"] = {}
    else:
        response["error"] = {"code": -32601, "message": "Method not found in deferred profile"}
    return response


for line in sys.stdin:
    try:
        output = respond(json.loads(line))
    except (ValueError, TypeError):
        output = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
    if output is not None:
        print(json.dumps(output, separators=(",", ":")), flush=True)
