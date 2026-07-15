#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse


def read_message():
    headers = b""
    while b"\r\n\r\n" not in headers:
        chunk = sys.stdin.buffer.read(1)
        if not chunk:
            return None
        headers += chunk
    length = next(
        int(line.split(b":", 1)[1].strip())
        for line in headers.split(b"\r\n")
        if line.lower().startswith(b"content-length:")
    )
    return json.loads(sys.stdin.buffer.read(length))


def send(message):
    encoded = json.dumps(message, separators=(",", ":")).encode()
    sys.stdout.buffer.write(f"Content-Length: {len(encoded)}\r\n\r\n".encode() + encoded)
    sys.stdout.buffer.flush()


def declaration_uri(params):
    document = params.get("textDocument", {})
    raw_uri = document.get("uri", "") if isinstance(document, dict) else ""
    path = Path(unquote(urlparse(raw_uri).path))
    suffix = ".py" if path.suffix == ".py" else ".ts"
    return path.with_name(f"source{suffix}").as_uri()


def main():
    while message := read_message():
        if "id" not in message:
            continue
        method = message.get("method")
        params = message.get("params", {})
        if method == "initialize":
            result = {"capabilities": {"definitionProvider": True, "referencesProvider": True, "documentSymbolProvider": True, "hoverProvider": True}}
        elif method == "textDocument/definition":
            result = [{"uri": declaration_uri(params), "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}}]
        elif method == "textDocument/references":
            result = []
        elif method == "textDocument/documentSymbol":
            result = []
        elif method == "textDocument/hover":
            result = {"contents": "fixture symbol"}
        else:
            result = []
        send({"jsonrpc": "2.0", "id": message["id"], "result": result})


if __name__ == "__main__":
    main()
