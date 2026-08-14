from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from lazybuddy_bounded_process import (
    ChildOutcome,
    ChildStatus,
    Inspector,
    OutputBoundary,
    SupervisorHandle,
    WaitBoundary,
    await_supervisor_ready,
    wait_for_child,
)
from lazybuddy_supervisor_contract import SupervisorAck, write_ack


@dataclass(frozen=True, slots=True)
class SupervisorLaunch:
    executable: Path
    status_file: Path
    ack_file: Path
    teardown_file: Path
    parent_pid: int
    ack_timeout: int
    command: tuple[str, ...]
    cwd: Path

    def start(self, stdin: BinaryIO | None, stdout: BinaryIO, stderr: BinaryIO) -> subprocess.Popen[bytes]:
        return subprocess.Popen(
            [
                sys.executable,
                str(self.executable),
                "--status-file",
                str(self.status_file),
                "--ack-file",
                str(self.ack_file),
                "--teardown-file",
                str(self.teardown_file),
                "--parent-pid",
                str(self.parent_pid),
                "--ack-timeout",
                str(self.ack_timeout),
                "--",
                *self.command,
            ],
            cwd=self.cwd,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )


@dataclass(frozen=True, slots=True)
class SupervisorRuntime:
    process: subprocess.Popen[bytes]
    status_file: Path
    ack_file: Path
    inspector: Inspector

    def wait(self, output: OutputBoundary, boundary: WaitBoundary) -> ChildOutcome:
        handshake = await_supervisor_ready(
            self.process,
            self.status_file,
            self.inspector,
            boundary.deadline,
        )
        if handshake.ready is None:
            return ChildOutcome(ChildStatus.SUPERVISOR_FAILURE, None, handshake.tracker, handshake.detail)
        try:
            write_ack(
                self.ack_file,
                SupervisorAck(
                    handshake.ready.supervisor_pid,
                    handshake.ready.supervisor_pgid,
                    handshake.tracker.root.started,
                ),
            )
        except OSError as error:
            return ChildOutcome(ChildStatus.SUPERVISOR_FAILURE, None, handshake.tracker, str(error))
        return wait_for_child(
            SupervisorHandle(self.process, handshake.tracker, self.status_file, self.inspector),
            output,
            boundary,
        )
