from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, TypeAlias, assert_never


SCHEMA_VERSION: Final = "lazybuddy.launch-supervisor.v1"
ACK_SCHEMA_VERSION: Final = "lazybuddy.launch-supervisor-ack.v1"
JSONScalar: TypeAlias = str | int
JSONValue: TypeAlias = JSONScalar | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


class SupervisorState(StrEnum):
    READY = "ready"
    RUNNING = "running"
    EXITED = "exited"
    LAUNCH_FAILED = "launch-failed"


@dataclass(frozen=True, slots=True)
class SupervisorStatus:
    state: SupervisorState
    supervisor_pid: int
    supervisor_pgid: int
    child_pid: int | None = None
    returncode: int | None = None
    detail: str = ""

    def as_json(self) -> dict[str, JSONScalar]:
        value: dict[str, JSONScalar] = {
            "schema_version": SCHEMA_VERSION,
            "state": self.state.value,
            "supervisor_pid": self.supervisor_pid,
            "supervisor_pgid": self.supervisor_pgid,
        }
        if self.child_pid is not None:
            value["child_pid"] = self.child_pid
        if self.returncode is not None:
            value["returncode"] = self.returncode
        if self.detail:
            value["detail"] = self.detail
        return value


@dataclass(frozen=True, slots=True)
class SupervisorAck:
    supervisor_pid: int
    supervisor_pgid: int
    started: str

    def as_json(self) -> dict[str, JSONScalar]:
        return {
            "schema_version": ACK_SCHEMA_VERSION,
            "supervisor_pid": self.supervisor_pid,
            "supervisor_pgid": self.supervisor_pgid,
            "started": self.started,
        }


class SupervisorStatusError(ValueError):
    pass


def _read_json(path: Path, label: str) -> JSONValue:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SupervisorStatusError(f"{label} is unreadable") from error


def _write_json(path: Path, value: dict[str, JSONScalar]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise


def parse_status(path: Path) -> SupervisorStatus | None:
    value = _read_json(path, "supervisor status")
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        raise SupervisorStatusError("supervisor status schema is invalid")
    try:
        state = SupervisorState(value.get("state"))
    except (TypeError, ValueError) as error:
        raise SupervisorStatusError("supervisor state is invalid") from error
    child_pid = value.get("child_pid")
    returncode = value.get("returncode")
    detail = value.get("detail", "")
    supervisor_pid = value.get("supervisor_pid")
    supervisor_pgid = value.get("supervisor_pgid")
    if (
        isinstance(supervisor_pid, bool)
        or not isinstance(supervisor_pid, int)
        or isinstance(supervisor_pgid, bool)
        or not isinstance(supervisor_pgid, int)
        or supervisor_pid <= 0
        or supervisor_pgid <= 0
    ):
        raise SupervisorStatusError("supervisor identity is invalid")
    if isinstance(child_pid, bool) or (child_pid is not None and not isinstance(child_pid, int)):
        raise SupervisorStatusError("supervisor child PID is invalid")
    if isinstance(returncode, bool) or (returncode is not None and not isinstance(returncode, int)):
        raise SupervisorStatusError("supervisor return code is invalid")
    if not isinstance(detail, str):
        raise SupervisorStatusError("supervisor detail is invalid")
    match state:
        case SupervisorState.READY:
            if child_pid is not None or returncode is not None or detail:
                raise SupervisorStatusError("ready supervisor status is invalid")
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
    return SupervisorStatus(state, supervisor_pid, supervisor_pgid, child_pid, returncode, detail)


def write_status(path: Path, status: SupervisorStatus) -> None:
    _write_json(path, status.as_json())


def parse_ack(path: Path) -> SupervisorAck | None:
    value = _read_json(path, "supervisor acknowledgement")
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("schema_version") != ACK_SCHEMA_VERSION:
        raise SupervisorStatusError("supervisor acknowledgement schema is invalid")
    supervisor_pid = value.get("supervisor_pid")
    supervisor_pgid = value.get("supervisor_pgid")
    started = value.get("started")
    if (
        isinstance(supervisor_pid, bool)
        or not isinstance(supervisor_pid, int)
        or isinstance(supervisor_pgid, bool)
        or not isinstance(supervisor_pgid, int)
        or not isinstance(started, str)
        or not started
    ):
        raise SupervisorStatusError("supervisor acknowledgement identity is invalid")
    return SupervisorAck(supervisor_pid, supervisor_pgid, started)


def write_ack(path: Path, ack: SupervisorAck) -> None:
    _write_json(path, ack.as_json())
