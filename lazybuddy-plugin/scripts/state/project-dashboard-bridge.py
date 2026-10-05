"""Persistent Buddy project record; original documents and native runs stay separate.

One atomic state file contains the accepted registry and its command receipts.
Document captures are observations, not a transaction over external editors.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: node lazybuddy-plugin/shared/project/cli.mjs init|read|command --project-root PATH --project-id ID --actor ID
from __future__ import annotations

import fcntl
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path


LIMIT = 8 * 1024 * 1024
SOURCE_LIMIT = 1024 * 1024
PLUGIN = Path(__file__).resolve().parents[2]
REDUCER = PLUGIN / "shared/project/cli.mjs"
_spec = importlib.util.spec_from_file_location("project_source_reader", PLUGIN / "shared/dashboard/service-read.py")
_reader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_reader)


class ProjectError(Exception):
    pass


def encoded(value: object) -> bytes:
    result = (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
    if len(result) > LIMIT:
        raise ProjectError("STATE_TOO_LARGE")
    return result


def strict_json(content: bytes) -> object:
    def unique(pairs: list) -> dict:
        result = {}
        for key, value in pairs:
            if key in result or key in ("__proto__", "constructor", "prototype"):
                raise ProjectError("INVALID_JSON")
            result[key] = value
        return result
    try:
        return json.loads(content, object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(ProjectError("INVALID_JSON")))
    except (ValueError, UnicodeError) as error:
        raise ProjectError("INVALID_JSON") from error


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def reduce(node: str, action: str, **values: object) -> object:
    result = subprocess.run([node, str(REDUCER), "--reduce"], input=encoded({"action": action, **values}),
                            capture_output=True, timeout=8, check=False)
    if result.returncode:
        code = result.stderr.decode(errors="replace").strip()
        raise ProjectError(code if re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", code) else "MODEL_REJECTED")
    if len(result.stdout) > LIMIT:
        raise ProjectError("OUTPUT_TOO_LARGE")
    return strict_json(result.stdout)


class ProjectFiles:
    """Pin every directory ancestor and only write within an identified private store."""

    def __init__(self, root: str, project_id: str, create: bool):
        self.root = root
        self.project_id = project_id
        self.stack = ExitStack()
        self.directories: list[tuple[int, str, int]] = []
        self.lock_descriptor: int | None = None
        self.repository_key = "repo:" + hashlib.sha256(root.encode()).hexdigest()
        self.owner = {"schema_version": 1, "owner": "LazyBuddy/project", "project_id": project_id,
                      "repository_key": self.repository_key}
        try:
            if not root.startswith("/") or str(Path(root).resolve()) != root:
                raise ProjectError("UNSAFE_PROJECT_ROOT")
            descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
            self.stack.callback(os.close, descriptor)
            for component in Path(root).parts[1:]:
                descriptor, _ = self.directory(descriptor, component, False)
            self.root_descriptor = descriptor
            native, _ = self.directory(descriptor, ".lazybuddy", create)
            native_metadata = os.fstat(native)
            if native_metadata.st_uid != os.getuid() or native_metadata.st_mode & 0o022:
                raise ProjectError("UNSAFE_PROJECT_STORE")
            self.descriptor, created = self.directory(native, "project", create)
            self.private(os.fstat(self.descriptor), directory=True)
            if created:
                self.install("owner.json", encoded(self.owner), None, replace=False)
            else:
                try:
                    existing_owner = strict_json(self.read("owner.json", 4096))
                except FileNotFoundError as error:
                    raise ProjectError("PROJECT_DIRECTORY_COLLISION") from error
                if existing_owner != self.owner:
                    raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            self.require_current()
        except FileNotFoundError as error:
            self.stack.close()
            raise ProjectError("PROJECT_NOT_INITIALIZED") from error
        except BaseException:
            self.stack.close()
            raise

    def directory(self, parent: int, name: str, create: bool) -> tuple[int, bool]:
        created = False
        try:
            descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        except FileNotFoundError:
            if not create:
                raise
            try:
                os.mkdir(name, 0o700, dir_fd=parent)
                os.fsync(parent)
                created = True
            except FileExistsError:
                pass
            descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        self.stack.callback(os.close, descriptor)
        self.directories.append((parent, name, descriptor))
        self.require_current()
        return descriptor, created

    def require_current(self) -> None:
        for parent, name, descriptor in self.directories:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            bound = os.fstat(descriptor)
            if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (bound.st_dev, bound.st_ino):
                raise ProjectError("PROJECT_DIRECTORY_CHANGED")
        if self.lock_descriptor is not None:
            current = os.stat("lock", dir_fd=self.descriptor, follow_symlinks=False)
            bound = os.fstat(self.lock_descriptor)
            if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (bound.st_dev, bound.st_ino):
                raise ProjectError("PROJECT_LOCK_CHANGED")

    @staticmethod
    def private(metadata: os.stat_result, directory: bool = False) -> None:
        kind = stat.S_ISDIR if directory else stat.S_ISREG
        if not kind(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ProjectError("UNSAFE_PROJECT_STORE")
        if not directory and metadata.st_nlink != 1:
            raise ProjectError("UNSAFE_PROJECT_STORE")

    def read(self, name: str, limit: int = LIMIT) -> bytes:
        self.require_current()
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.descriptor)
        with os.fdopen(descriptor, "rb") as handle:
            before = os.fstat(handle.fileno())
            self.private(before)
            if before.st_size > limit:
                raise ProjectError("STATE_TOO_LARGE")
            content = handle.read(limit + 1)
            after = os.fstat(handle.fileno())
            current = os.stat(name, dir_fd=self.descriptor, follow_symlinks=False)
            if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino) or stat.S_ISLNK(current.st_mode):
                raise ProjectError("PROJECT_FILE_CHANGED")
            if len(content) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ProjectError("PROJECT_FILE_CHANGED")
        self.require_current()
        return content

    def optional(self, name: str) -> bytes | None:
        try:
            return self.read(name)
        except FileNotFoundError:
            return None

    def install(self, name: str, content: bytes, expected: bytes | None, replace: bool = True) -> None:
        """Publish state and its receipt together, after a final content comparison."""
        self.require_current()
        if self.optional(name) != expected:
            raise ProjectError("PROJECT_FILE_CHANGED")
        if not replace:
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.descriptor)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content); handle.flush(); os.fsync(handle.fileno())
            self.require_current()
            os.fsync(self.descriptor)
            return
        temporary = f".{name}.{os.urandom(16).hex()}"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.descriptor)
        bound = os.fstat(descriptor)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content); handle.flush(); os.fsync(handle.fileno())
                bound = os.fstat(handle.fileno())
            self.require_current()
            if self.optional(name) != expected:
                raise ProjectError("PROJECT_FILE_CHANGED")
            present = os.stat(temporary, dir_fd=self.descriptor, follow_symlinks=False)
            if not stat.S_ISREG(present.st_mode) or (present.st_dev, present.st_ino) != (bound.st_dev, bound.st_ino) or present.st_nlink != 1:
                raise ProjectError("PROJECT_FILE_CHANGED")
            os.replace(temporary, name, src_dir_fd=self.descriptor, dst_dir_fd=self.descriptor)
            self.require_current()
            os.fsync(self.descriptor)
        finally:
            try:
                # Only the uniquely named temporary owned by this operation is removable.
                present = os.stat(temporary, dir_fd=self.descriptor, follow_symlinks=False)
                if (present.st_dev, present.st_ino) == (bound.st_dev, bound.st_ino):
                    os.unlink(temporary, dir_fd=self.descriptor)
            except FileNotFoundError:
                pass

    @contextmanager
    def locked(self):
        self.require_current()
        descriptor = os.open("lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=self.descriptor)
        try:
            self.private(os.fstat(descriptor))
            deadline = time.monotonic() + 5
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise ProjectError("PROJECT_BUSY")
                    time.sleep(0.02)
            present = os.stat("lock", dir_fd=self.descriptor, follow_symlinks=False)
            bound = os.fstat(descriptor)
            if (present.st_dev, present.st_ino) != (bound.st_dev, bound.st_ino) or not stat.S_ISREG(present.st_mode):
                raise ProjectError("PROJECT_LOCK_CHANGED")
            self.lock_descriptor = descriptor
            self.require_current()
            yield
            self.require_current()
            present = os.stat("lock", dir_fd=self.descriptor, follow_symlinks=False)
            if (present.st_dev, present.st_ino) != (bound.st_dev, bound.st_ino):
                raise ProjectError("PROJECT_LOCK_CHANGED")
        finally:
            self.lock_descriptor = None
            os.close(descriptor)

    def close(self) -> None:
        self.stack.close()


def source_path(path: object) -> str:
    if not isinstance(path, str) or not path or "\\" in path or "\x00" in path:
        raise ProjectError("UNSAFE_SOURCE_PATH")
    parts = path.split("/")
    folded = [part.casefold() for part in parts]
    if any(part in ("", ".", "..") or ":" in part for part in parts):
        raise ProjectError("UNSAFE_SOURCE_PATH")
    if ".git" in folded or re.fullmatch(r"\.lazy(buddy|trae|qoder|zcode|kimi|deepseek)", folded[0]) and len(folded) > 1 and folded[1] in ("dashboard", "project"):
        raise ProjectError("PROTECTED_SOURCE_PATH")
    if Path(path).suffix.casefold() not in (".md", ".markdown"):
        raise ProjectError("MARKDOWN_SOURCE_REQUIRED")
    return path


def capture_source(files: ProjectFiles, source_id: str, path: str) -> dict:
    reference = source_path(path)
    try:
        content = _reader.read(files.root, reference, SOURCE_LIMIT)
        text = content.decode("utf-8")
    except FileNotFoundError as error:
        raise ProjectError("SOURCE_MISSING") from error
    except (OSError, UnicodeError, ValueError, _reader.UnsafeReferenceError) as error:
        raise ProjectError("SOURCE_UNAVAILABLE") from error
    files.require_current()
    return {"source_id": source_id, "path": reference, "sha256": hashlib.sha256(content).hexdigest(), "content": text}


def source_observations(files: ProjectFiles, state: dict) -> list[dict]:
    observations = []
    for source in state["sources"]:
        observation = {"source_id": source["id"], "path": source["path"], "observed_at": now()}
        try:
            capture = capture_source(files, source["id"], source["path"])
            observation.update(status="available", sha256=capture["sha256"])
        except ProjectError as error:
            observation["status"] = "missing" if str(error) == "SOURCE_MISSING" else "unavailable"
        observations.append(observation)
    return observations


def command_captures(files: ProjectFiles, state: dict, command: dict) -> tuple[list, list]:
    # Replay must remain usable after an accepted source is edited or removed.
    if any(record["command"]["command_id"] == command.get("command_id") for record in state["receipts"]):
        return [], []
    if command.get("expected_revision") != state["revision"] or command.get("project_id") != state["project_id"]:
        return [], []
    operation, payload = command.get("operation"), command.get("payload", {})
    wanted = {}
    if operation == "register_source":
        wanted[payload.get("id")] = payload.get("path")
    else:
        references = [item.get("source", {}) for item in payload.get("items", [])] if operation == "record_baseline_items" else [payload.get("source", {})] if operation == "register_plan" else []
        by_id = {source["id"]: source["path"] for source in state["sources"]}
        for reference in references:
            source_id = reference.get("source_id")
            if source_id in by_id:
                wanted[source_id] = by_id[source_id]
    captures = [capture_source(files, source_id, path) for source_id, path in wanted.items()]
    runs = []
    if operation == "link_native_run":
        run_id = payload.get("run_id")
        if not isinstance(run_id, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", run_id) is None:
            raise ProjectError("INVALID_NATIVE_RUN_ID")
        try:
            native = strict_json(_reader.read(files.root, f".lazybuddy/runs/{run_id}/state.json", LIMIT))
        except (FileNotFoundError, OSError, _reader.UnsafeReferenceError) as error:
            raise ProjectError("NATIVE_RUN_UNAVAILABLE") from error
        if native.get("run_id") != run_id or not native.get("dashboard_project_id"):
            raise ProjectError("NATIVE_RUN_UNBOUND")
        if native["dashboard_project_id"] != payload.get("native_project_id"):
            raise ProjectError("NATIVE_RUN_IDENTITY_MISMATCH")
        runs = [{"runtime": "LazyBuddy", "native_project_id": native["dashboard_project_id"], "run_id": run_id}]
    return captures, runs


def main(arguments: list[str]) -> object:
    if len(arguments) != 9 or arguments[0] not in ("init", "read", "command") or len(set(arguments[1::2])) != 4:
        raise ProjectError("INVALID_ARGUMENTS")
    action = arguments[0]
    options = dict(zip(arguments[1::2], arguments[2::2]))
    if set(options) != {"--project-root", "--project-id", "--actor", "--node"}:
        raise ProjectError("INVALID_ARGUMENTS")
    root, project_id, actor, node = (options[key] for key in ("--project-root", "--project-id", "--actor", "--node"))
    if not actor or len(actor) > 256 or any(ord(character) < 32 for character in actor):
        raise ProjectError("INVALID_ACTOR")
    if not Path(node).is_absolute():
        raise ProjectError("INVALID_NODE_PATH")
    # Validate identity before creating any native directories.
    initial = reduce(node, "create", options={"projectId": project_id, "runtime": "LazyBuddy",
                    "repositoryKey": "repo:" + hashlib.sha256(root.encode()).hexdigest(), "createdAt": now()})
    request = None
    if action == "command":
        content = sys.stdin.buffer.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise ProjectError("INPUT_TOO_LARGE")
        request = strict_json(content)
        if not isinstance(request, dict):
            raise ProjectError("INVALID_COMMAND")
    files = ProjectFiles(root, project_id, action == "init")
    try:
        with files.locked():
            before = files.optional("state.json")
            if before is None:
                if action != "init":
                    raise ProjectError("PROJECT_NOT_INITIALIZED")
                if any(name not in ("owner.json", "lock") and not re.fullmatch(r"\.state\.json\.[a-f0-9]{32}", name) for name in os.listdir(files.descriptor)):
                    raise ProjectError("PROJECT_DIRECTORY_COLLISION")
                files.install("state.json", encoded(initial), None)
                state = initial
            else:
                state = strict_json(before)
            reduce(node, "snapshot", state=state, context={})
            if state["project_id"] != project_id or state["runtime"] != "LazyBuddy" or state["repository_key"] != files.repository_key:
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            receipt = None
            if action == "command":
                captures, runs = command_captures(files, state, request)
                reduction = reduce(node, "command", state=state, command=request,
                                   context={"actor": actor, "occurredAt": now(), "capturedSources": captures, "capturedRuns": runs})
                receipt = reduction["receipt"]
                if reduction["state"] != state:
                    for capture in captures:
                        fresh = capture_source(files, capture["source_id"], capture["path"])
                        if fresh["sha256"] != capture["sha256"]:
                            raise ProjectError("SOURCE_CHANGED_DURING_COMMAND")
                    if runs and command_captures(files, state, request)[1] != runs:
                        raise ProjectError("NATIVE_RUN_CHANGED_DURING_COMMAND")
                    files.install("state.json", encoded(reduction["state"]), before)
                    state = reduction["state"]
            snapshot = reduce(node, "snapshot", state=state,
                              context={"sourceObservations": source_observations(files, state)})
            # A link is identity only. Native execution, consumption and proof stay unobserved here.
            return {"receipt": receipt, "snapshot": snapshot} if action == "command" else snapshot
    finally:
        files.close()


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(encoded(main(sys.argv[1:])))
    except ProjectError as error:
        sys.stderr.write(str(error) + "\n"); sys.exit(65)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, _reader.UnsafeReferenceError):
        sys.stderr.write("UNSAFE_PROJECT_INPUT\n"); sys.exit(65)
    except subprocess.TimeoutExpired:
        sys.stderr.write("MODEL_TIMEOUT\n"); sys.exit(65)
