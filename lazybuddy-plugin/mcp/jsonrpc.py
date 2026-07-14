import json
import math
import sys


def _error(code, message, request_id=None):
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}, separators=(",", ":")), flush=True)


def _valid_id(value):
    if value is None or isinstance(value, str):
        return True
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and math.isfinite(value))


def serve(handler):
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            _error(-32700, "Parse error")
            continue
        if (
            not isinstance(request, dict)
            or request.get("jsonrpc") != "2.0"
            or not isinstance(request.get("method"), str)
            or request["method"].startswith("rpc.")
            or ("id" in request and not _valid_id(request["id"]))
        ):
            _error(-32600, "Invalid Request")
            continue
        if request["method"] == "tools/call":
            params = request.get("params")
            if (
                not isinstance(params, dict)
                or not isinstance(params.get("name"), str)
                or not isinstance(params.get("arguments", {}), dict)
            ):
                if "id" in request:
                    _error(-32602, "tools/call requires object params with string name and object arguments", request["id"])
                continue
        handler(request, "id" not in request)
