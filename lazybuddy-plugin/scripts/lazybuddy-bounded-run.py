#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path
from types import FrameType
from typing import Final, TypeAlias, assert_never

from lazybuddy_bounded_process import (
    TAIL_BYTES,
    ChildStatus,
    OutputBoundary,
    SupervisorHandle,
    WaitBoundary,
    establish_tracker,
    executable_fingerprint,
    inspect_processes,
    signal_owned_group,
    wait_for_child,
)
from lazybuddy_process_lifecycle import (
    CleanupReceipt,
    CleanupStatus,
    cleanup_owned_processes,
)


DEFAULT_OUTPUT_CAP: Final = 1024 * 1024
cancel_signal_received = False
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


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


def write_result(path: Path, result: dict[str, JSONValue]) -> None:
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


def signal_cancel(_number: int, _frame: FrameType | None) -> None:
    global cancel_signal_received
    cancel_signal_received = True


def cancellation_requested() -> bool:
    return cancel_signal_received


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
        supervisor_status_path = temporary_root / "supervisor-status.json"
        supervisor_teardown_path = temporary_root / "supervisor-teardown"
        supervisor = Path(__file__).resolve().parent / "lazybuddy_launch_supervisor.py"
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
                    [
                        sys.executable,
                        str(supervisor),
                        "--status-file",
                        str(supervisor_status_path),
                        "--teardown-file",
                        str(supervisor_teardown_path),
                        "--",
                        *args.command[1:],
                    ], cwd=working_directory, stdin=stdin_handle,
                    stdout=stdout_handle, stderr=stderr_handle, start_new_session=True,
                )
            except OSError as error:
                write_result(args.result_file, {"status": "unavailable", "reason": "launch_error", "tail": str(error)[-TAIL_BYTES:]})
                emit("FAIL", args.label)
                return 125
            tracker = establish_tracker(process, inspect_processes)
            output = OutputBoundary(stdout_path, stderr_path, args.max_output_bytes)
            child = wait_for_child(
                SupervisorHandle(process, tracker, supervisor_status_path, inspect_processes),
                output,
                WaitBoundary(time.monotonic() + args.timeout, args.cancel_file, cancellation_requested),
            )
        cleanup_receipt = cleanup_owned_processes(child.tracker, inspect_processes, signal_owned_group)
        cleanup: dict[str, JSONValue] = {
            "status": cleanup_receipt.status.value,
            "tracked_pids": list(cleanup_receipt.tracked_pids),
            "detail": cleanup_receipt.detail,
        }
        cleanup["process_group_terminated"] = cleanup_receipt.status is CleanupStatus.VERIFIED_ABSENT
        cleanup["detectable_descendants_remaining"] = cleanup_receipt.status is not CleanupStatus.VERIFIED_ABSENT
        cleanup["detectable_descendant_pids"] = list(cleanup_receipt.tracked_pids)
        supervisor_teardown = "unverified"
        if process.poll() is None:
            supervisor_teardown_path.touch(exist_ok=False)
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            if cleanup_receipt.status is CleanupStatus.VERIFIED_ABSENT:
                cleanup_receipt = CleanupReceipt(
                    CleanupStatus.VERIFIED_REMAINING,
                    cleanup_receipt.tracked_pids,
                    "direct child was not reaped after verified cleanup",
                )
                cleanup = {
                    "status": cleanup_receipt.status.value,
                    "tracked_pids": list(cleanup_receipt.tracked_pids),
                    "detail": cleanup_receipt.detail,
                }
                cleanup["process_group_terminated"] = False
                cleanup["detectable_descendants_remaining"] = True
                cleanup["detectable_descendant_pids"] = list(cleanup_receipt.tracked_pids)
        else:
            supervisor_teardown = "verified-absent"
        cleanup["supervisor_status"] = child.status.value
        cleanup["supervisor_teardown"] = supervisor_teardown
        output_complete = output.within_cap()
        output.enforce_cap()
        tail = output.tail()
        artifacts: dict[str, JSONValue] = {}
        if explicit_artifacts:
            artifacts = {"cwd": str(args.cwd_file), "stdin": str(stdin_path), "stdout": str(stdout_path), "stderr": str(stderr_path)}
        try:
            current_fingerprint = executable_fingerprint(args.command[1], working_directory)
        except (OSError, ValueError):
            current_fingerprint = {}
        if cleanup_receipt.status is not CleanupStatus.VERIFIED_ABSENT:
            result: dict[str, JSONValue] = {"status": "unavailable", "reason": "process_cleanup_failed", "tail": tail, "cleanup": cleanup}
            exit_code, event = 125, "FAIL"
        elif current_fingerprint != fingerprint:
            result = {"status": "unavailable", "reason": "executable_changed", "tail": tail}
            exit_code, event = 125, "FAIL"
        elif not output_complete or child.status is ChildStatus.OUTPUT_LIMIT:
            result = {"status": "fail", "reason": "output_limit_exceeded", "tail": tail, "cleanup": cleanup}
            exit_code, event = 1, "FAIL"
        else:
            match child.status:
                case ChildStatus.CANCELLED:
                    result = {"status": "cancelled", "reason": "cancellation_requested", "tail": tail, "cleanup": cleanup}
                    exit_code, event = 130, "CANCELLED"
                case ChildStatus.TIMEOUT:
                    result = {"status": "timeout", "reason": "deadline_exceeded", "tail": tail, "cleanup": cleanup}
                    exit_code, event = 124, "TIMEOUT"
                case ChildStatus.LAUNCH_ERROR:
                    result = {"status": "unavailable", "reason": "launch_error", "tail": child.detail[-TAIL_BYTES:], "cleanup": cleanup}
                    exit_code, event = 125, "FAIL"
                case ChildStatus.SUPERVISOR_FAILURE:
                    result = {"status": "unavailable", "reason": "process_cleanup_failed", "tail": child.detail[-TAIL_BYTES:], "cleanup": cleanup}
                    exit_code, event = 125, "FAIL"
                case ChildStatus.EXITED:
                    returncode = child.returncode if child.returncode is not None else 1
                    if returncode == 0:
                        result = {"status": "pass", "reason": "ok", "tail": tail}
                        exit_code, event = 0, "PASS"
                    else:
                        result = {"status": "fail", "reason": f"exit_{returncode}", "tail": tail}
                        exit_code, event = returncode if returncode > 0 else 1, "FAIL"
                case ChildStatus.OUTPUT_LIMIT:
                    raise AssertionError("output-limit outcome bypassed the output decision")
                case unreachable:
                    assert_never(unreachable)
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
