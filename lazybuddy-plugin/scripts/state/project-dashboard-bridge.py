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

import base64
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import time
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path


LIMIT = 8 * 1024 * 1024
SOURCE_LIMIT = 1024 * 1024
REGISTRY_LIMIT = 64 * 1024
REGISTRY_RELATIVE = ".lazyseries/project.json"
JOURNAL_DIRECTORY = "edit-journal"
JOURNAL_LIMIT = 32 * 1024 * 1024
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

    def __init__(self, root: str, project_id: str, create: bool, repository_key: str | None = None,
                 registry_record: dict | None = None):
        self.root = root
        self.project_id = project_id
        self.stack = ExitStack()
        self.directories: list[tuple[int, str, int]] = []
        self.lock_descriptor: int | None = None
        self.repository_key = repository_key if repository_key is not None \
            else "repo:" + hashlib.sha256(root.encode()).hexdigest()
        self.owner = {"schema_version": 1, "owner": "LazyBuddy/project", "project_id": project_id,
                      "repository_key": self.repository_key}
        if registry_record is not None:
            self.owner["registry"] = dict(registry_record)
        self.existing_owner: dict | None = None
        self.existing_owner_bytes: bytes | None = None
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
                    self.existing_owner_bytes = self.read("owner.json", 4096)
                    self.existing_owner = strict_json(self.existing_owner_bytes)
                except FileNotFoundError as error:
                    raise ProjectError("PROJECT_DIRECTORY_COLLISION") from error
                # A previously migrated owner keeps its recorded registry link; adopt it
                # verbatim so repeated opens stay byte-stable, then verify in enforce_identity.
                recorded = self.existing_owner.get("registry") if isinstance(self.existing_owner, dict) else None
                if isinstance(recorded, dict) and recorded.get("path") == REGISTRY_RELATIVE \
                        and self.existing_owner.get("repository_key") == self.repository_key:
                    self.owner = dict(self.owner)
                    self.owner["registry"] = dict(recorded)
            self.require_current()
        except FileNotFoundError as error:
            self.stack.close()
            raise ProjectError("PROJECT_NOT_INITIALIZED") from error
        except BaseException:
            self.stack.close()
            raise

    def enforce_identity(self, registry: dict | None, migrate: bool) -> None:
        """Bind the store to the resolved identity; only explicit init migrates a legacy owner."""
        if self.existing_owner is not None and self.existing_owner != self.owner:
            legacy = {"schema_version": 1, "owner": "LazyBuddy/project", "project_id": self.project_id,
                      "repository_key": "repo:" + hashlib.sha256(self.root.encode()).hexdigest()}
            adoptable = migrate and registry is not None and "registry" in self.owner \
                and self.existing_owner == legacy
            if not adoptable:
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            # Additive migration: the owner records its registry link and the path key it
            # replaces; retained command history in state.json is never rewritten.
            upgraded = dict(self.owner)
            upgraded["registry"] = {**self.owner["registry"], "legacy_repository_key": legacy["repository_key"]}
            self.install("owner.json", encoded(upgraded), self.existing_owner_bytes)
            self.owner = upgraded
        record = self.owner.get("registry")
        if record is not None:
            if not isinstance(record, dict) or record.get("path") != REGISTRY_RELATIVE:
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            if registry is None or registry.get("repository_key") != self.owner["repository_key"] \
                    or registry.get("project_id") != self.project_id:
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
        elif registry is not None:
            # A neutral registry exists, but this store never adopted it; read and command
            # never migrate. Explicit init performs the adoption above.
            raise ProjectError("PROJECT_IDENTITY_MISMATCH")

    def expected_state_key(self) -> str:
        record = self.owner.get("registry")
        if isinstance(record, dict) and record.get("legacy_repository_key") is not None:
            return record["legacy_repository_key"]
        return self.owner["repository_key"]

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

    def journal_directory(self, create: bool) -> int | None:
        """Pinned, symlink-refusing handle on the source-edit journal directory."""
        if getattr(self, "journal_descriptor", None) is not None:
            return self.journal_descriptor
        try:
            descriptor = os.open(JOURNAL_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.descriptor)
        except FileNotFoundError:
            if not create:
                return None
            try:
                os.mkdir(JOURNAL_DIRECTORY, 0o700, dir_fd=self.descriptor)
                os.fsync(self.descriptor)
            except FileExistsError:
                pass
            descriptor = os.open(JOURNAL_DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.descriptor)
        metadata = os.fstat(descriptor)
        if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ProjectError("UNSAFE_PROJECT_STORE")
        self.stack.callback(os.close, descriptor)
        self.directories.append((self.descriptor, JOURNAL_DIRECTORY, descriptor))
        self.journal_descriptor = descriptor
        self.require_current()
        return descriptor

    def journal_names(self) -> list[str]:
        descriptor = self.journal_directory(False)
        if descriptor is None:
            return []
        self.require_current()
        return [name for name in os.listdir(descriptor) if re.fullmatch(r"[a-f0-9]{64}\.json", name)]

    def journal_read(self, name: str) -> dict:
        descriptor = self.journal_directory(False)
        if descriptor is None:
            raise ProjectError("EDIT_JOURNAL_INVALID")
        handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        with os.fdopen(handle, "rb") as stream:
            before = os.fstat(stream.fileno())
            self.private(before)
            if before.st_size > JOURNAL_LIMIT:
                raise ProjectError("EDIT_JOURNAL_INVALID")
            content = stream.read(JOURNAL_LIMIT + 1)
        return strict_json(content)

    def journal_install(self, name: str, content: bytes) -> None:
        descriptor = self.journal_directory(True)
        temporary = f".{name}.{os.urandom(8).hex()}"
        target = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
        with os.fdopen(target, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
        os.fsync(descriptor)
        self.require_current()

    def journal_unlink(self, name: str) -> None:
        descriptor = self.journal_directory(False)
        if descriptor is None:
            return
        try:
            os.unlink(name, dir_fd=descriptor)
        except FileNotFoundError:
            return
        os.fsync(descriptor)
        self.require_current()

    def close(self) -> None:
        self.stack.close()


class RegistryFiles:
    """Pinned, symlink-refusing access to the runtime-neutral `.lazyseries/project.json`.

    The registry holds stable repository identity and a source pointer list. It is
    created only through explicit init/command authority, never by a read.
    """

    def __init__(self, root: str, create: bool):
        self.root = root
        self.stack = ExitStack()
        self.chain: list[tuple[int, str, int]] = []
        self.created_directory = False
        self.written: bytes | None = None
        try:
            if not root.startswith("/") or str(Path(root).resolve()) != root:
                raise ProjectError("UNSAFE_PROJECT_ROOT")
            descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
            self.stack.callback(os.close, descriptor)
            for component in Path(root).parts[1:]:
                descriptor, _ = self.directory(descriptor, component, False)
            parent = descriptor
            descriptor, created = self.directory(parent, ".lazyseries", create)
            self.parent = parent
            self.created_directory = created
            metadata = os.fstat(descriptor)
            if metadata.st_uid != os.getuid() or metadata.st_mode & 0o022:
                raise ProjectError("UNSAFE_REGISTRY")
            self.descriptor = descriptor
            self.require_current()
        except FileNotFoundError as error:
            self.stack.close()
            raise ProjectError("REGISTRY_NOT_PRESENT") from error
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
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            except OSError as error:
                raise ProjectError("UNSAFE_REGISTRY") from error
        except OSError as error:
            raise ProjectError("UNSAFE_REGISTRY") from error
        self.stack.callback(os.close, descriptor)
        self.chain.append((parent, name, descriptor))
        self.require_current()
        return descriptor, created

    def require_current(self) -> None:
        for parent, name, descriptor in self.chain:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            bound = os.fstat(descriptor)
            if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (bound.st_dev, bound.st_ino):
                raise ProjectError("REGISTRY_CHANGED")

    @staticmethod
    def private_file(metadata: os.stat_result) -> None:
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
            raise ProjectError("UNSAFE_REGISTRY")
        if metadata.st_nlink != 1:
            raise ProjectError("UNSAFE_REGISTRY")

    def read_bytes(self) -> bytes | None:
        self.require_current()
        try:
            descriptor = os.open("project.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.descriptor)
        except FileNotFoundError:
            return None
        except OSError as error:
            raise ProjectError("UNSAFE_REGISTRY") from error
        with os.fdopen(descriptor, "rb") as handle:
            before = os.fstat(handle.fileno())
            self.private_file(before)
            if before.st_size > REGISTRY_LIMIT:
                raise ProjectError("REGISTRY_TOO_LARGE")
            content = handle.read(REGISTRY_LIMIT + 1)
            after = os.fstat(handle.fileno())
            current = os.stat("project.json", dir_fd=self.descriptor, follow_symlinks=False)
            if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino) or stat.S_ISLNK(current.st_mode):
                raise ProjectError("REGISTRY_CHANGED")
            if len(content) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ProjectError("REGISTRY_CHANGED")
        self.require_current()
        return content

    def create(self, content: bytes) -> None:
        self.require_current()
        if self.read_bytes() is not None:
            raise ProjectError("REGISTRY_PRESENT")
        descriptor = os.open("project.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.descriptor)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        self.require_current()
        os.fsync(self.descriptor)
        self.written = content

    def update(self, content: bytes, expected: bytes | None) -> None:
        self.require_current()
        if self.read_bytes() != expected:
            raise ProjectError("REGISTRY_CHANGED")
        temporary = f".project.json.{os.urandom(16).hex()}"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.descriptor)
        bound = os.fstat(descriptor)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            self.require_current()
            if self.read_bytes() != expected:
                raise ProjectError("REGISTRY_CHANGED")
            present = os.stat(temporary, dir_fd=self.descriptor, follow_symlinks=False)
            if not stat.S_ISREG(present.st_mode) or (present.st_dev, present.st_ino) != (bound.st_dev, bound.st_ino) or present.st_nlink != 1:
                raise ProjectError("REGISTRY_CHANGED")
            os.replace(temporary, "project.json", src_dir_fd=self.descriptor, dst_dir_fd=self.descriptor)
            self.require_current()
            os.fsync(self.descriptor)
        finally:
            try:
                present = os.stat(temporary, dir_fd=self.descriptor, follow_symlinks=False)
                if (present.st_dev, present.st_ino) == (bound.st_dev, bound.st_ino):
                    os.unlink(temporary, dir_fd=self.descriptor)
            except FileNotFoundError:
                pass

    def rollback_created(self) -> None:
        """Remove only a registry file this invocation created; never touch foreign files."""
        if self.written is None:
            return
        try:
            if self.read_bytes() != self.written:
                return
            os.unlink("project.json", dir_fd=self.descriptor)
            os.fsync(self.descriptor)
            if self.created_directory:
                try:
                    os.rmdir(".lazyseries", dir_fd=self.parent)
                except OSError:
                    pass
        except OSError:
            pass

    def close(self) -> None:
        self.stack.close()


def validated_registry(node: str, document: object) -> dict:
    if not isinstance(document, dict):
        raise ProjectError("INVALID_REGISTRY")
    return reduce(node, "registry", registry=document)


def read_registry_at(node: str, root: str) -> dict | None:
    try:
        files = RegistryFiles(root, False)
    except ProjectError as error:
        if str(error) == "REGISTRY_NOT_PRESENT":
            return None
        raise
    try:
        content = files.read_bytes()
        return None if content is None else validated_registry(node, strict_json(content))
    finally:
        files.close()


def _unquote_path(value: bytes) -> str:
    text_value = value.decode("utf-8", errors="replace")
    if len(text_value) < 2 or not (text_value.startswith('"') and text_value.endswith('"')):
        return text_value
    body = text_value[1:-1]
    escapes = {'"': '"', "\\": "\\", "a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v"}
    result = []
    index = 0
    while index < len(body):
        character = body[index]
        if character == "\\" and index + 1 < len(body):
            following = body[index + 1]
            if following in escapes:
                result.append(escapes[following])
                index += 2
                continue
            match = re.match(r"[0-7]{1,3}", body[index + 1:index + 4])
            if match:
                result.append(chr(int(match.group(0), 8)))
                index += 1 + len(match.group(0))
                continue
        result.append(character)
        index += 1
    return "".join(result)


def worktree_facts(root: str) -> list[dict] | None:
    """Observed `git worktree list --porcelain -z` facts; unavailable stays unavailable."""
    try:
        result = subprocess.run(["git", "-C", root, "worktree", "list", "--porcelain", "-z"],
                                capture_output=True, timeout=5, check=False)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    entries: list[dict] = []
    fields: dict[str, object] | None = None
    # With -z every attribute line is NUL-terminated and records end with an extra NUL.
    for token in result.stdout.split(b"\0"):
        if not token:
            continue
        key, _, value = token.partition(b" ")
        name = key.decode("ascii", errors="replace")
        if name == "worktree":
            if fields is not None:
                entries.append(fields)
            fields = {"root": _unquote_path(value), "head": None, "branch": None,
                      "detached": False, "bare": False}
        elif fields is None:
            continue
        elif name == "HEAD":
            fields["head"] = _unquote_path(value)
        elif name == "branch":
            fields["branch"] = _unquote_path(value)
        elif name in ("detached", "bare"):
            fields[name] = True
    if fields is not None:
        entries.append(fields)
    return entries or None


def resolve_registry(node: str, root: str, facts: list[dict] | None) -> tuple[dict | None, str | None, str | None]:
    """Resolve the neutral registry at the invocation root, then at the main worktree root."""
    own = read_registry_at(node, root)
    main_root = None
    if facts:
        roots = [entry["root"] for entry in facts]
        if root in roots and roots.index(root) > 0:
            main_root = roots[0]
    main_registry = read_registry_at(node, main_root) if main_root and main_root != root else None
    if own is not None and main_registry is not None:
        if any(own.get(field) != main_registry.get(field) for field in ("project_id", "repository_key")):
            raise ProjectError("REGISTRY_CONFLICT")
    if own is not None:
        return own, root, main_root
    if main_registry is not None:
        return main_registry, main_root, main_root
    return None, None, main_root


def sync_registry_sources(node: str, root: str, registry: dict, state: dict) -> dict:
    """Mirror registered source ids/roles/paths into the neutral registry (registry-root authority only)."""
    if registry.get("runtime") != "LazyBuddy":
        # The registry names another owning runtime; mirroring this store's
        # sources would flap the shared pointer list between runtimes.
        raise ProjectError("REGISTRY_FOREIGN_RUNTIME")
    mirror = [{"id": source["id"], "role": source["role"], "path": source["path"]} for source in state["sources"]]
    if registry.get("sources") == mirror:
        return registry
    updated = dict(registry)
    updated["sources"] = mirror
    validated_registry(node, updated)
    payload = encoded(updated)
    if len(payload) > REGISTRY_LIMIT:
        raise ProjectError("REGISTRY_TOO_LARGE")
    handle = RegistryFiles(root, False)
    try:
        handle.update(payload, encoded(registry))
    finally:
        handle.close()
    return updated


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


def write_source(root: str, relative: object, content: bytes, from_sha256: str) -> None:
    """Publish a reducer-authored source write atomically under a digest CAS.

    The current bytes must still hash to `from_sha256`; any concurrent external
    edit aborts the write instead of being overwritten.
    """
    reference = source_path(relative)
    current = _reader.read(root, reference, SOURCE_LIMIT)
    if hashlib.sha256(current).hexdigest() != from_sha256:
        raise ProjectError("SOURCE_CHANGED_DURING_COMMAND")
    parts = reference.split("/")
    temporary = f".{parts[-1]}.{os.urandom(16).hex()}.lazybuddy-edit"
    with ExitStack() as stack:
        descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
        stack.callback(os.close, descriptor)
        for component in [*Path(root).parts[1:], *parts[:-1]]:
            descriptor = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            stack.callback(os.close, descriptor)
        present = os.stat(parts[-1], dir_fd=descriptor, follow_symlinks=False)
        if not stat.S_ISREG(present.st_mode):
            raise ProjectError("SOURCE_UNAVAILABLE")
        try:
            handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            with os.fdopen(handle, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, present.st_mode & 0o777, dir_fd=descriptor, follow_symlinks=False)
            os.replace(temporary, parts[-1], src_dir_fd=descriptor, dst_dir_fd=descriptor)
            os.fsync(descriptor)
        finally:
            try:
                os.unlink(temporary, dir_fd=descriptor)
            except FileNotFoundError:
                pass


def journal_entry(command_id: str, writes: list, prior_state: bytes, next_state: bytes) -> dict:
    return {
        "schema_version": 1,
        "command_id": command_id,
        "created_at": now(),
        "prior_state_sha256": hashlib.sha256(prior_state).hexdigest(),
        "next_state_b64": base64.b64encode(next_state).decode("ascii"),
        "writes": [{
            "path": write.get("path"),
            "from_sha256": write.get("from_sha256"),
            "to_sha256": write.get("to_sha256"),
            "content_b64": base64.b64encode(str(write.get("content", "")).encode("utf-8")).decode("ascii"),
        } for write in writes],
    }


def journal_name(command_id: object) -> str:
    if not isinstance(command_id, str):
        raise ProjectError("INVALID_COMMAND")
    return hashlib.sha256(command_id.encode("utf-8")).hexdigest() + ".json"


def recover_edit_journal(files: ProjectFiles) -> bool:
    """Complete or abandon interrupted source edits. Never overwrite a newer external edit.

    A pending entry whose receipt is already published is just unlinked. For a
    pending entry, each write is compared against the live file: matching
    `to_sha256` means the write landed, matching `from_sha256` means it never
    did, anything else is a newer external edit that must survive untouched.
    """
    recovered = False
    entries = sorted(
        ((name, files.journal_read(name)) for name in files.journal_names()),
        key=lambda item: str(item[1].get("created_at", "")),
    )
    for name, entry in entries:
        if not isinstance(entry, dict) or entry.get("schema_version") != 1 or not isinstance(entry.get("writes"), list):
            raise ProjectError("EDIT_JOURNAL_INVALID")
        state_bytes = files.optional("state.json")
        if state_bytes is None:
            raise ProjectError("PROJECT_NOT_INITIALIZED")
        state = strict_json(state_bytes)
        command_id = entry.get("command_id")
        if any(record["command"]["command_id"] == command_id for record in state.get("receipts", [])):
            files.journal_unlink(name)
            continue
        statuses = []
        for write in entry["writes"]:
            try:
                live = _reader.read(files.root, write.get("path"), SOURCE_LIMIT)
            except (OSError, ValueError, _reader.UnsafeReferenceError):
                live = None
            digest = hashlib.sha256(live).hexdigest() if live is not None else None
            if digest == write.get("to_sha256"):
                statuses.append("landed")
            elif digest == write.get("from_sha256"):
                statuses.append("pending")
            else:
                statuses.append("foreign")
                break
        if "foreign" in statuses:
            files.journal_unlink(name)
            continue
        for write, status in zip(entry["writes"], statuses):
            if status == "pending":
                write_source(files.root, write.get("path"), base64.b64decode(write.get("content_b64", "")),
                             write.get("from_sha256"))
        if hashlib.sha256(state_bytes).hexdigest() != entry.get("prior_state_sha256"):
            raise ProjectError("PROJECT_FILE_CHANGED")
        files.install("state.json", base64.b64decode(entry.get("next_state_b64", "")), state_bytes)
        files.journal_unlink(name)
        recovered = True
    return recovered


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


def git_head(root: str) -> str | None:
    try:
        result = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "HEAD"],
                                capture_output=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode or len(result.stdout) > 1024:
        return None
    head = result.stdout.decode(errors="replace").strip()
    return head if re.fullmatch(r"[a-f0-9]{40,64}", head) else None


def read_json_record(root: str, relative: object) -> dict | None:
    if not isinstance(relative, str) or not relative or relative.startswith("/") or ".." in relative.split("/"):
        return None
    try:
        value = strict_json(_reader.read(root, relative, LIMIT))
    except (FileNotFoundError, OSError, ValueError, ProjectError, _reader.UnsafeReferenceError):
        return None
    return value if isinstance(value, dict) else None


def criterion_satisfied(files: ProjectFiles, authority: dict, criterion: dict) -> bool:
    # The same binding the dashboard's completion chain enforces: a finished
    # criterion, an evidence receipt pinned to the authority's revision with a
    # zero exit, and an approved review whose verifier is the receipt's
    # verifier and never its executor (worker != verifier).
    if criterion.get("status") != "complete":
        return False
    for key in ("task_id", "criterion_id", "evidence_path", "review_path"):
        if not isinstance(criterion.get(key), str) or not criterion[key]:
            return False
    evidence = read_json_record(files.root, criterion["evidence_path"])
    review = read_json_record(files.root, criterion["review_path"])
    if evidence is None or review is None:
        return False
    if evidence.get("schema_version") != "lazyseries.completion-evidence.v1":
        return False
    if evidence.get("repo_head") != authority.get("repo_head") or evidence.get("exit_code") != 0:
        return False
    if (evidence.get("run_id") != authority.get("run_id")
            or evidence.get("task_id") != criterion["task_id"]
            or evidence.get("criterion_id") != criterion["criterion_id"]):
        return False
    executor, verifier, review_verifier = evidence.get("executor"), evidence.get("verifier"), review.get("verifier")
    for identity in (executor, verifier, review_verifier):
        if not isinstance(identity, dict) or not isinstance(identity.get("identity"), str) or not identity["identity"]:
            return False
    if verifier["identity"] != review_verifier["identity"] or executor["identity"] == verifier["identity"]:
        return False
    return review.get("verdict") == "approved"


def package_version() -> str | None:
    try:
        value = strict_json((PLUGIN / "tooling" / "package.json").read_bytes())
    except (OSError, ValueError, ProjectError):
        return None
    version = value.get("version") if isinstance(value, dict) else None
    return version if isinstance(version, str) and version else None


def completion_authority(files: ProjectFiles, run: dict, head: str | None) -> dict | None:
    """Mirror the dashboard's completion-authority binding (current revision,
    applicable finished criteria, worker != verifier) or offer nothing."""
    authority = read_json_record(files.root, f".lazybuddy/runs/{run['run_id']}/completion-authority.json")
    if authority is None or authority.get("schema_version") != "lazyseries.completion-authority.v1":
        return None
    if authority.get("run_id") != run["run_id"]:
        return None
    if not isinstance(authority.get("repo_head"), str) or head is None or authority["repo_head"] != head:
        return None
    version = package_version()
    if version is not None and authority.get("package_version") != version:
        return None
    plan = authority.get("plan")
    if not isinstance(plan, dict) or not isinstance(plan.get("path"), str) or not isinstance(plan.get("sha256"), str):
        return None
    criteria = authority.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        return None
    applicable = [entry for entry in criteria if isinstance(entry, dict) and entry.get("applicable") is True]
    if not applicable or not all(criterion_satisfied(files, authority, entry) for entry in applicable):
        return None
    return {"runtime": "LazyBuddy", "native_project_id": run["native_project_id"],
            "run_id": run["run_id"], "repo_head": authority["repo_head"]}


def command_captures(files: ProjectFiles, state: dict, command: dict) -> tuple[list, list, list]:
    # Replay must remain usable after an accepted source is edited or removed.
    if any(record["command"]["command_id"] == command.get("command_id") for record in state["receipts"]):
        return [], [], []
    if command.get("expected_revision") != state["revision"] or command.get("project_id") != state["project_id"]:
        return [], [], []
    operation, payload = command.get("operation"), command.get("payload", {})
    if operation in ("project.change.preview", "project.change.apply"):
        # The capability wrappers carry the same source references as the
        # content operation they wrap; captures follow the inner change.
        change = payload.get("change", {})
        operation, payload = change.get("operation"), change.get("payload", {})
    wanted = {}
    if operation == "register_source":
        wanted[payload.get("id")] = payload.get("path")
    elif operation in ("source.edit", "source.edit.preview", "source.map", "source.adopt"):
        by_id = {source["id"]: source["path"] for source in state["sources"]}
        if payload.get("source_id") not in by_id:
            raise ProjectError("UNKNOWN_SOURCE")
        wanted[payload.get("source_id")] = by_id[payload.get("source_id")]
    elif operation == "amend_baseline":
        # The amendment's source edit and re-recorded items are captured before
        # the reducer runs; its own write lands inside the journaled transaction.
        by_id = {source["id"]: source["path"] for source in state["sources"]}
        amendment = payload.get("source", {})
        if amendment.get("source_id") not in by_id:
            raise ProjectError("UNKNOWN_SOURCE")
        wanted[amendment.get("source_id")] = by_id[amendment.get("source_id")]
        for item in payload.get("items", []):
            source_id = item.get("source", {}).get("source_id")
            if source_id in by_id:
                wanted[source_id] = by_id[source_id]
    else:
        references = [item.get("source", {}) for item in payload.get("items", [])] if operation == "record_baseline_items" else [payload.get("source", {})] if operation in ("register_plan", "plan.create", "plan.edit") else []
        by_id = {source["id"]: source["path"] for source in state["sources"]}
        for reference in references:
            source_id = reference.get("source_id")
            if source_id in by_id:
                wanted[source_id] = by_id[source_id]
    captures = [capture_source(files, source_id, path) for source_id, path in wanted.items()]
    runs = []
    authorities = []
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
        # A link accepts only a run the native producer actually created: the
        # create-run.sh shape (schema 2 with its dispatchable status block)
        # plus its journaled event log. A hand-written identity file is not a
        # run, so a two-field state.json refuses typed.
        for field in ("schema_version", "status", "objective", "created_at", "updated_at", "plan_reference", "review_status"):
            if not isinstance(native.get(field), str):
                raise ProjectError("NATIVE_RUN_MALFORMED")
        if native["schema_version"] != "2":
            raise ProjectError("NATIVE_RUN_MALFORMED")
        for field in ("tasks", "verification_gates", "session_ids", "runtime_fingerprints", "progress", "iteration"):
            if not isinstance(native.get(field), (list, dict)):
                raise ProjectError("NATIVE_RUN_MALFORMED")
        try:
            journal = _reader.read(files.root, f".lazybuddy/runs/{run_id}/events.jsonl", LIMIT)
        except (FileNotFoundError, OSError, _reader.UnsafeReferenceError) as error:
            raise ProjectError("NATIVE_RUN_JOURNAL_MISSING") from error
        if not journal.strip():
            raise ProjectError("NATIVE_RUN_JOURNAL_MISSING")
        runs = [{"runtime": "LazyBuddy", "native_project_id": native["dashboard_project_id"], "run_id": run_id}]
    elif operation == "plan.transition" and payload.get("to_lifecycle") == "completed":
        # The model gates `completed` on a captured completion authority; only
        # records satisfying the dashboard's own binding are offered.
        plan = next((entry for entry in state["plans"] if entry["id"] == payload.get("plan_id")), None)
        if plan is None:
            raise ProjectError("UNKNOWN_PLAN")
        head = git_head(files.root)
        for run in plan["native_runs"]:
            record = completion_authority(files, run, head)
            if record is not None:
                authorities.append(record)
    return captures, runs, authorities


def main(arguments: list[str]) -> object:
    if len(arguments) != 9 or arguments[0] not in ("init", "read", "source", "command") or len(set(arguments[1::2])) != 4:
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
    if not root.startswith("/") or str(Path(root).resolve()) != root:
        raise ProjectError("UNSAFE_PROJECT_ROOT")
    request = None
    if action in ("command", "source"):
        content = sys.stdin.buffer.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise ProjectError("INPUT_TOO_LARGE")
        request = strict_json(content)
        if not isinstance(request, dict):
            raise ProjectError("INVALID_COMMAND" if action == "command" else "INVALID_SOURCE_REQUEST")
        if action == "source" and (set(request) != {"source_id"}
                                   or not isinstance(request.get("source_id"), str)
                                   or not request["source_id"] or len(request["source_id"]) > 256):
            raise ProjectError("INVALID_SOURCE_REQUEST")
    facts = worktree_facts(root)
    registry, registry_root, main_root = resolve_registry(node, root, facts)
    if registry is not None and registry["project_id"] != project_id:
        raise ProjectError("PROJECT_IDENTITY_MISMATCH")
    if action == "init" and registry is not None and registry.get("runtime") != "LazyBuddy":
        # A registry another runtime owns is never adopted: init fails closed
        # instead of creating a second owner that flaps the shared sources.
        raise ProjectError("REGISTRY_FOREIGN_RUNTIME")
    effective_key = registry["repository_key"] if registry is not None \
        else "repo:" + hashlib.sha256(root.encode()).hexdigest()
    registry_files: RegistryFiles | None = None
    registry_created = False
    files: ProjectFiles | None = None
    try:
        if action == "init" and registry is None:
            # The registry's canonical home is the main worktree root so linked worktrees
            # share one repository identity. Creation is explicit init authority only.
            target = main_root if main_root is not None else root
            registry_files = RegistryFiles(target, True)
            existing = registry_files.read_bytes()
            if existing is not None:
                registry = validated_registry(node, strict_json(existing))
                registry_root = target
            else:
                candidate = {"schema_version": 1, "project_id": project_id,
                             "repository_key": "repo:" + secrets.token_hex(32),
                             "runtime": "LazyBuddy", "created_at": now(), "sources": []}
                validated_registry(node, candidate)
                payload = encoded(candidate)
                if len(payload) > REGISTRY_LIMIT:
                    raise ProjectError("REGISTRY_TOO_LARGE")
                try:
                    registry_files.create(payload)
                except FileExistsError:
                    registry = validated_registry(node, strict_json(registry_files.read_bytes()))
                    registry_root = target
                else:
                    registry_created = True
                    registry, registry_root = candidate, target
            if registry["project_id"] != project_id:
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            if registry.get("runtime") != "LazyBuddy":
                # Another runtime created the registry first; never adopt it.
                raise ProjectError("REGISTRY_FOREIGN_RUNTIME")
            effective_key = registry["repository_key"]
        # Validate identity before creating any native directories.
        initial = reduce(node, "create", options={"projectId": project_id, "runtime": "LazyBuddy",
                        "repositoryKey": effective_key, "createdAt": now()})
        record = {"path": REGISTRY_RELATIVE} if registry is not None else None
        files = ProjectFiles(root, project_id, action == "init", effective_key, record)
        with files.locked():
            files.enforce_identity(registry, action == "init")
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
            state_changed = action == "init"
            if before is not None and recover_edit_journal(files):
                # Finish an interrupted source edit before serving this action.
                before = files.optional("state.json")
                state = strict_json(before)
                state_changed = True
            reduce(node, "snapshot", state=state, context={})
            if state["project_id"] != project_id or state["runtime"] != "LazyBuddy" \
                    or state["repository_key"] != files.expected_state_key():
                raise ProjectError("PROJECT_IDENTITY_MISMATCH")
            receipt = None
            query_result = None
            if action == "command":
                captures, runs, authorities = command_captures(files, state, request)
                reduction = reduce(node, "command", state=state, command=request,
                                   context={"actor": actor, "occurredAt": now(), "capturedSources": captures,
                                            "capturedRuns": runs, "completionAuthorities": authorities})
                if "state" not in reduction:
                    # Revision-checked query operations never mutate accepted state.
                    query_result = reduction
                else:
                    receipt = reduction["receipt"]
                    writes = reduction.get("writes") or []
                    if reduction["state"] != state:
                        for capture in captures:
                            fresh = capture_source(files, capture["source_id"], capture["path"])
                            if fresh["sha256"] != capture["sha256"]:
                                raise ProjectError("SOURCE_CHANGED_DURING_COMMAND")
                        if runs and command_captures(files, state, request)[1] != runs:
                            raise ProjectError("NATIVE_RUN_CHANGED_DURING_COMMAND")
                        if authorities and command_captures(files, state, request)[2] != authorities:
                            raise ProjectError("COMPLETION_AUTHORITY_CHANGED_DURING_COMMAND")
                        if writes:
                            # Journal the intent first: crash recovery distinguishes
                            # this service's own writes from any external editor.
                            entry_name = journal_name(request.get("command_id"))
                            files.journal_install(entry_name, encoded(
                                journal_entry(request.get("command_id"), writes, before, encoded(reduction["state"]))))
                            for write in writes:
                                write_source(root, write["path"], str(write.get("content", "")).encode("utf-8"),
                                             write["from_sha256"])
                        files.install("state.json", encoded(reduction["state"]), before)
                        if writes:
                            files.journal_unlink(entry_name)
                        state = reduction["state"]
                        state_changed = True
            if action == "source":
                source = next((entry for entry in state["sources"] if entry["id"] == request["source_id"]), None)
                if source is None:
                    raise ProjectError("UNKNOWN_SOURCE")
                return capture_source(files, source["id"], source["path"])
            if registry is not None and registry_root == root and state_changed:
                registry = sync_registry_sources(node, root, registry, state)
            context = {"sourceObservations": source_observations(files, state)}
            owner_record = files.owner.get("registry")
            if owner_record is not None:
                identity = {"repository_key": files.owner["repository_key"], "basis": "registry"}
                if owner_record.get("legacy_repository_key") is not None:
                    identity["legacy_repository_key"] = owner_record["legacy_repository_key"]
                context["identity"] = identity
            if facts is not None:
                roots = [entry["root"] for entry in facts]
                if root in roots:
                    context["worktreeObservations"] = [{**entry, "kind": "main" if index == 0 else "linked",
                                                        "current": entry["root"] == root}
                                                       for index, entry in enumerate(facts)]
            snapshot = reduce(node, "snapshot", state=state, context=context)
            # A link is identity only. Native execution, consumption and proof stay unobserved here.
            if action != "command":
                return snapshot
            outcome = {"receipt": receipt, "snapshot": snapshot}
            if query_result is not None:
                outcome["result"] = query_result
            return outcome
    except BaseException:
        if registry_created:
            # Roll back a registry this invocation created unless the native store has
            # already durably bound to it; foreign files are never touched.
            bound = False
            try:
                owner = json.loads((Path(root) / ".lazybuddy" / "project" / "owner.json").read_bytes())
                bound = isinstance(owner, dict) and owner.get("repository_key") == effective_key \
                    and owner.get("project_id") == project_id
            except (OSError, ValueError):
                bound = False
            if not bound and registry_files is not None:
                registry_files.rollback_created()
        raise
    finally:
        if files is not None:
            files.close()
        if registry_files is not None:
            registry_files.close()


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(encoded(main(sys.argv[1:])))
    except ProjectError as error:
        sys.stderr.write(str(error) + "\n"); sys.exit(65)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, _reader.UnsafeReferenceError):
        sys.stderr.write("UNSAFE_PROJECT_INPUT\n"); sys.exit(65)
    except subprocess.TimeoutExpired:
        sys.stderr.write("MODEL_TIMEOUT\n"); sys.exit(65)
