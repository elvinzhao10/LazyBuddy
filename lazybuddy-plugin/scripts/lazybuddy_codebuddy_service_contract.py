from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Final, TypeAlias, TypeVar, assert_never

from lazybuddy_process_lifecycle import CleanupReceipt, CleanupStatus, ProcessRecord


SCHEMA_VERSION: Final = "lazybuddy.codebuddy-service.v1"
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]
EnumValue = TypeVar("EnumValue", bound=StrEnum)


class ServiceKind(StrEnum):
    DAEMON = "daemon"
    BACKGROUND = "background"
    SERVE = "serve"
    PREWARM = "prewarm"


class ServiceStatus(StrEnum):
    RUNNING = "running"
    STOPPED = "stopped"


class SessionMode(StrEnum):
    PERSISTENT = "persistent"
    EPHEMERAL = "ephemeral"


class EndpointTransport(StrEnum):
    HTTP = "http"
    UNIX = "unix"


@dataclass(frozen=True, slots=True)
class Endpoint:
    transport: EndpointTransport
    value: str

    def as_json(self) -> dict[str, JSONValue]:
        return {"transport": self.transport.value, "value": self.value}


@dataclass(frozen=True, slots=True)
class ServicePaths:
    status: Path
    ack: Path
    teardown: Path
    handoff: Path
    stdout: Path
    stderr: Path


@dataclass(frozen=True, slots=True)
class ServiceReceipt:
    service_id: str
    kind: ServiceKind
    name: str
    status: ServiceStatus
    session_mode: SessionMode
    cwd: Path
    executable_path: Path
    executable_digest: str
    supervisor: ProcessRecord
    child_pid: int
    paths: ServicePaths
    endpoint: Endpoint | None
    activation_count: int = 0
    session_id: str | None = None
    cleanup: CleanupReceipt | None = None

    def stopped(self, cleanup: CleanupReceipt) -> ServiceReceipt:
        return replace(self, status=ServiceStatus.STOPPED, cleanup=cleanup)

    def activated(self, endpoint: Endpoint, session_id: str) -> ServiceReceipt:
        return replace(self, endpoint=endpoint, activation_count=1, session_id=session_id)

    def as_json(self) -> dict[str, JSONValue]:
        cleanup = self.cleanup.as_json() if self.cleanup is not None else None
        endpoint = self.endpoint.as_json() if self.endpoint is not None else None
        return {
            "schema_version": SCHEMA_VERSION,
            "service_id": self.service_id,
            "kind": self.kind.value,
            "name": self.name,
            "status": self.status.value,
            "session_mode": self.session_mode.value,
            "cwd": str(self.cwd),
            "executable": {"path": str(self.executable_path), "digest": self.executable_digest},
            "supervisor": {
                "pid": self.supervisor.pid,
                "pgid": self.supervisor.group_id,
                "started": self.supervisor.started,
            },
            "child_pid": self.child_pid,
            "controls": {
                "status": str(self.paths.status),
                "ack": str(self.paths.ack),
                "teardown": str(self.paths.teardown),
                "handoff": str(self.paths.handoff),
            },
            "logs": {"stdout": str(self.paths.stdout), "stderr": str(self.paths.stderr)},
            "endpoint": endpoint,
            "activation_count": self.activation_count,
            "session_id": self.session_id,
            "cleanup": cleanup,
        }


class ReceiptError(ValueError):
    pass


def _mapping(value: JSONValue, keys: set[str]) -> dict[str, JSONValue]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ReceiptError
    return value


def _string(value: JSONValue | None) -> str:
    if not isinstance(value, str) or not value:
        raise ReceiptError
    return value


def _positive(value: JSONValue | None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ReceiptError
    return value


def _enum(enum_type: type[EnumValue], value: JSONValue | None) -> EnumValue:
    try:
        return enum_type(_string(value))
    except ValueError as error:
        raise ReceiptError from error


def _owned_path(value: JSONValue | None, root: Path) -> Path:
    path = Path(_string(value))
    if not path.is_absolute():
        raise ReceiptError
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ReceiptError from error
    current = path
    while current != root:
        if current.exists() and current.is_symlink():
            raise ReceiptError
        current = current.parent
    return path


def _cleanup(value: JSONValue) -> CleanupReceipt | None:
    if value is None:
        return None
    mapping = _mapping(value, {"status", "tracked_pids", "detail"})
    tracked = mapping["tracked_pids"]
    if not isinstance(tracked, list) or any(isinstance(pid, bool) or not isinstance(pid, int) for pid in tracked):
        raise ReceiptError
    return CleanupReceipt(
        _enum(CleanupStatus, mapping["status"]),
        tuple(tracked),
        _string(mapping["detail"]) if mapping["detail"] else "",
    )


def parse_receipt(path: Path, root: Path) -> ServiceReceipt:
    try:
        value: JSONValue = json.loads(path.read_text(encoding="utf-8"))
        mapping = _mapping(value, {
            "schema_version", "service_id", "kind", "name", "status", "session_mode", "cwd",
            "executable", "supervisor", "child_pid", "controls", "logs", "endpoint",
            "activation_count", "session_id", "cleanup",
        })
        if mapping["schema_version"] != SCHEMA_VERSION:
            raise ReceiptError
        executable = _mapping(mapping["executable"], {"path", "digest"})
        supervisor = _mapping(mapping["supervisor"], {"pid", "pgid", "started"})
        controls = _mapping(mapping["controls"], {"status", "ack", "teardown", "handoff"})
        logs = _mapping(mapping["logs"], {"stdout", "stderr"})
        endpoint_value = mapping["endpoint"]
        endpoint = None
        if endpoint_value is not None:
            endpoint_mapping = _mapping(endpoint_value, {"transport", "value"})
            transport = _enum(EndpointTransport, endpoint_mapping["transport"])
            raw_endpoint = _string(endpoint_mapping["value"])
            endpoint = Endpoint(
                transport,
                str(_owned_path(raw_endpoint, root)) if transport is EndpointTransport.UNIX else raw_endpoint,
            )
        activation_count = mapping["activation_count"]
        session_id = mapping["session_id"]
        if isinstance(activation_count, bool) or not isinstance(activation_count, int) or activation_count not in (0, 1):
            raise ReceiptError
        if session_id is not None and not isinstance(session_id, str):
            raise ReceiptError
        receipt = ServiceReceipt(
            _string(mapping["service_id"]), _enum(ServiceKind, mapping["kind"]), _string(mapping["name"]),
            _enum(ServiceStatus, mapping["status"]), _enum(SessionMode, mapping["session_mode"]),
            Path(_string(mapping["cwd"])), Path(_string(executable["path"])), _string(executable["digest"]),
            ProcessRecord(_positive(supervisor["pid"]), 0, _positive(supervisor["pgid"]), "?", _string(supervisor["started"])),
            _positive(mapping["child_pid"]),
            ServicePaths(
                _owned_path(controls["status"], root), _owned_path(controls["ack"], root),
                _owned_path(controls["teardown"], root), _owned_path(controls["handoff"], root),
                _owned_path(logs["stdout"], root), _owned_path(logs["stderr"], root),
            ),
            endpoint, activation_count, session_id, _cleanup(mapping["cleanup"]),
        )
        if receipt.activation_count == 0 and receipt.session_id is not None:
            raise ReceiptError
        if receipt.activation_count == 1 and receipt.session_id is None:
            raise ReceiptError
        if receipt.status is ServiceStatus.RUNNING and receipt.cleanup is not None:
            raise ReceiptError
        if (
            receipt.status is ServiceStatus.STOPPED
            and (receipt.cleanup is None or receipt.cleanup.status is not CleanupStatus.VERIFIED_ABSENT)
        ):
            raise ReceiptError
    except (OSError, UnicodeError, json.JSONDecodeError, ReceiptError, TypeError) as error:
        raise ReceiptError from error
    return receipt


def write_receipt(path: Path, receipt: ServiceReceipt) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(receipt.as_json(), ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise


def describe_kind(kind: ServiceKind) -> str:
    match kind:
        case ServiceKind.DAEMON:
            return "daemon worker"
        case ServiceKind.BACKGROUND:
            return "named background session"
        case ServiceKind.SERVE:
            return "loopback serve endpoint"
        case ServiceKind.PREWARM:
            return "one-shot prewarm IPC"
        case unreachable:
            assert_never(unreachable)
