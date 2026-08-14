from __future__ import annotations

import http.client
import ipaddress
import json
import os
import socket
import subprocess
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypeAlias, assert_never
from urllib.parse import urlsplit

from lazybuddy_bounded_process import executable_fingerprint, inspect_processes, signal_owned_group
from lazybuddy_process_lifecycle import (
    CleanupReceipt,
    CleanupStatus,
    InspectionAvailable,
    InspectionUnavailable,
    OwnershipTracker,
    ProcessRecord,
    cleanup_owned_processes,
)
from lazybuddy_supervisor_contract import SupervisorAck, SupervisorState, parse_status, write_ack
from lazybuddy_supervisor_runner import SupervisorLaunch
from lazybuddy_codebuddy_service_contract import Endpoint, EndpointTransport, ServicePaths, ServiceReceipt


HEALTH_BODY_CAP: Final = 16 * 1024
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


class ServiceRuntimeError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class HttpTarget:
    host: str
    port: int
    path: str
    value: str


@dataclass(frozen=True, slots=True)
class HttpHealth:
    status: int
    endpoint: str


@dataclass(frozen=True, slots=True)
class PrewarmHealth:
    status: str
    pid: int


@dataclass(frozen=True, slots=True)
class ActivationAck:
    status: str
    pid: int
    session_id: str
    cwd: Path
    endpoint: Endpoint


@dataclass(frozen=True, slots=True)
class PersistentLaunch:
    supervisor: Path
    paths: ServicePaths
    command: tuple[str, ...]
    cwd: Path
    timeout: int


@dataclass(frozen=True, slots=True)
class LaunchObservation:
    root: ProcessRecord
    child_pid: int


def http_target(value: str) -> HttpTarget:
    split = urlsplit(value)
    try:
        address = ipaddress.ip_address(split.hostname or "")
        port = split.port
    except ValueError as error:
        raise ServiceRuntimeError("invalid_endpoint") from error
    if split.scheme != "http" or not address.is_loopback or port is None or port < 1:
        raise ServiceRuntimeError("non_loopback_bind")
    if split.username is not None or split.password is not None or split.query or split.fragment:
        raise ServiceRuntimeError("invalid_endpoint")
    path = split.path or "/health"
    if path != "/health":
        raise ServiceRuntimeError("invalid_endpoint")
    return HttpTarget(str(address), port, path, value)


def http_health(endpoint: Endpoint, timeout: float = 0.5) -> HttpHealth:
    if endpoint.transport is not EndpointTransport.HTTP:
        raise ServiceRuntimeError("endpoint_transport_mismatch")
    target = http_target(endpoint.value)
    try:
        with closing(http.client.HTTPConnection(target.host, target.port, timeout=timeout)) as connection:
            connection.request("GET", target.path, headers={"Accept": "application/json"})
            response = connection.getresponse()
            body = response.read(HEALTH_BODY_CAP + 1)
    except (OSError, http.client.HTTPException) as error:
        raise ServiceRuntimeError("endpoint_unavailable") from error
    if len(body) > HEALTH_BODY_CAP:
        raise ServiceRuntimeError("health_output_limit")
    try:
        value: JSONValue = json.loads(body)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ServiceRuntimeError("malformed_health") from error
    if not isinstance(value, dict) or value.get("status") != "ok" or value.get("endpoint") != endpoint.value:
        raise ServiceRuntimeError("changed_endpoint")
    return HttpHealth(response.status, endpoint.value)


def _ipc(endpoint: Endpoint, request: dict[str, JSONValue]) -> dict[str, JSONValue]:
    if endpoint.transport is not EndpointTransport.UNIX:
        raise ServiceRuntimeError("endpoint_transport_mismatch")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(1)
            connection.connect(endpoint.value)
            connection.sendall((json.dumps(request, allow_nan=False) + "\n").encode())
            raw = connection.makefile("r", encoding="utf-8").readline(HEALTH_BODY_CAP + 1)
        value: JSONValue = json.loads(raw)
    except (OSError, UnicodeError, ValueError) as error:
        raise ServiceRuntimeError("ipc_unavailable") from error
    if len(raw.encode()) > HEALTH_BODY_CAP or not isinstance(value, dict):
        raise ServiceRuntimeError("malformed_ipc")
    return value


def prewarm_health(endpoint: Endpoint) -> PrewarmHealth:
    value = _ipc(endpoint, {"cmd": "ping"})
    pid = value.get("pid")
    if value.get("ok") is not True or value.get("status") != "idle" or isinstance(pid, bool) or not isinstance(pid, int):
        raise ServiceRuntimeError("malformed_ipc")
    return PrewarmHealth("idle", pid)


def activate_prewarm(receipt: ServiceReceipt, cwd: Path, session_id: str) -> ActivationAck:
    if receipt.endpoint is None:
        raise ServiceRuntimeError("missing_endpoint")
    value = _ipc(receipt.endpoint, {
        "cmd": "activate", "ackMode": "ready", "cwd": str(cwd),
        "args": ["--serve", "--port", 0], "sessionId": session_id,
    })
    pid = value.get("pid")
    endpoint_value = value.get("endpoint")
    if (
        value.get("ok") is not True or value.get("status") != "active"
        or pid != receipt.child_pid or value.get("sessionId") != session_id
        or value.get("cwd") != str(cwd) or not isinstance(endpoint_value, str)
    ):
        raise ServiceRuntimeError("activation_mismatch")
    endpoint = Endpoint(EndpointTransport.HTTP, http_target(endpoint_value).value)
    return ActivationAck("active", pid, session_id, cwd, endpoint)


def launch_supervised(spec: PersistentLaunch) -> LaunchObservation:
    with spec.paths.stdout.open("wb") as stdout, spec.paths.stderr.open("wb") as stderr:
        process = SupervisorLaunch(
            spec.supervisor, spec.paths.status, spec.paths.ack, spec.paths.teardown,
            os.getpid(), spec.timeout, spec.command, spec.cwd, spec.paths.handoff,
        ).start(None, stdout, stderr)
    deadline = time.monotonic() + spec.timeout
    from lazybuddy_bounded_process import await_supervisor_ready
    handshake = await_supervisor_ready(process, spec.paths.status, inspect_processes, deadline)
    if handshake.ready is None:
        cleanup_owned_processes(handshake.tracker, inspect_processes, signal_owned_group)
        raise ServiceRuntimeError("ownership_ack_failed")
    try:
        write_ack(spec.paths.ack, SupervisorAck(
            handshake.ready.supervisor_pid, handshake.ready.supervisor_pgid, handshake.tracker.root.started,
        ))
        while time.monotonic() < deadline:
            status = parse_status(spec.paths.status)
            if status is not None and status.state is SupervisorState.RUNNING and status.child_pid is not None:
                return LaunchObservation(handshake.tracker.root, status.child_pid)
            if process.poll() is not None:
                break
            time.sleep(0.01)
    except OSError as error:
        cleanup_owned_processes(handshake.tracker, inspect_processes, signal_owned_group)
        raise ServiceRuntimeError("ownership_ack_failed") from error
    cleanup_owned_processes(handshake.tracker, inspect_processes, signal_owned_group)
    raise ServiceRuntimeError("worker_not_running")


def process_reason(receipt: ServiceReceipt) -> str | None:
    inspection = inspect_processes()
    match inspection:
        case InspectionUnavailable():
            return "inspection_unavailable"
        case InspectionAvailable(records=records):
            root = next((record for record in records if record.pid == receipt.supervisor.pid), None)
        case unreachable:
            assert_never(unreachable)
    if root is None:
        return "stale_pid"
    if root.started != receipt.supervisor.started or root.group_id != receipt.supervisor.group_id:
        return "identity_mismatch"
    try:
        status = parse_status(receipt.paths.status)
    except ValueError:
        return "malformed_status"
    if status is None or status.supervisor_pid != receipt.supervisor.pid or status.child_pid != receipt.child_pid:
        return "status_identity_mismatch"
    if status.state is SupervisorState.EXITED:
        return "killed_worker"
    if status.state is not SupervisorState.RUNNING:
        return "worker_not_running"
    fingerprint = executable_fingerprint(str(receipt.executable_path), receipt.cwd)
    if fingerprint.get("digest") != receipt.executable_digest:
        return "executable_changed"
    return None


def stop_owned(receipt: ServiceReceipt) -> CleanupReceipt:
    tracker = OwnershipTracker.establish(receipt.supervisor, inspect_processes())
    return cleanup_owned_processes(tracker, inspect_processes, signal_owned_group)
