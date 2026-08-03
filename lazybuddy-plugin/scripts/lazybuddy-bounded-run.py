#!/usr/bin/env python3
# allow: SIZE_OK — bounded process state and PID-safe cleanup share ownership invariants.
from __future__ import annotations

import argparse
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Final


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
    path.write_text(json.dumps(result, ensure_ascii=False) + "\n", encoding="utf-8")


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


@dataclass(frozen=True)
class ProcessRecord:
    pid: int
    parent_pid: int
    group_id: int
    state: str
    started: str


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


def descendant_records(root_pid: int) -> tuple[ProcessRecord, ...]:
    records = process_records()
    children: dict[int, list[ProcessRecord]] = {}
    for record in records.values():
        children.setdefault(record.parent_pid, []).append(record)
    descendants: list[ProcessRecord] = []
    pending = list(children.get(root_pid, []))
    while pending:
        record = pending.pop()
        descendants.append(record)
        pending.extend(children.get(record.pid, []))
    return tuple(descendants)


def is_same_process(record: ProcessRecord, records: dict[int, ProcessRecord]) -> bool:
    current = records.get(record.pid)
    return current is not None and not current.state.startswith("Z") and current.started == record.started


def terminate_owned_group(process: subprocess.Popen[bytes]) -> dict[str, object]:
    inspection_failed = False
    try:
        descendants = descendant_records(process.pid)
    except (OSError, subprocess.SubprocessError):
        descendants = ()
        inspection_failed = True
    for group_signal, wait_seconds in ((signal.SIGTERM, 0.2), (signal.SIGKILL, 1.0)):
        try:
            os.killpg(process.pid, group_signal)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=wait_seconds)
        except subprocess.TimeoutExpired:
            pass
    try:
        current_records = process_records()
    except (OSError, subprocess.SubprocessError):
        current_records = {}
        inspection_failed = True
    remaining = [record.pid for record in descendants if is_same_process(record, current_records)]
    return {
        "process_group_terminated": True,
        "detectable_descendants_remaining": inspection_failed or bool(remaining),
        "detectable_descendant_pids": sorted(remaining),
    }


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


def drain_process(
    process: subprocess.Popen[bytes], outputs: tuple[BinaryIO, BinaryIO],
    deadline: float, output_cap: int, cancel_file: Path | None,
) -> str:
    counts = {"stdout": 0, "stderr": 0}
    selector = selectors.DefaultSelector()
    streams = (("stdout", process.stdout, outputs[0]), ("stderr", process.stderr, outputs[1]))
    try:
        for name, stream, target in streams:
            if stream is None:
                raise OSError(f"{name} pipe unavailable")
            selector.register(stream, selectors.EVENT_READ, (name, target))
        while selector.get_map() or process.poll() is None:
            if cancel_signal_received or (cancel_file is not None and cancel_file.exists()):
                return "cancelled"
            if time.monotonic() >= deadline:
                return "timeout"
            for key, _mask in selector.select(min(0.05, max(0.0, deadline - time.monotonic()))):
                name, target = key.data
                chunk = os.read(key.fileobj.fileno(), READ_BYTES)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                counts[name] += len(chunk)
                remaining = max(0, output_cap - (counts[name] - len(chunk)))
                target.write(chunk[:remaining])
                target.flush()
                if counts[name] > output_cap:
                    return "output-limit"
        process.wait(timeout=1)
        return "complete"
    finally:
        selector.close()


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
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
                )
            except OSError as error:
                write_result(args.result_file, {"status": "unavailable", "reason": "launch_error", "tail": str(error)[-TAIL_BYTES:]})
                emit("FAIL", args.label)
                return 125
            outcome = drain_process(process, (stdout_handle, stderr_handle), time.monotonic() + args.timeout, args.max_output_bytes, args.cancel_file)
        cleanup: dict[str, object] | None = None
        if outcome != "complete":
            cleanup = terminate_owned_group(process)
        tail = output_tail(stdout_path, stderr_path)
        if explicit_artifacts:
            artifacts = {"cwd": str(args.cwd_file), "stdin": str(stdin_path), "stdout": str(stdout_path), "stderr": str(stderr_path)}
        try:
            current_fingerprint = executable_fingerprint(args.command[1], working_directory)
        except (OSError, ValueError):
            current_fingerprint = {}
        if current_fingerprint != fingerprint:
            result: dict[str, object] = {"status": "unavailable", "reason": "executable_changed", "tail": tail}
            exit_code, event = 125, "FAIL"
        elif outcome == "cancelled":
            result = {"status": "cancelled", "reason": "cancellation_requested", "tail": tail, "cleanup": cleanup}
            exit_code, event = 130, "CANCELLED"
        elif outcome == "timeout":
            result = {"status": "timeout", "reason": "deadline_exceeded", "tail": tail, "cleanup": cleanup}
            exit_code, event = 124, "TIMEOUT"
        elif outcome == "output-limit":
            result = {"status": "fail", "reason": "output_limit_exceeded", "tail": tail, "cleanup": cleanup}
            exit_code, event = 1, "FAIL"
        elif process.returncode == 0:
            result = {"status": "pass", "reason": "ok", "tail": tail}
            exit_code, event = 0, "PASS"
        else:
            result = {"status": "fail", "reason": f"exit_{process.returncode}", "tail": tail}
            exit_code, event = process.returncode if process.returncode > 0 else 1, "FAIL"
        if explicit_artifacts:
            result["artifacts"] = artifacts
            result["executable"] = fingerprint
        write_result(args.result_file, result)
        emit(event, args.label)
        if cleanup is not None:
            detectable = str(cleanup["detectable_descendants_remaining"]).lower()
            print(f"CLEANUP: {args.label} detectable_descendants_remaining={detectable}", file=sys.stderr, flush=True)
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
