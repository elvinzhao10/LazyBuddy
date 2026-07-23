from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lazybuddy_adaptive_fingerprint as fingerprint  # noqa: E402


def _run_git(repository: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(repository), *args],
        check=False,
        stderr=subprocess.PIPE,
        stdout=subprocess.PIPE,
        timeout=5,
    )
    assert completed.returncode == 0, completed.stderr.decode(
        "utf-8",
        errors="replace",
    )


def _repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repository"
    repository.mkdir()
    _run_git(repository, "init", "-q")
    _run_git(repository, "config", "user.email", "adaptive@example.invalid")
    _run_git(repository, "config", "user.name", "Adaptive Test")
    (repository / "tracked.txt").write_text("baseline\n", encoding="utf-8")
    _run_git(repository, "add", "tracked.txt")
    _run_git(repository, "commit", "-qm", "fixture")
    return repository


def test_revision_fingerprint_fails_closed_when_git_output_exceeds_bound(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository = _repository(tmp_path)
    (repository / "tracked.txt").write_text("x" * 4_096, encoding="utf-8")
    monkeypatch.setattr(fingerprint, "MAX_GIT_OUTPUT_BYTES", 128)

    # When
    result = fingerprint.revision_fingerprint(repository)

    # Then
    assert result == fingerprint.RevisionFingerprint(
        digest=None,
        status="unavailable",
    )


def test_revision_fingerprint_enforces_git_timeout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_git = fake_bin / "git"
    fake_git.write_text("#!/bin/sh\nexec sleep 5\n", encoding="utf-8")
    fake_git.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake_bin}{os.pathsep}{os.environ['PATH']}")
    started = time.monotonic()

    # When
    result = fingerprint.revision_fingerprint(
        tmp_path,
        timeout_seconds=0.05,
    )

    # Then
    assert result.status == "unavailable"
    assert time.monotonic() - started < 1.0


def test_revision_fingerprint_does_not_invoke_configured_textconv(
    tmp_path: Path,
) -> None:
    # Given
    repository = _repository(tmp_path)
    marker = tmp_path / "textconv-invoked"
    driver = tmp_path / "textconv.sh"
    driver.write_text(
        f"#!/bin/sh\nprintf invoked > {marker}\ncat \"$1\"\n",
        encoding="utf-8",
    )
    driver.chmod(0o755)
    (repository / ".gitattributes").write_text(
        "tracked.txt diff=adversarial\n",
        encoding="utf-8",
    )
    _run_git(repository, "config", "diff.adversarial.textconv", str(driver))
    _run_git(repository, "add", ".gitattributes")
    _run_git(repository, "commit", "-qm", "configure textconv fixture")
    (repository / "tracked.txt").write_text("changed\n", encoding="utf-8")

    # When
    result = fingerprint.revision_fingerprint(repository)

    # Then
    assert result.status == "available"
    assert not marker.exists()


def test_oversized_untracked_file_is_rejected_before_content_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository = _repository(tmp_path)
    oversized = repository / "oversized.bin"
    oversized.write_bytes(b"x" * 9)
    monkeypatch.setattr(fingerprint, "MAX_UNTRACKED_FILE_BYTES", 8)
    original_open = Path.open
    opened = False

    def recording_open(path: Path, *args, **kwargs):
        nonlocal opened
        if path == oversized:
            opened = True
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", recording_open)

    # When
    result = fingerprint.revision_fingerprint(repository)

    # Then
    assert result.status == "unavailable"
    assert opened is False


def test_untracked_file_count_bound_rejects_before_content_reads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository = _repository(tmp_path)
    untracked = {
        repository / "first.txt",
        repository / "second.txt",
    }
    for path in untracked:
        path.write_text("x", encoding="utf-8")
    monkeypatch.setattr(fingerprint, "MAX_UNTRACKED_FILE_COUNT", 1)
    original_open = Path.open
    opened: list[Path] = []

    def recording_open(path: Path, *args, **kwargs):
        if path in untracked:
            opened.append(path)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", recording_open)

    # When
    result = fingerprint.revision_fingerprint(repository)

    # Then
    assert result.status == "unavailable"
    assert opened == []


def test_aggregate_untracked_byte_bound_rejects_individually_bounded_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository = _repository(tmp_path)
    (repository / "first.bin").write_bytes(b"a" * 6)
    (repository / "second.bin").write_bytes(b"b" * 6)
    monkeypatch.setattr(fingerprint, "MAX_UNTRACKED_FILE_BYTES", 8)
    monkeypatch.setattr(fingerprint, "MAX_UNTRACKED_TOTAL_BYTES", 10)

    # When
    result = fingerprint.revision_fingerprint(repository)

    # Then
    assert result.status == "unavailable"


def test_untracked_material_deadline_exhaustion_fails_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / "untracked.txt").write_text("content\n", encoding="utf-8")
    monotonic_values = iter((0.0, 2.0))
    monkeypatch.setattr(
        fingerprint,
        "_git_bytes",
        lambda *_args, **_kwargs: b"untracked.txt\0",
    )
    monkeypatch.setattr(
        fingerprint.time,
        "monotonic",
        lambda: next(monotonic_values),
    )
    monkeypatch.setattr(
        fingerprint,
        "MAX_UNTRACKED_DEADLINE_SECONDS",
        1.0,
    )

    # When
    raised = pytest.raises(fingerprint.RevisionFingerprintError)
    with raised as error:
        fingerprint._untracked_material(repository, 1.0)

    # Then
    assert error.value.reason == "untracked-deadline-exceeded"
