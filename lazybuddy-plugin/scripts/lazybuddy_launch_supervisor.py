#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 lazybuddy_launch_supervisor.py --status-file <path> --ack-file <path> --teardown-file <path> -- <command>
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import time
from pathlib import Path
from types import FrameType
from typing import Never

from lazybuddy_supervisor_contract import (
    SupervisorAck,
    SupervisorState,
    SupervisorStatus,
    SupervisorStatusError,
    parse_ack,
    write_status,
)


def terminate_owned_group(_number: int, _frame: FrameType | None) -> None:
    os.killpg(os.getpgrp(), signal.SIGKILL)


def wait_for_teardown(teardown_file: Path) -> Never:
    while True:
        if teardown_file.exists():
            os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(0.01)


def fail_closed(status_file: Path, status: SupervisorStatus) -> Never:
    try:
        write_status(status_file, status)
    finally:
        os.killpg(os.getpgrp(), signal.SIGTERM)


def wait_for_ack(
    ack_file: Path,
    teardown_file: Path,
    expected_pid: int,
    expected_pgid: int,
    expected_parent_pid: int,
    deadline: float,
) -> SupervisorAck:
    while True:
        if os.getppid() != expected_parent_pid:
            raise SupervisorStatusError("supervisor parent identity changed before acknowledgement")
        if teardown_file.exists():
            os.killpg(os.getpgrp(), signal.SIGTERM)
        ack = parse_ack(ack_file)
        if ack is not None:
            if ack.supervisor_pid != expected_pid or ack.supervisor_pgid != expected_pgid:
                raise SupervisorStatusError("supervisor acknowledgement identity is stale")
            return ack
        if time.monotonic() >= deadline:
            raise SupervisorStatusError("supervisor acknowledgement timed out")
        time.sleep(0.01)


def supervise(
    child: subprocess.Popen[bytes],
    status_file: Path,
    teardown_file: Path,
    supervisor_pid: int,
    supervisor_pgid: int,
    expected_parent_pid: int,
    handoff_file: Path | None,
) -> Never:
    write_status(
        status_file,
        SupervisorStatus(SupervisorState.RUNNING, supervisor_pid, supervisor_pgid, child_pid=child.pid),
    )
    terminal_written = False
    handed_off = False
    while True:
        if handoff_file is not None and handoff_file.exists():
            handed_off = True
        if not handed_off and os.getppid() != expected_parent_pid:
            os.killpg(os.getpgrp(), signal.SIGTERM)
        returncode = child.poll()
        if returncode is not None and not terminal_written:
            write_status(
                status_file,
                SupervisorStatus(
                    SupervisorState.EXITED,
                    supervisor_pid,
                    supervisor_pgid,
                    child_pid=child.pid,
                    returncode=returncode,
                ),
            )
            terminal_written = True
        if teardown_file.exists():
            os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(0.01)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status-file", required=True, type=Path)
    parser.add_argument("--ack-file", required=True, type=Path)
    parser.add_argument("--teardown-file", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    parser.add_argument("--ack-timeout", required=True, type=float)
    parser.add_argument("--handoff-file", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command or args.command[0] != "--" or len(args.command) == 1:
        parser.error("a command after -- is required")
    if args.ack_timeout <= 0 or args.parent_pid <= 0:
        parser.error("--ack-timeout must be positive")
    if any(
        not path.is_absolute() or path.parent.is_symlink()
        for path in (args.status_file, args.ack_file, args.teardown_file, args.handoff_file)
        if path is not None
    ):
        parser.error("supervisor control paths must be absolute non-symlink paths")
    supervisor_pid = os.getpid()
    supervisor_pgid = os.getpgrp()
    if os.getpid() != os.getpgrp():
        write_status(
            args.status_file,
            SupervisorStatus(
                SupervisorState.LAUNCH_FAILED,
                supervisor_pid,
                supervisor_pgid,
                detail="supervisor is not its process-group leader",
            ),
        )
        return 125
    signal.signal(signal.SIGTERM, terminate_owned_group)
    if os.getppid() != args.parent_pid:
        fail_closed(
            args.status_file,
            SupervisorStatus(
                SupervisorState.LAUNCH_FAILED,
                supervisor_pid,
                supervisor_pgid,
                detail="supervisor parent identity changed before ready",
            ),
        )
    write_status(
        args.status_file,
        SupervisorStatus(SupervisorState.READY, supervisor_pid, supervisor_pgid),
    )
    try:
        wait_for_ack(
            args.ack_file,
            args.teardown_file,
            supervisor_pid,
            supervisor_pgid,
            args.parent_pid,
            time.monotonic() + args.ack_timeout,
        )
    except SupervisorStatusError as error:
        fail_closed(
            args.status_file,
            SupervisorStatus(
                SupervisorState.LAUNCH_FAILED,
                supervisor_pid,
                supervisor_pgid,
                detail=str(error),
            ),
        )
    try:
        child = subprocess.Popen(args.command[1:])
    except OSError as error:
        write_status(
            args.status_file,
            SupervisorStatus(
                SupervisorState.LAUNCH_FAILED,
                supervisor_pid,
                supervisor_pgid,
                detail=str(error),
            ),
        )
        wait_for_teardown(args.teardown_file)
    supervise(
        child,
        args.status_file,
        args.teardown_file,
        supervisor_pid,
        supervisor_pgid,
        args.parent_pid,
        args.handoff_file,
    )


if __name__ == "__main__":
    raise SystemExit(main())
