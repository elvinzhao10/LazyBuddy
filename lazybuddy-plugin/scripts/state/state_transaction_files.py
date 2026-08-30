#!/usr/bin/env python3
"""Durable file installation primitives for run transactions."""

import os
import stat
import tempfile
from pathlib import Path
from typing import NamedTuple, Optional


class TransactionError(Exception):
    pass


class OwnedDirectory(NamedTuple):
    parent_descriptor: int
    descriptor: int
    name: str
    path: Path

    def require_current(self) -> None:
        try:
            current = os.stat(self.name, dir_fd=self.parent_descriptor, follow_symlinks=False)
        except FileNotFoundError as error:
            self.close()
            raise TransactionError("transaction journal is unsafe") from error
        bound = os.fstat(self.descriptor)
        if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (bound.st_dev, bound.st_ino):
            self.close()
            raise TransactionError("transaction journal is unsafe")

    def unlink(self, name: str) -> None:
        self.require_current()
        os.unlink(name, dir_fd=self.descriptor)
        self.require_current()
        os.fsync(self.descriptor)

    def close(self) -> None:
        os.close(self.descriptor)
        os.close(self.parent_descriptor)


def open_owned_directory(path: Path) -> OwnedDirectory:
    parent_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        descriptor = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_descriptor)
    except OSError:
        os.close(parent_descriptor)
        raise
    owned = OwnedDirectory(parent_descriptor, descriptor, path.name, path)
    owned.require_current()
    return owned


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_durable(path: Path, content: bytes, *, owner: Optional[OwnedDirectory] = None) -> None:
    if owner is None:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    else:
        owner.require_current()
        try:
            descriptor = os.open(path.name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=owner.descriptor)
        except OSError as error:
            raise TransactionError("transaction journal is unsafe") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            if owner is not None:
                current = os.stat(path.name, dir_fd=owner.descriptor, follow_symlinks=False)
                bound = os.fstat(handle.fileno())
                if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (bound.st_dev, bound.st_ino):
                    raise TransactionError("transaction journal is unsafe")
    except FileNotFoundError as error:
        raise TransactionError("transaction journal is unsafe") from error
    if owner is None:
        fsync_directory(path.parent)
    else:
        owner.require_current()
        os.fsync(owner.descriptor)


def replace_durable(path: Path, content: bytes, *, owner: Optional[OwnedDirectory] = None) -> None:
    if owner is not None:
        owner.require_current()
        try:
            relative = path.relative_to(owner.path)
        except ValueError as error:
            raise TransactionError("transaction target is unsafe") from error
        descriptor = owner.descriptor
        opened: list[int] = []
        temporary: str | None = None
        try:
            for component in relative.parts[:-1]:
                try:
                    child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                except FileNotFoundError:
                    os.mkdir(component, mode=0o700, dir_fd=descriptor)
                    child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                opened.append(child)
                descriptor = child
            temporary = f".{relative.name}.{os.urandom(16).hex()}"
            file_descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            with os.fdopen(file_descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            owner.require_current()
            os.replace(temporary, relative.name, src_dir_fd=descriptor, dst_dir_fd=descriptor)
            owner.require_current()
            os.fsync(descriptor)
        except OSError as error:
            raise TransactionError("transaction journal is unsafe") from error
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary, dir_fd=descriptor)
                except FileNotFoundError:
                    pass
            for child in reversed(opened):
                os.close(child)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
