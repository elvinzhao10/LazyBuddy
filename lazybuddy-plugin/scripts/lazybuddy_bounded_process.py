from __future__ import annotations

import hashlib
import os
import shutil
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, TypeAlias, assert_never

from lazybuddy_supervisor_contract import SupervisorState, SupervisorStatus, SupervisorStatusError, parse_status
from lazybuddy_process_lifecycle import (
    InspectionAvailable,
    InspectionResult,
    InspectionUnavailable,
    Inspector,
    OwnershipTracker,
    ProcessRecord,
    SignalResult,
)


READ_BYTES: Final = 64 * 1024
TAIL_BYTES: Final = 4096
CancelCheck: TypeAlias = Callable[[], bool]


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(READ_BYTES):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def executable_fingerprint(command: str, cwd: Path) -> dict[str, str]:
    candidate = Path(command)
    if candidate.parent != Path("."):
        candidate = candidate if candidate.is_absolute() else cwd / candidate
        resolved = candidate.resolve(strict=True)
    else:
        located = shutil.which(command)
        if located is None:
            raise FileNotFoundError(command)
        resolved = Path(located).resolve(strict=True)
    if not resolved.is_file() or not os.access(resolved, os.X_OK):
        raise PermissionError(command)
    return {"path": str(resolved), "digest": file_digest(resolved)}


class ChildStatus(StrEnum):
    EXITED = "exited"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    OUTPUT_LIMIT = "output-limit"
    LAUNCH_ERROR = "launch-error"
    SUPERVISOR_FAILURE = "supervisor-failure"


@dataclass(frozen=True, slots=True)
class ChildOutcome:
    status: ChildStatus
    returncode: int | None
    tracker: OwnershipTracker
    detail: str = ""


@dataclass(frozen=True, slots=True)
class OutputBoundary:
    stdout: Path
    stderr: Path
    cap: int

    def within_cap(self) -> bool:
        return self.stdout.stat().st_size <= self.cap and self.stderr.stat().st_size <= self.cap

    def enforce_cap(self) -> None:
        for path in (self.stdout, self.stderr):
            if path.stat().st_size > self.cap:
                with path.open("r+b") as handle:
                    handle.truncate(self.cap)

    def tail(self) -> str:
        combined = self.stdout.read_bytes() + self.stderr.read_bytes()
        return combined[-TAIL_BYTES:].decode(errors="replace")


@dataclass(frozen=True, slots=True)
class WaitBoundary:
    deadline: float
    cancel_file: Path | None
    cancel_requested: CancelCheck


@dataclass(frozen=True, slots=True)
class SupervisorHandle:
    process: subprocess.Popen[bytes]
    tracker: OwnershipTracker
    status_file: Path
    inspector: Inspector


@dataclass(frozen=True, slots=True)
class HandshakeOutcome:
    tracker: OwnershipTracker
    ready: SupervisorStatus | None
    detail: str = ""


def process_records() -> tuple[ProcessRecord, ...]:
    ps_path = next(
        (candidate for candidate in ("/bin/ps", "/usr/bin/ps") if os.path.isfile(candidate) and os.access(candidate, os.X_OK)),
        None,
    )
    if ps_path is None:
        raise FileNotFoundError("trusted ps executable is unavailable")
    completed = subprocess.run(
        [ps_path, "-axo", "pid=,ppid=,pgid=,stat=,lstart="],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    completed.check_returncode()
    records: list[ProcessRecord] = []
    for line in completed.stdout.splitlines():
        fields = line.split(maxsplit=4)
        if len(fields) != 5:
            continue
        try:
            record = ProcessRecord(int(fields[0]), int(fields[1]), int(fields[2]), fields[3], fields[4])
        except ValueError:
            continue
        records.append(record)
    if all(record.pid != os.getpid() for record in records):
        raise OSError("trusted ps output did not include the runner process")
    return tuple(records)


def inspect_processes() -> InspectionResult:
    try:
        return InspectionAvailable(process_records())
    except (OSError, subprocess.SubprocessError) as error:
        return InspectionUnavailable(str(error))


def signal_owned_group(group_id: int, signal_number: int) -> SignalResult:
    try:
        os.killpg(group_id, signal_number)
    except ProcessLookupError:
        return SignalResult.not_found()
    except (PermissionError, OSError) as error:
        return SignalResult.refused(str(error))
    return SignalResult.sent()


def establish_tracker(process: subprocess.Popen[bytes], inspector: Inspector) -> OwnershipTracker:
    inspection = inspector()
    match inspection:
        case InspectionUnavailable(reason=reason):
            placeholder = ProcessRecord(process.pid, 0, process.pid, "?", "unobserved")
            return OwnershipTracker(placeholder, (placeholder,), reason)
        case InspectionAvailable(records=records):
            root = next((record for record in records if record.pid == process.pid), None)
            if root is None:
                placeholder = ProcessRecord(process.pid, 0, process.pid, "?", "unobserved")
                return OwnershipTracker(placeholder, (placeholder,), "direct child identity unavailable")
            return OwnershipTracker.establish(root, inspection)
        case unreachable:
            assert_never(unreachable)


def unobserved_tracker(process: subprocess.Popen[bytes], detail: str) -> OwnershipTracker:
    placeholder = ProcessRecord(process.pid, 0, process.pid, "?", "unobserved")
    return OwnershipTracker(placeholder, (placeholder,), detail)


def await_supervisor_ready(
    process: subprocess.Popen[bytes],
    status_file: Path,
    inspector: Inspector,
    deadline: float,
) -> HandshakeOutcome:
    while True:
        try:
            status = parse_status(status_file)
        except SupervisorStatusError as error:
            return HandshakeOutcome(unobserved_tracker(process, str(error)), None, str(error))
        if status is not None:
            if status.state is not SupervisorState.READY:
                detail = f"supervisor entered {status.state.value} before ownership acknowledgement"
                return HandshakeOutcome(unobserved_tracker(process, detail), None, detail)
            if status.supervisor_pid != process.pid or status.supervisor_pgid != process.pid:
                detail = "supervisor ready identity does not match the launched group leader"
                return HandshakeOutcome(unobserved_tracker(process, detail), None, detail)
            tracker = establish_tracker(process, inspector)
            if tracker.inspection_problem:
                return HandshakeOutcome(tracker, None, tracker.inspection_problem)
            if (
                tracker.root.pid != status.supervisor_pid
                or tracker.root.group_id != status.supervisor_pgid
                or not tracker.root.started
            ):
                detail = "supervisor ready identity is not continuously observable"
                return HandshakeOutcome(tracker, None, detail)
            return HandshakeOutcome(tracker, status)
        if process.poll() is not None:
            detail = "launch supervisor exited before publishing ready identity"
            return HandshakeOutcome(unobserved_tracker(process, detail), None, detail)
        if time.monotonic() >= deadline:
            detail = "launch supervisor ready identity timed out"
            return HandshakeOutcome(unobserved_tracker(process, detail), None, detail)
        time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))


def wait_for_child(
    handle: SupervisorHandle,
    output: OutputBoundary,
    boundary: WaitBoundary,
) -> ChildOutcome:
    current_tracker = handle.tracker
    while True:
        current_tracker = current_tracker.observe(handle.inspector())
        try:
            supervisor_status = parse_status(handle.status_file)
        except SupervisorStatusError as error:
            return ChildOutcome(ChildStatus.SUPERVISOR_FAILURE, None, current_tracker, str(error))
        if supervisor_status is not None:
            match supervisor_status.state:
                case SupervisorState.RUNNING:
                    pass
                case SupervisorState.READY:
                    pass
                case SupervisorState.EXITED:
                    return ChildOutcome(ChildStatus.EXITED, supervisor_status.returncode, current_tracker)
                case SupervisorState.LAUNCH_FAILED:
                    return ChildOutcome(ChildStatus.LAUNCH_ERROR, None, current_tracker, supervisor_status.detail)
                case unreachable:
                    assert_never(unreachable)
        if not output.within_cap():
            return ChildOutcome(ChildStatus.OUTPUT_LIMIT, None, current_tracker)
        if handle.process.poll() is not None:
            return ChildOutcome(
                ChildStatus.SUPERVISOR_FAILURE,
                None,
                current_tracker,
                "launch supervisor exited before a terminal status",
            )
        if boundary.cancel_requested() or (boundary.cancel_file is not None and boundary.cancel_file.exists()):
            return ChildOutcome(ChildStatus.CANCELLED, None, current_tracker)
        if time.monotonic() >= boundary.deadline:
            return ChildOutcome(ChildStatus.TIMEOUT, None, current_tracker)
        time.sleep(min(0.02, max(0.0, boundary.deadline - time.monotonic())))
