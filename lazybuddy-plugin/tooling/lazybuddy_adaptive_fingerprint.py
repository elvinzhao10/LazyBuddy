from __future__ import annotations

import hashlib
import json
import os
import selectors
import stat
import subprocess
import time
from pathlib import Path
from typing import Final, NamedTuple


SHA256_PREFIX: Final = "sha256:"
MAX_GIT_OUTPUT_BYTES: Final = 64 * 1024 * 1024
MAX_UNTRACKED_FILE_BYTES: Final = 1024 * 1024
MAX_UNTRACKED_FILE_COUNT: Final = 4_096
MAX_UNTRACKED_TOTAL_BYTES: Final = 16 * 1024 * 1024
MAX_UNTRACKED_DEADLINE_SECONDS: Final = 1.0
READ_CHUNK_BYTES: Final = 64 * 1024


class RevisionFingerprint(NamedTuple):
    digest: str | None
    status: str

    def as_dict(self) -> dict:
        return {"digest": self.digest, "status": self.status}


class RevisionFingerprintError(Exception):
    __slots__ = ("reason",)

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason

    def __str__(self) -> str:
        return self.reason


def sha256_bytes(value: bytes) -> str:
    return f"{SHA256_PREFIX}{hashlib.sha256(value).hexdigest()}"


def request_digest(prompt: str) -> str:
    return sha256_bytes(prompt.encode("utf-8"))


def canonical_fingerprint(material: dict) -> str:
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256_bytes(encoded)


def _git_bytes(root: Path, args: tuple[str, ...], timeout_seconds: float) -> bytes:
    try:
        process = subprocess.Popen(
            ["git", "-C", str(root), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )
    except OSError as error:
        raise RevisionFingerprintError(type(error).__name__) from error
    stdout = process.stdout
    if stdout is None:
        process.kill()
        process.wait()
        raise RevisionFingerprintError("git-stdout-unavailable")

    output = bytearray()
    deadline = time.monotonic() + timeout_seconds
    selector = selectors.DefaultSelector()
    try:
        selector.register(stdout, selectors.EVENT_READ)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RevisionFingerprintError("git-timeout")
            if not selector.select(remaining):
                raise RevisionFingerprintError("git-timeout")
            read_size = min(
                READ_CHUNK_BYTES,
                MAX_GIT_OUTPUT_BYTES + 1 - len(output),
            )
            chunk = os.read(stdout.fileno(), read_size)
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > MAX_GIT_OUTPUT_BYTES:
                raise RevisionFingerprintError("git-output-limit-exceeded")

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RevisionFingerprintError("git-timeout")
        try:
            return_code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as error:
            raise RevisionFingerprintError("git-timeout") from error
        if return_code != 0:
            raise RevisionFingerprintError(f"git-exit-{return_code}")
        return bytes(output)
    except OSError as error:
        raise RevisionFingerprintError(type(error).__name__) from error
    finally:
        selector.close()
        stdout.close()
        if process.poll() is None:
            process.kill()
        process.wait()


def _add_record(hasher: "hashlib._Hash", label: bytes, value: bytes) -> None:
    for item in (label, value):
        hasher.update(len(item).to_bytes(8, "big"))
        hasher.update(item)


def _untracked_material(
    repository_root: Path,
    timeout_seconds: float,
) -> list[tuple[bytes, bytes]]:
    raw_paths = _git_bytes(
        repository_root,
        ("ls-files", "--others", "--exclude-standard", "-z"),
        timeout_seconds,
    )
    deadline = time.monotonic() + MAX_UNTRACKED_DEADLINE_SECONDS
    paths = [path for path in raw_paths.split(b"\0") if path]
    if len(paths) > MAX_UNTRACKED_FILE_COUNT:
        raise RevisionFingerprintError("untracked-file-count-exceeded")
    if time.monotonic() >= deadline:
        raise RevisionFingerprintError("untracked-deadline-exceeded")

    records: list[tuple[bytes, bytes]] = []
    total_bytes = 0
    for raw_path in sorted(paths):
        if time.monotonic() >= deadline:
            raise RevisionFingerprintError("untracked-deadline-exceeded")
        relative = Path(os.fsdecode(raw_path))
        if relative.is_absolute() or ".." in relative.parts:
            raise RevisionFingerprintError("unsafe-untracked-path")
        candidate = Path(os.path.abspath(repository_root / relative))
        try:
            candidate.relative_to(repository_root)
        except ValueError as error:
            raise RevisionFingerprintError("unsafe-untracked-path") from error
        file_status = candidate.lstat()
        mode = file_status.st_mode
        if stat.S_ISLNK(mode):
            content = os.fsencode(os.readlink(candidate))
        elif stat.S_ISREG(mode):
            if file_status.st_size > MAX_UNTRACKED_FILE_BYTES:
                raise RevisionFingerprintError("untracked-file-size-exceeded")
            if total_bytes > MAX_UNTRACKED_TOTAL_BYTES - file_status.st_size:
                raise RevisionFingerprintError("untracked-total-size-exceeded")
            with candidate.open("rb") as handle:
                content = handle.read(MAX_UNTRACKED_FILE_BYTES + 1)
        else:
            raise RevisionFingerprintError("unsupported-untracked-file-type")
        if len(content) > MAX_UNTRACKED_FILE_BYTES:
            raise RevisionFingerprintError("untracked-file-size-exceeded")
        if total_bytes > MAX_UNTRACKED_TOTAL_BYTES - len(content):
            raise RevisionFingerprintError("untracked-total-size-exceeded")
        if time.monotonic() >= deadline:
            raise RevisionFingerprintError("untracked-deadline-exceeded")
        total_bytes += len(content)
        records.append((raw_path, content))
    return records


def revision_fingerprint(
    project_root: Path,
    *,
    timeout_seconds: float = 2.0,
) -> RevisionFingerprint:
    try:
        top_level = _git_bytes(
            project_root,
            ("rev-parse", "--show-toplevel"),
            timeout_seconds,
        ).strip()
        repository_root = Path(os.fsdecode(top_level)).resolve(strict=True)
        committed_base = _git_bytes(
            repository_root,
            ("rev-parse", "HEAD"),
            timeout_seconds,
        ).strip()
        staged = _git_bytes(
            repository_root,
            ("diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--no-color"),
            timeout_seconds,
        )
        tracked_working = _git_bytes(
            repository_root,
            ("diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-color"),
            timeout_seconds,
        )
        untracked = _untracked_material(repository_root, timeout_seconds)
    except (OSError, ValueError, RevisionFingerprintError):
        return RevisionFingerprint(digest=None, status="unavailable")

    hasher = hashlib.sha256()
    _add_record(hasher, b"committed-base", committed_base)
    _add_record(hasher, b"staged-content", staged)
    _add_record(hasher, b"tracked-working-content", tracked_working)
    for path, content in untracked:
        _add_record(hasher, b"nonignored-untracked-path", path)
        _add_record(hasher, b"nonignored-untracked-content", content)
    return RevisionFingerprint(
        digest=f"{SHA256_PREFIX}{hasher.hexdigest()}",
        status="available",
    )
