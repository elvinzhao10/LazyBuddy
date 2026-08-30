import json
import os
import select
import subprocess
import time
from pathlib import Path
from typing import Optional

SEMANTIC_METHODS = frozenset({
    "textDocument/definition",
    "textDocument/references",
    "textDocument/documentSymbol",
    "textDocument/hover",
    "textDocument/diagnostic",
})


def provider_environment(command: str) -> dict[str, str]:
    environment = os.environ.copy()
    for directory in (Path(command).parent, *Path(command).parent.parents):
        runtime_root = directory / ".lazybuddy-lsp-npm-runtime"
        if all((runtime_root / name).is_dir() and not (runtime_root / name).is_symlink() for name in ("home", "cache", "config", "tmp")):
            break
    else:
        return environment
    for name in tuple(environment):
        if name.lower().startswith("npm_config_"):
            environment.pop(name)
    environment.update({
        "HOME": str(runtime_root / "home"),
        "XDG_CONFIG_HOME": str(runtime_root / "config"),
        "XDG_CACHE_HOME": str(runtime_root / "cache"),
        "TMPDIR": str(runtime_root / "tmp"),
        "NODE_COMPILE_CACHE": str(runtime_root / "cache" / "node-compile-cache"),
        "PYTHONPYCACHEPREFIX": str(runtime_root / "cache" / "python"),
        "npm_config_cache": str(runtime_root / "cache"),
        "npm_config_userconfig": str(runtime_root / "config" / "npmrc"),
        "npm_config_update_notifier": "false",
        "NO_UPDATE_NOTIFIER": "1",
    })
    return environment


def source_path(target_root: Path, raw_path: object) -> Path:
    if not isinstance(raw_path, str) or not raw_path:
        raise ValueError("path must be a non-empty repository-relative string")
    candidate = (target_root / raw_path).resolve()
    try:
        candidate.relative_to(target_root)
    except ValueError as exc:
        raise ValueError("path is outside project root") from exc
    if not candidate.is_file():
        raise ValueError(f"file not found: {raw_path}")
    return candidate


def position(arguments: dict[str, object]) -> dict[str, int]:
    line = arguments.get("line")
    character = arguments.get("character")
    if not isinstance(line, int) or line < 0 or not isinstance(character, int) or character < 0:
        raise ValueError("line and character must be non-negative integers")
    return {"line": line, "character": character}


class LspSession:
    def __init__(self, command: str, language: str, target_root: Path, timeout_seconds: float):
        invocation = [command, "--stdio"]
        environment = provider_environment(command)
        if language == "typescript":
            module_root = str(Path(command).parent.parent)
            existing_node_path = environment.get("NODE_PATH", "")
            environment["NODE_PATH"] = module_root if not existing_node_path else f"{module_root}{os.pathsep}{existing_node_path}"
        self._process = subprocess.Popen(
            invocation,
            cwd=target_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        self._language = language
        self._target_root = target_root
        self._timeout_seconds = timeout_seconds
        self._request_id = 1
        self._diagnostics: list[dict[str, object]] = []
        self._document_open_pending = False

    def close(self) -> None:
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=2)

    def _write(self, message: dict[str, object]) -> None:
        if self._process.stdin is None:
            raise RuntimeError("LSP stdin is unavailable")
        encoded = json.dumps(message, separators=(",", ":")).encode()
        self._process.stdin.write(f"Content-Length: {len(encoded)}\r\n\r\n".encode() + encoded)
        self._process.stdin.flush()

    def _read_bytes(self, count: int, deadline: float) -> bytes:
        if self._process.stdout is None:
            raise RuntimeError("LSP stdout is unavailable")
        descriptor = self._process.stdout.fileno()
        chunks: list[bytes] = []
        remaining = count
        while remaining:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                raise TimeoutError("LSP response exceeded bounded timeout")
            readable, _, _ = select.select([descriptor], [], [], timeout)
            if not readable:
                raise TimeoutError("LSP response exceeded bounded timeout")
            data = os.read(descriptor, remaining)
            if not data:
                raise RuntimeError("LSP provider closed stdout")
            chunks.append(data)
            remaining -= len(data)
        return b"".join(chunks)

    def _read_message(self, deadline: Optional[float] = None) -> dict[str, object]:
        if deadline is None:
            deadline = time.monotonic() + self._timeout_seconds
        headers = bytearray()
        while b"\r\n\r\n" not in headers:
            headers.extend(self._read_bytes(1, deadline))
            if len(headers) > 16384:
                raise RuntimeError("LSP response headers exceed limit")
        length: Optional[int] = None
        for line in bytes(headers).decode("ascii", errors="strict").split("\r\n"):
            key, separator, value = line.partition(":")
            if separator and key.lower() == "content-length":
                try:
                    length = int(value.strip())
                except ValueError as exc:
                    raise RuntimeError("LSP response has invalid Content-Length") from exc
        if length is None or length < 0 or length > 4_000_000:
            raise RuntimeError("LSP response has unsafe Content-Length")
        decoded = json.loads(self._read_bytes(length, deadline))
        if not isinstance(decoded, dict):
            raise RuntimeError("LSP response is not an object")
        return decoded

    def _capture_notification(self, message: dict[str, object]) -> None:
        if message.get("method") == "textDocument/publishDiagnostics":
            params = message.get("params")
            if isinstance(params, dict):
                self._diagnostics.append(params)

    def request(self, method: str, params: dict[str, object]) -> object:
        if method in SEMANTIC_METHODS:
            self.wait_for_document_ready()
        definition_retry_deadline = time.monotonic() + min(self._timeout_seconds, 2) if method == "textDocument/definition" else None
        while True:
            request_id = self._request_id
            self._request_id += 1
            self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            while True:
                message = self._read_message()
                if message.get("id") == request_id:
                    error = message.get("error")
                    if isinstance(error, dict):
                        raise RuntimeError(str(error.get("message", "LSP request failed")))
                    result = message.get("result")
                    if method != "textDocument/definition" or (result is not None and result != []):
                        return result
                    if definition_retry_deadline is None or time.monotonic() >= definition_retry_deadline:
                        return result
                    time.sleep(0.05)
                    break
                self._capture_notification(message)

    def notify(self, method: str, params: dict[str, object]) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def initialize(self) -> dict[str, object]:
        result = self.request(
            "initialize",
            {
                "processId": os.getpid(),
                "rootUri": self._target_root.as_uri(),
                "workspaceFolders": [{"uri": self._target_root.as_uri(), "name": self._target_root.name}],
                "capabilities": {"textDocument": {"definition": {"dynamicRegistration": False}, "references": {"dynamicRegistration": False}, "documentSymbol": {"dynamicRegistration": False}, "hover": {"dynamicRegistration": False}, "publishDiagnostics": {"relatedInformation": True}}},
            },
        )
        if not isinstance(result, dict):
            raise RuntimeError("LSP initialize returned no capabilities")
        self.notify("initialized", {})
        capabilities = result.get("capabilities")
        if not isinstance(capabilities, dict):
            raise RuntimeError("LSP initialize returned malformed capabilities")
        return capabilities

    def open_file(self, path: Path) -> None:
        language_id = "typescript" if self._language == "typescript" else "python"
        self.notify("textDocument/didOpen", {"textDocument": {"uri": path.as_uri(), "languageId": language_id, "version": 1, "text": path.read_text(encoding="utf-8")}})
        self._document_open_pending = True

    def wait_for_document_ready(self) -> None:
        if not self._document_open_pending:
            return
        deadline = time.monotonic() + min(self._timeout_seconds, 0.5)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._document_open_pending = False
                return
            time.sleep(min(0.05, remaining))

    def diagnostics(self) -> list[dict[str, object]]:
        self.wait_for_document_ready()
        deadline = time.monotonic() + min(self._timeout_seconds, 2)
        while time.monotonic() < deadline:
            try:
                self._capture_notification(self._read_message(deadline))
            except TimeoutError:
                break
        return self._diagnostics
