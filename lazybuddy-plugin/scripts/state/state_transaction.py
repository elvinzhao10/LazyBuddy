#!/usr/bin/env python3
"""Journaled grouped file commits for one LazyBuddy run."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List, NamedTuple, Optional, Sequence, TypedDict

from state_transaction_files import fsync_directory, replace_durable, write_durable

JOURNAL_NAME = ".transaction-journal"
LOCK_NAME = ".transaction.lock"
REVISION_NAME = ".revision"
MISSING = "missing"


class TransactionError(Exception):
    pass


class Write(NamedTuple):
    relative_path: str
    content: bytes
    expected_sha256: Optional[str] = None


class JournalEntry(TypedDict):
    path: str
    before_sha256: str
    after_sha256: str
    stage: str
    backup: str


class Manifest(TypedDict):
    schema_version: int
    transaction_id: str
    operation: str
    revision_before: int
    revision_after: int
    entries: List[JournalEntry]


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def file_sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes()) if path.exists() else MISSING


def checked_target(run_dir: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or not relative.parts or any(part in ("", ".", "..") for part in relative.parts):
        raise TransactionError(f"unsafe transaction path: {relative_path}")
    target = run_dir.joinpath(relative)
    probe = run_dir
    for part in relative.parts:
        probe = probe / part
        if probe.is_symlink():
            raise TransactionError(f"transaction path traverses symlink: {relative_path}")
    if target.exists() and not target.is_file():
        raise TransactionError(f"transaction target is not a regular file: {relative_path}")
    return target


def read_revision(run_dir: Path) -> int:
    path = run_dir / REVISION_NAME
    if not path.exists():
        return 0
    try:
        value = int(path.read_text(encoding="utf-8").strip())
    except (OSError, UnicodeError, ValueError) as error:
        raise TransactionError("transaction revision is corrupt") from error
    if value < 0:
        raise TransactionError("transaction revision is corrupt")
    return value


@contextmanager
def locked(run_dir: Path) -> Iterator[None]:
    lock_path = run_dir / LOCK_NAME
    if lock_path.is_symlink() or (lock_path.exists() and not lock_path.is_file()):
        raise TransactionError("transaction lock is unsafe")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        try:
            timeout = float(os.environ.get("LAZYBUDDY_TX_LOCK_TIMEOUT_SECONDS", "5"))
        except ValueError as error:
            raise TransactionError("transaction lock timeout is invalid") from error
        if timeout <= 0 or timeout > 30:
            raise TransactionError("transaction lock timeout is invalid")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as error:
                if time.monotonic() >= deadline:
                    raise TransactionError("transaction lock timed out") from error
                time.sleep(0.01)
        yield


def load_manifest(journal: Path) -> Manifest:
    manifest_path = journal / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TransactionError("transaction journal manifest is corrupt") from error
    if not isinstance(manifest, dict) or set(manifest) != {"schema_version", "transaction_id", "operation", "revision_before", "revision_after", "entries"}:
        raise TransactionError("transaction journal manifest is inconsistent")
    if manifest["schema_version"] != 1 or not isinstance(manifest["entries"], list):
        raise TransactionError("transaction journal manifest is inconsistent")
    if not isinstance(manifest["transaction_id"], str) or not manifest["transaction_id"] or not isinstance(manifest["operation"], str) or not manifest["operation"]:
        raise TransactionError("transaction journal identity is inconsistent")
    if not isinstance(manifest["revision_before"], int) or manifest["revision_after"] != manifest["revision_before"] + 1:
        raise TransactionError("transaction journal revision is inconsistent")
    paths = []
    for index, entry in enumerate(manifest["entries"]):
        required = {"path", "before_sha256", "after_sha256", "stage", "backup"}
        if not isinstance(entry, dict) or set(entry) != required:
            raise TransactionError("transaction journal entry is inconsistent")
        if entry["before_sha256"] != MISSING and not _digest(entry["before_sha256"]):
            raise TransactionError("transaction journal before SHA256 is invalid")
        if not _digest(entry["after_sha256"]):
            raise TransactionError("transaction journal after SHA256 is invalid")
        if entry["stage"] != f"stage-{index}" or entry["backup"] != f"backup-{index}":
            raise TransactionError("transaction journal material path is inconsistent")
        paths.append(entry["path"])
    if len(paths) != len(set(paths)):
        raise TransactionError("transaction journal contains duplicate targets")
    return manifest


def _digest(value) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def _validate_material(run_dir: Path, journal: Path, entry: JournalEntry) -> tuple[Path, Path, Path]:
    target = checked_target(run_dir, entry["path"])
    stage = journal / entry["stage"]
    backup = journal / entry["backup"]
    if stage.is_symlink() or not stage.is_file() or file_sha256(stage) != entry["after_sha256"]:
        raise TransactionError("transaction journal staged content is inconsistent")
    if entry["before_sha256"] != MISSING and (backup.is_symlink() or not backup.is_file() or file_sha256(backup) != entry["before_sha256"]):
        raise TransactionError("transaction journal backup is inconsistent")
    return target, stage, backup


def recover_locked(run_dir: Path) -> str:
    journal = run_dir / JOURNAL_NAME
    if not journal.exists():
        return "clean"
    if journal.is_symlink() or not journal.is_dir():
        raise TransactionError("transaction journal is unsafe")
    manifest_path = journal / "manifest.json"
    preparing = journal / "preparing"
    if not manifest_path.exists():
        allowed = {"preparing"} | {f"stage-{index}" for index in range(1024)} | {f"backup-{index}" for index in range(1024)}
        if not preparing.is_file() or any(path.name not in allowed or path.is_symlink() or not path.is_file() for path in journal.iterdir()):
            raise TransactionError("transaction journal manifest is corrupt")
        shutil.rmtree(journal)
        fsync_directory(run_dir)
        return "rollback"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise TransactionError("transaction journal manifest is unsafe")
    manifest = load_manifest(journal)
    committed = journal / "committed"
    if committed.exists() and (committed.is_symlink() or not committed.is_file()):
        raise TransactionError("transaction committed marker is unsafe")
    entries = manifest["entries"]
    materials = [_validate_material(run_dir, journal, entry) for entry in entries]
    current_revision = read_revision(run_dir)
    if current_revision not in (manifest["revision_before"], manifest["revision_after"]):
        raise TransactionError("transaction journal revision conflicts with run state")
    if committed.exists():
        if committed.read_bytes() != b"committed\n":
            raise TransactionError("transaction committed marker is corrupt")
        for entry, (target, stage, _backup) in zip(entries, materials):
            current = file_sha256(target)
            if current not in (entry["before_sha256"], entry["after_sha256"]):
                raise TransactionError(f"committed transaction target conflicts: {entry['path']}")
            if current != entry["after_sha256"]:
                replace_durable(target, stage.read_bytes())
        replace_durable(run_dir / REVISION_NAME, f"{manifest['revision_after']}\n".encode())
        outcome = "forward"
    else:
        for entry, (target, _stage, backup) in zip(reversed(entries), reversed(materials)):
            current = file_sha256(target)
            if current not in (entry["before_sha256"], entry["after_sha256"]):
                raise TransactionError(f"uncommitted transaction target conflicts: {entry['path']}")
            if entry["before_sha256"] == MISSING:
                if target.exists():
                    target.unlink()
                    fsync_directory(target.parent)
            elif current != entry["before_sha256"]:
                replace_durable(target, backup.read_bytes())
        replace_durable(run_dir / REVISION_NAME, f"{manifest['revision_before']}\n".encode())
        outcome = "rollback"
    shutil.rmtree(journal)
    fsync_directory(run_dir)
    return outcome


def recover(run_dir: Path) -> str:
    with locked(run_dir):
        return recover_locked(run_dir)


def _fault(name: str) -> None:
    if os.environ.get("LAZYBUDDY_TX_FAULT") == name:
        os._exit(86)


def commit_locked(run_dir: Path, operation: str, writes: Sequence[Write]) -> int:
    recover_locked(run_dir)
    if not writes:
        raise TransactionError("transaction has no writes")
    revision_before = read_revision(run_dir)
    journal = run_dir / JOURNAL_NAME
    journal.mkdir(mode=0o700)
    write_durable(journal / "preparing", b"preparing\n")
    entries = []
    for index, write in enumerate(writes):
        target = checked_target(run_dir, write.relative_path)
        before_sha256 = file_sha256(target)
        if write.expected_sha256 is not None and before_sha256 != write.expected_sha256:
            shutil.rmtree(journal)
            raise TransactionError(f"stale transaction input: {write.relative_path}")
        stage_name = f"stage-{index}"
        backup_name = f"backup-{index}"
        write_durable(journal / stage_name, write.content)
        if before_sha256 != MISSING:
            write_durable(journal / backup_name, target.read_bytes())
        entries.append({
            "path": write.relative_path,
            "before_sha256": before_sha256,
            "after_sha256": sha256_bytes(write.content),
            "stage": stage_name,
            "backup": backup_name,
        })
        _fault(f"after-stage:{index + 1}")
    _fault("after-stage")
    manifest = {
        "schema_version": 1,
        "transaction_id": uuid.uuid4().hex,
        "operation": operation,
        "revision_before": revision_before,
        "revision_after": revision_before + 1,
        "entries": entries,
    }
    write_durable(journal / "manifest.json", (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode())
    (journal / "preparing").unlink()
    fsync_directory(journal)
    _fault("after-journal")
    write_durable(journal / "committed", b"committed\n")
    _fault("after-commit")
    for index, (entry, write) in enumerate(zip(entries, writes), start=1):
        replace_durable(checked_target(run_dir, entry["path"]), write.content)
        _fault(f"after-install:{index}")
    replace_durable(run_dir / REVISION_NAME, f"{revision_before + 1}\n".encode())
    if any(file_sha256(checked_target(run_dir, entry["path"])) != entry["after_sha256"] for entry in entries):
        raise TransactionError("transaction install verification failed")
    if read_revision(run_dir) != revision_before + 1:
        raise TransactionError("transaction revision verification failed")
    shutil.rmtree(journal)
    fsync_directory(run_dir)
    return revision_before + 1


def commit(run_dir: Path, operation: str, writes: Sequence[Write]) -> int:
    with locked(run_dir):
        return commit_locked(run_dir, operation, writes)
