#!/usr/bin/env python3
# allow: SIZE_OK — bounded process state and PID-safe cleanup share ownership invariants.
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, assert_never

from lazybuddy_process_lifecycle import (
    CleanupReceipt,
    CleanupStatus,
    InspectionAvailable,
    InspectionResult,
    InspectionUnavailable,
    OwnershipTracker,
    ProcessRecord,
    SignalResult,
    cleanup_owned_processes,
)


DEFAULT_OUTPUT_CAP: Final = 1024 * 1024
READ_BYTES: Final = 64 * 1024
TAIL_BYTES: Final = 4096
cancel_signal_received = False


def positive_integer(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def emit(status: str, label: str) -> None:
    print(f"{status}: {label}", file=sys.stderr, flush=True)


def write_result(path: Path, result: dict[str, object]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise


def has_linked_component(path: Path) -> bool:
    current = path.absolute()
    while True:
        if current.is_symlink():
            return True
        if current.parent == current:
            return False
        current = current.parent


def normalize_macos_temp_alias(path: Path) -> Path:
    if sys.platform != "darwin":
        return path
    for alias, target in ((Path("/tmp"), Path("/private/tmp")), (Path("/var"), Path("/private/var"))):
        try:
            relative = path.relative_to(alias)
        except ValueError:
            continue
        if alias.is_symlink() and alias.resolve(strict=True) == target:
            return target / relative
    return path


def process_records() -> dict[int, ProcessRecord]:
    ps_path = next(
        (candidate for candidate in ("/bin/ps", "/usr/bin/ps") if os.path.isfile(candidate) and os.access(candidate, os.X_OK)),
        None,
    )
    if ps_path is None:
        raise FileNotFoundError("trusted ps executable is unavailable")
    completed = subprocess.run(
        [ps_path, "-axo", "pid=,ppid=,pgid=,stat=,lstart="],
        check=False, capture_output=True, text=True, timeout=5,
    )
    completed.check_returncode()
    records: dict[int, ProcessRecord] = {}
    for line in completed.stdout.splitlines():
        fields = line.split(maxsplit=4)
        if len(fields) != 5:
            continue
        try:
            record = ProcessRecord(int(fields[0]), int(fields[1]), int(fields[2]), fields[3], fields[4])
        except ValueError:
            continue
        records[record.pid] = record
    if os.getpid() not in records:
        raise OSError("trusted ps output did not include the runner process")
    return records


def inspect_processes() -> InspectionResult:
    try:
        return InspectionAvailable(tuple(process_records().values()))
    except (OSError, subprocess.SubprocessError) as error:
        return InspectionUnavailable(str(error))


def signal_owned_group(group_id: int, signal_number: int) -> SignalResult:
    try:
        os.killpg(group_id, signal_number)
    except ProcessLookupError:
        return SignalResult.not_found()
    except PermissionError as error:
        return SignalResult.refused(str(error))
    except OSError as error:
        return SignalResult.refused(str(error))
    return SignalResult.sent()


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


def signal_cancel(_number: int, _frame: object) -> None:
    global cancel_signal_received
    cancel_signal_received = True


class ChildStatus(StrEnum):
    EXITED = "exited"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    OUTPUT_LIMIT = "output-limit"


@dataclass(frozen=True, slots=True)
class ChildOutcome:
    status: ChildStatus
    returncode: int | None
    tracker: OwnershipTracker


def output_within_cap(paths: tuple[Path, Path], output_cap: int) -> bool:
    return all(path.stat().st_size <= output_cap for path in paths)


def enforce_output_cap(paths: tuple[Path, Path], output_cap: int) -> None:
    for path in paths:
        if path.stat().st_size > output_cap:
            with path.open("r+b") as handle:
                handle.truncate(output_cap)


def establish_tracker(process: subprocess.Popen[bytes]) -> OwnershipTracker:
    inspection = inspect_processes()
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


def wait_for_child(
    process: subprocess.Popen[bytes],
    tracker: OwnershipTracker,
    output_paths: tuple[Path, Path],
    deadline: float,
    output_cap: int,
    cancel_file: Path | None,
) -> ChildOutcome:
    current_tracker = tracker
    while True:
        returncode = process.poll()
        if not output_within_cap(output_paths, output_cap):
            return ChildOutcome(ChildStatus.OUTPUT_LIMIT, returncode, current_tracker)
        if returncode is not None:
            return ChildOutcome(ChildStatus.EXITED, returncode, current_tracker)
        if cancel_signal_received or (cancel_file is not None and cancel_file.exists()):
            return ChildOutcome(ChildStatus.CANCELLED, None, current_tracker)
        if time.monotonic() >= deadline:
            return ChildOutcome(ChildStatus.TIMEOUT, None, current_tracker)
        current_tracker = current_tracker.observe(inspect_processes())
        time.sleep(min(0.02, max(0.0, deadline - time.monotonic())))


def output_tail(stdout_path: Path, stderr_path: Path) -> str:
    combined = stdout_path.read_bytes() + stderr_path.read_bytes()
    return combined[-TAIL_BYTES:].decode(errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--timeout", required=True, type=positive_integer)
    parser.add_argument("--result-file", required=True, type=Path)
    for option in ("cwd", "cwd-file", "stdin-file", "stdout-file", "stderr-file", "cancel-file"):
        parser.add_argument(f"--{option}", type=Path)
    parser.add_argument("--max-output-bytes", type=positive_integer, default=DEFAULT_OUTPUT_CAP)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    args.result_file = normalize_macos_temp_alias(args.result_file)
    if not args.command or args.command[0] != "--" or len(args.command) == 1:
        parser.error("a command after -- is required")
    artifact_values = (args.cwd, args.cwd_file, args.stdin_file, args.stdout_file, args.stderr_file)
    explicit_artifacts = any(artifact_values)
    if explicit_artifacts and not all(artifact_values):
        parser.error("--cwd, --cwd-file, --stdin-file, --stdout-file, and --stderr-file must be supplied together")
    supplied_paths = (args.result_file, *(value for value in (*artifact_values, args.cancel_file) if value is not None))
    if any(not path.is_absolute() or has_linked_component(path) for path in supplied_paths):
        parser.error("runner paths must be absolute and must not traverse symlinks")
    working_directory = (args.cwd or Path.cwd()).resolve(strict=True)
    for cancellation_signal in (signal.SIGINT, signal.SIGTERM):
        signal.signal(cancellation_signal, signal_cancel)
    emit("START", args.label)
    with tempfile.TemporaryDirectory(prefix="lazybuddy-bounded-") as temporary:
        temporary_root = Path(temporary)
        stdin_path, stdout_path, stderr_path = (
            value or temporary_root / name
            for value, name in ((args.stdin_file, "stdin"), (args.stdout_file, "stdout"), (args.stderr_file, "stderr"))
        )
        if args.stdin_file is not None and not stdin_path.is_file():
            parser.error("--stdin-file must be a regular file")
        if args.cwd_file is not None:
            args.cwd_file.write_text(f"{working_directory}\n", encoding="utf-8")
        try:
            fingerprint = executable_fingerprint(args.command[1], working_directory)
        except (OSError, ValueError) as error:
            write_result(args.result_file, {"status": "unavailable", "reason": "launch_error", "tail": str(error)[-TAIL_BYTES:]})
            emit("FAIL", args.label)
            return 125
        with ExitStack() as resources:
            stdin_handle = resources.enter_context(stdin_path.open("rb")) if args.stdin_file is not None else None
            stdout_handle = resources.enter_context(stdout_path.open("wb"))
            stderr_handle = resources.enter_context(stderr_path.open("wb"))
            try:
                process = subprocess.Popen(
                    args.command[1:], cwd=working_directory, stdin=stdin_handle,
                    stdout=stdout_handle, stderr=stderr_handle, start_new_session=True,
                )
            except OSError as error:
                write_result(args.result_file, {"status": "unavailable", "reason": "launch_error", "tail": str(error)[-TAIL_BYTES:]})
                emit("FAIL", args.label)
                return 125
            tracker = establish_tracker(process)
            child = wait_for_child(
                process,
                tracker,
                (stdout_path, stderr_path),
                time.monotonic() + args.timeout,
                args.max_output_bytes,
                args.cancel_file,
            )
        cleanup_receipt = cleanup_owned_processes(child.tracker, inspect_processes, signal_owned_group)
        cleanup: dict[str, object] = cleanup_receipt.as_json()
        cleanup["process_group_terminated"] = cleanup_receipt.status is CleanupStatus.VERIFIED_ABSENT
        cleanup["detectable_descendants_remaining"] = cleanup_receipt.status is not CleanupStatus.VERIFIED_ABSENT
        cleanup["detectable_descendant_pids"] = list(cleanup_receipt.tracked_pids)
        if child.status is not ChildStatus.EXITED and cleanup_receipt.status is CleanupStatus.VERIFIED_ABSENT:
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                cleanup_receipt = CleanupReceipt(
                    CleanupStatus.VERIFIED_REMAINING,
                    cleanup_receipt.tracked_pids,
                    "direct child was not reaped after verified cleanup",
                )
                cleanup = cleanup_receipt.as_json()
                cleanup["process_group_terminated"] = False
                cleanup["detectable_descendants_remaining"] = True
                cleanup["detectable_descendant_pids"] = list(cleanup_receipt.tracked_pids)
        output_complete = output_within_cap((stdout_path, stderr_path), args.max_output_bytes)
        enforce_output_cap((stdout_path, stderr_path), args.max_output_bytes)
        tail = output_tail(stdout_path, stderr_path)
        if explicit_artifacts:
            artifacts = {"cwd": str(args.cwd_file), "stdin": str(stdin_path), "stdout": str(stdout_path), "stderr": str(stderr_path)}
        try:
            current_fingerprint = executable_fingerprint(args.command[1], working_directory)
        except (OSError, ValueError):
            current_fingerprint = {}
        if cleanup_receipt.status is not CleanupStatus.VERIFIED_ABSENT:
            result: dict[str, object] = {"status": "unavailable", "reason": "process_cleanup_failed", "tail": tail, "cleanup": cleanup}
            exit_code, event = 125, "FAIL"
        elif current_fingerprint != fingerprint:
            result: dict[str, object] = {"status": "unavailable", "reason": "executable_changed", "tail": tail}
            exit_code, event = 125, "FAIL"
        elif not output_complete or child.status is ChildStatus.OUTPUT_LIMIT:
            result = {"status": "fail", "reason": "output_limit_exceeded", "tail": tail, "cleanup": cleanup}
            exit_code, event = 1, "FAIL"
        elif child.status is ChildStatus.CANCELLED:
            result = {"status": "cancelled", "reason": "cancellation_requested", "tail": tail, "cleanup": cleanup}
            exit_code, event = 130, "CANCELLED"
        elif child.status is ChildStatus.TIMEOUT:
            result = {"status": "timeout", "reason": "deadline_exceeded", "tail": tail, "cleanup": cleanup}
            exit_code, event = 124, "TIMEOUT"
        elif child.status is ChildStatus.EXITED and child.returncode == 0:
            result = {"status": "pass", "reason": "ok", "tail": tail}
            exit_code, event = 0, "PASS"
        elif child.status is ChildStatus.EXITED:
            returncode = child.returncode if child.returncode is not None else 1
            result = {"status": "fail", "reason": f"exit_{returncode}", "tail": tail}
            exit_code, event = returncode if returncode > 0 else 1, "FAIL"
        else:
            result = {"status": "unavailable", "reason": "invalid_lifecycle_state", "tail": tail}
            exit_code, event = 125, "FAIL"
        result["cleanup"] = cleanup
        if explicit_artifacts:
            result["artifacts"] = artifacts
            result["executable"] = fingerprint
        write_result(args.result_file, result)
        emit(event, args.label)
        detectable = str(cleanup["detectable_descendants_remaining"]).lower()
        print(
            f"CLEANUP: {args.label} status={cleanup_receipt.status.value} "
            f"detectable_descendants_remaining={detectable}",
            file=sys.stderr,
            flush=True,
        )
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
