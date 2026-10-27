"""Bounded filesystem inputs and immutable history for dashboard transactions."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by dashboard-bridge.py with the packaged Python runtime.
from __future__ import annotations

import json
import os
import re
import stat
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from state_transaction import MISSING, TransactionError, Write, checked_target, sha256_bytes

Json: TypeAlias = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
LIMIT = 8 * 1024 * 1024


def encoded(value: Json) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def safe_path(root: Path, relative: str) -> Path:
    """Reject traversal and every symlink component, including broken links."""
    if not relative or "\\" in relative or any(part in ("", ".", "..") for part in relative.split("/")):
        raise TransactionError("unsafe dashboard path")
    return checked_target(root, relative)


def bounded_read(root: Path, relative: str, single_link: bool = False) -> bytes:
    safe_path(root, relative)
    with ExitStack() as stack:
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        stack.callback(os.close, directory)
        parts = Path(relative).parts
        for part in parts[:-1]:
            directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            stack.callback(os.close, directory)
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        handle = stack.enter_context(os.fdopen(descriptor, "rb"))
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode):
            raise TransactionError("dashboard input is not a regular file")
        if single_link and metadata.st_nlink != 1:
            raise TransactionError("EVIDENCE_HARDLINK")
        content = handle.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise TransactionError("dashboard input too large")
        return content


@dataclass(frozen=True, slots=True)
class Binding:
    root: Path
    run: Path
    project_id: str
    run_id: str
    actor: str
    node: str

    @classmethod
    def parse(cls, arguments: list[str]) -> Binding:
        if len(arguments) != 10 or len(set(arguments[::2])) != 5:
            raise TransactionError("invalid bridge arguments")
        options = dict(zip(arguments[::2], arguments[1::2]))
        if set(options) != {"--project-root", "--project-id", "--run-id", "--actor", "--node"}:
            raise TransactionError("invalid bridge arguments")
        root = Path(options["--project-root"]).absolute()
        if not root.is_dir() or root.is_symlink() or root.resolve() != root:
            raise TransactionError("unsafe project root")
        run_id = options["--run-id"]
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", run_id) is None:
            raise TransactionError("invalid run id")
        run = root / ".lazybuddy" / "runs" / run_id
        for component in [root / ".lazybuddy", run.parent, run]:
            if component.is_symlink() or not component.is_dir():
                raise TransactionError("unsafe run boundary")
        if not options["--actor"] or len(options["--actor"]) > 256:
            raise TransactionError("trusted actor required")
        return cls(root, run, options["--project-id"], run_id, options["--actor"], options["--node"])


class Files:
    """Capture immutable input bytes so every installed file uses content CAS."""

    def __init__(self, binding: Binding) -> None:
        self.binding = binding
        self.before: dict[str, bytes | None] = {}

    def read(self, relative: str) -> bytes:
        path = safe_path(self.binding.run, relative)
        if path.exists() and path.stat().st_size > LIMIT:
            raise TransactionError("dashboard input too large")
        content = bounded_read(self.binding.run, relative) if path.exists() else None
        self.before[relative] = content
        return content or b""

    def write(self, relative: str, content: bytes) -> Write:
        if relative not in self.before:
            self.read(relative)
        before = self.before[relative]
        return Write(relative, content, MISSING if before is None else sha256_bytes(before))

    def immutable(self, relative: str, content: bytes) -> Write:
        prior = self.read(relative)
        if prior:
            raise TransactionError("immutable history already exists")
        return Write(relative, content, MISSING)

    def evidence(self, relative: str) -> bytes:
        if tuple(part.casefold() for part in relative.split("/")[:2]) == (".lazybuddy", "dashboard"):
            raise TransactionError("PROTECTED_SERVICE_ARTIFACT")
        path = safe_path(self.binding.root, relative)
        if not path.is_file() or path.stat().st_size > LIMIT:
            raise TransactionError("evidence missing or oversized")
        return bounded_read(self.binding.root, relative, single_link=True)
