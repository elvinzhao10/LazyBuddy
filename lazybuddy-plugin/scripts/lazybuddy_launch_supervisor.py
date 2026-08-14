#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 lazybuddy_launch_supervisor.py --status-file <absolute-path> -- <command> [args...]
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from types import FrameType
from typing import Final, Never, assert_never


SCHEMA_VERSION: Final = "lazybuddy.launch-supervisor.v1"


class SupervisorState(StrEnum):
    RUNNING = "running"
    EXITED = "exited"
    LAUNCH_FAILED = "launch-failed"


@dataclass(frozen=True, slots=True)
class SupervisorStatus:
    state: SupervisorState
    child_pid: int | None = None
    returncode: int | None = None
    detail: str = ""

    def as_json(self) -> dict[str, str | int]:
        value: dict[str, str | int] = {
            "schema_version": SCHEMA_VERSION,
            "state": self.state.value,
        }
        if self.child_pid is not None:
            value["child_pid"] = self.child_pid
        if self.returncode is not None:
            value["returncode"] = self.returncode
        if self.detail:
            value["detail"] = self.detail
        return value


class SupervisorStatusError(ValueError):
    pass


def parse_status(path: Path) -> SupervisorStatus | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SupervisorStatusError("supervisor status is unreadable") from error
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        raise SupervisorStatusError("supervisor status schema is invalid")
    try:
        state = SupervisorState(value.get("state"))
    except (TypeError, ValueError) as error:
        raise SupervisorStatusError("supervisor state is invalid") from error
    child_pid = value.get("child_pid")
    returncode = value.get("returncode")
    detail = value.get("detail", "")
    if isinstance(child_pid, bool) or (child_pid is not None and not isinstance(child_pid, int)):
        raise SupervisorStatusError("supervisor child PID is invalid")
    if isinstance(returncode, bool) or (returncode is not None and not isinstance(returncode, int)):
        raise SupervisorStatusError("supervisor return code is invalid")
    if not isinstance(detail, str):
        raise SupervisorStatusError("supervisor detail is invalid")
    match state:
        case SupervisorState.RUNNING:
            if child_pid is None or returncode is not None:
                raise SupervisorStatusError("running supervisor status is incomplete")
        case SupervisorState.EXITED:
            if child_pid is None or returncode is None:
                raise SupervisorStatusError("exited supervisor status is incomplete")
        case SupervisorState.LAUNCH_FAILED:
            if child_pid is not None or returncode is not None or not detail:
                raise SupervisorStatusError("launch failure status is incomplete")
        case unreachable:
            assert_never(unreachable)
    return SupervisorStatus(state, child_pid, returncode, detail)


def write_status(path: Path, status: SupervisorStatus) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(status.as_json(), ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise


def terminate_owned_group(_number: int, _frame: FrameType | None) -> None:
    os.killpg(os.getpgrp(), signal.SIGKILL)


def wait_for_teardown(teardown_file: Path) -> Never:
    while True:
        if teardown_file.exists():
            os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(0.01)


def supervise(child: subprocess.Popen[bytes], status_file: Path, teardown_file: Path) -> Never:
    write_status(status_file, SupervisorStatus(SupervisorState.RUNNING, child_pid=child.pid))
    terminal_written = False
    while True:
        returncode = child.poll()
        if returncode is not None and not terminal_written:
            write_status(
                status_file,
                SupervisorStatus(SupervisorState.EXITED, child_pid=child.pid, returncode=returncode),
            )
            terminal_written = True
        if teardown_file.exists():
            os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(0.01)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status-file", required=True, type=Path)
    parser.add_argument("--teardown-file", required=True, type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command or args.command[0] != "--" or len(args.command) == 1:
        parser.error("a command after -- is required")
    if any(not path.is_absolute() or path.parent.is_symlink() for path in (args.status_file, args.teardown_file)):
        parser.error("supervisor control paths must be absolute non-symlink paths")
    if os.getpid() != os.getpgrp():
        write_status(
            args.status_file,
            SupervisorStatus(SupervisorState.LAUNCH_FAILED, detail="supervisor is not its process-group leader"),
        )
        return 125
    signal.signal(signal.SIGTERM, terminate_owned_group)
    try:
        child = subprocess.Popen(args.command[1:])
    except OSError as error:
        write_status(args.status_file, SupervisorStatus(SupervisorState.LAUNCH_FAILED, detail=str(error)))
        wait_for_teardown(args.teardown_file)
    supervise(child, args.status_file, args.teardown_file)


if __name__ == "__main__":
    raise SystemExit(main())
