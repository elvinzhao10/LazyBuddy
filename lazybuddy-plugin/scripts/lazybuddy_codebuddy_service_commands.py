from __future__ import annotations

import argparse
import fcntl
import hashlib
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Final, Iterator, TypeAlias, assert_never

from lazybuddy_bounded_process import executable_fingerprint
from lazybuddy_process_lifecycle import CleanupStatus
from lazybuddy_codebuddy_checkpoint import CheckpointError, observe_checkpoint
from lazybuddy_codebuddy_service_argv import CommandSpec, command_for
from lazybuddy_codebuddy_service_contract import (
    Endpoint,
    EndpointTransport,
    ReceiptError,
    ServiceKind,
    ServicePaths,
    ServiceReceipt,
    ServiceStatus,
    SessionMode,
    parse_receipt,
    write_receipt,
)
from lazybuddy_codebuddy_service_runtime import (
    PersistentLaunch,
    ServiceRuntimeError,
    activate_prewarm,
    http_health,
    http_target,
    launch_supervised,
    prewarm_health,
    process_reason,
    stop_owned,
)


NAME: Final = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")
OUTPUT_CAP: Final = 64 * 1024
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]
CommandResult: TypeAlias = tuple[int, dict[str, JSONValue]]


class AdapterError(RuntimeError):
    def __init__(self, reason: str, status: str = "fail", exit_code: int = 2) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status = status
        self.exit_code = exit_code


def linked_component(path: Path) -> bool:
    current = path.absolute()
    while True:
        if current.exists() and current.is_symlink():
            return True
        if current.parent == current:
            return False
        current = current.parent


def safe_absolute(path: Path, reason: str, directory: bool = False) -> Path:
    if not path.is_absolute() or linked_component(path):
        raise AdapterError(reason)
    if directory and not path.is_dir():
        raise AdapterError(reason)
    return path


def service_paths(root: Path, name: str) -> tuple[Path, ServicePaths]:
    receipts = root / "services"
    controls = root / "controls" / name
    logs = root / "logs"
    sockets = root / "sockets"
    for directory in (receipts, controls, logs, sockets):
        if directory.exists() and (not directory.is_dir() or directory.is_symlink()):
            raise AdapterError("unsafe_state_path")
        directory.mkdir(parents=True, exist_ok=True)
    return receipts / f"{name}.json", ServicePaths(
        controls / "status.json", controls / "ack.json", controls / "teardown", controls / "handoff",
        logs / f"{name}.stdout", logs / f"{name}.stderr",
    )


@contextmanager
def state_lock(root: Path, name: str) -> Iterator[None]:
    descriptor = os.open(root / f".{name}.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def load(root: Path, name: str) -> tuple[Path, ServiceReceipt]:
    receipt_path, _paths = service_paths(root, name)
    try:
        receipt = parse_receipt(receipt_path, root)
        if receipt.name != name or receipt.service_id != f"codebuddy-service:{name}":
            raise ReceiptError
        return receipt_path, receipt
    except ReceiptError as error:
        raise AdapterError("malformed_receipt") from error


def await_ready(receipt: ServiceReceipt, deadline: float) -> None:
    while time.monotonic() < deadline:
        try:
            if receipt.endpoint is None:
                return
            match receipt.endpoint.transport:
                case EndpointTransport.HTTP:
                    if http_health(receipt.endpoint).status == 200:
                        return
                case EndpointTransport.UNIX:
                    if prewarm_health(receipt.endpoint).pid == receipt.child_pid:
                        return
                case unreachable:
                    assert_never(unreachable)
        except ServiceRuntimeError:
            time.sleep(0.02)
    raise AdapterError("readiness_timeout", exit_code=1)


def start(args: argparse.Namespace, root: Path, name: str) -> CommandResult:
    kind = ServiceKind(args.kind)
    mode = SessionMode.EPHEMERAL if args.ephemeral else SessionMode.PERSISTENT
    binary = safe_absolute(args.binary, "unsafe_binary")
    cwd = safe_absolute(args.cwd, "unsafe_cwd", directory=True)
    receipt_path, paths = service_paths(root, name)
    try:
        endpoint = Endpoint(EndpointTransport.HTTP, http_target(args.endpoint).value) if args.endpoint is not None else None
    except ServiceRuntimeError as error:
        if error.reason == "non_loopback_bind":
            raise AdapterError(error.reason, status="unsupported") from error
        raise AdapterError(error.reason) from error
    if kind is ServiceKind.SERVE and endpoint is None:
        raise AdapterError("missing_endpoint")
    if kind is not ServiceKind.SERVE and args.ephemeral:
        raise AdapterError("ephemeral_mode_unsupported", status="unsupported")
    if kind is ServiceKind.PREWARM:
        socket_path = root / "sockets" / f"codebuddy-prewarm-{name}.sock"
        if socket_path.exists() or socket_path.is_symlink():
            raise AdapterError("stale_socket", exit_code=1)
        endpoint = Endpoint(EndpointTransport.UNIX, str(socket_path))
    if receipt_path.exists() and parse_receipt(receipt_path, root).status is ServiceStatus.RUNNING:
        raise AdapterError("already_running", exit_code=1)
    for path in (paths.status, paths.ack, paths.teardown, paths.handoff):
        if path.is_symlink():
            raise AdapterError("unsafe_state_path")
        path.unlink(missing_ok=True)
    fingerprint = executable_fingerprint(str(binary), cwd)
    launch = launch_supervised(PersistentLaunch(
        Path(__file__).resolve().parent / "lazybuddy_launch_supervisor.py", paths,
        command_for(CommandSpec(kind, binary, name, endpoint, mode, root / "sockets")), cwd, args.timeout,
    ))
    receipt = ServiceReceipt(
        f"codebuddy-service:{name}", kind, name, ServiceStatus.RUNNING, mode, cwd,
        binary.resolve(strict=True), fingerprint["digest"], launch.root, launch.child_pid, paths, endpoint,
    )
    try:
        await_ready(receipt, time.monotonic() + args.timeout)
        write_receipt(receipt_path, receipt)
        paths.handoff.touch(exist_ok=False)
    except (AdapterError, OSError):
        stop_owned(receipt)
        raise
    return 0, {
        "status": "running", "kind": kind.value, "name": name, "session_mode": mode.value,
        "receipt": str(receipt_path), "endpoint": endpoint.value if endpoint is not None else None,
        "activation_count": 0, "supervisor_pid": launch.root.pid, "child_pid": launch.child_pid,
    }


def status(_args: argparse.Namespace, root: Path, name: str) -> CommandResult:
    _path, receipt = load(root, name)
    if receipt.status is ServiceStatus.STOPPED:
        reason = process_reason(receipt)
        if reason == "inspection_unavailable":
            return 125, {"status": "unavailable", "reason": reason, "name": name}
        if reason not in {"stale_pid", "identity_mismatch"}:
            return 1, {"status": "fail", "reason": "receipt_status_mismatch", "name": name}
        return 0, {"status": "stopped", "name": name, "cleanup": receipt.cleanup.as_json() if receipt.cleanup else None}
    if any(log.stat().st_size > OUTPUT_CAP for log in (receipt.paths.stdout, receipt.paths.stderr)):
        return 1, {"status": "fail", "reason": "output_limit_exceeded", "name": name}
    reason = process_reason(receipt)
    if reason is not None:
        return 1, {"status": "fail", "reason": reason, "name": name}
    health_value: dict[str, JSONValue] | None = None
    if receipt.endpoint is not None:
        match receipt.endpoint.transport:
            case EndpointTransport.HTTP:
                health = http_health(receipt.endpoint)
                health_value = {"status": health.status, "endpoint": health.endpoint}
            case EndpointTransport.UNIX:
                health = prewarm_health(receipt.endpoint)
                if health.pid != receipt.child_pid:
                    return 1, {"status": "fail", "reason": "endpoint_identity_mismatch", "name": name}
                health_value = {"status": health.status, "pid": health.pid}
            case unreachable:
                assert_never(unreachable)
    logs: list[JSONValue] = [
        {"path": str(log), "bytes": log.stat().st_size, "sha256": hashlib.sha256(log.read_bytes()).hexdigest()}
        for log in (receipt.paths.stdout, receipt.paths.stderr)
    ]
    return 0, {
        "status": "running", "name": name, "kind": receipt.kind.value, "health": health_value,
        "status_line": {"source": "owned-receipt", "service_status": "running"},
        "monitoring": {"scope": "traces-only", "content_opt_in": False}, "logs": logs,
        "activation_count": receipt.activation_count, "session_mode": receipt.session_mode.value,
    }


def activate(args: argparse.Namespace, root: Path, name: str) -> CommandResult:
    receipt_path, receipt = load(root, name)
    if receipt.kind is not ServiceKind.PREWARM:
        raise AdapterError("not_prewarm")
    if receipt.activation_count != 0:
        raise AdapterError("already_activated", exit_code=1)
    cwd = safe_absolute(args.cwd, "unsafe_cwd", directory=True)
    if cwd != receipt.cwd:
        raise AdapterError("activation_cwd_mismatch", exit_code=1)
    ack = activate_prewarm(receipt, cwd, args.session_id)
    write_receipt(receipt_path, receipt.activated(ack.endpoint, ack.session_id))
    return 0, {
        "status": ack.status, "name": name, "activation_count": 1, "session_id": ack.session_id,
        "endpoint": ack.endpoint.value, "pid": ack.pid,
    }


def stop(_args: argparse.Namespace, root: Path, name: str) -> CommandResult:
    receipt_path, receipt = load(root, name)
    if receipt.status is ServiceStatus.STOPPED:
        reason = process_reason(receipt)
        if reason == "inspection_unavailable":
            return 125, {"status": "unavailable", "reason": reason, "name": name}
        if reason not in {"stale_pid", "identity_mismatch"}:
            return 1, {"status": "fail", "reason": "receipt_status_mismatch", "name": name}
        return 0, {"status": "stopped", "name": name, "cleanup": receipt.cleanup.as_json() if receipt.cleanup else None}
    cleanup = stop_owned(receipt)
    if cleanup.status is not CleanupStatus.VERIFIED_ABSENT:
        return 125, {"status": "unavailable", "reason": "process_cleanup_failed", "cleanup": cleanup.as_json()}
    if receipt.endpoint is not None and receipt.endpoint.transport is EndpointTransport.UNIX:
        socket_path = Path(receipt.endpoint.value)
        if socket_path.is_symlink():
            return 125, {"status": "unavailable", "reason": "socket_cleanup_refused", "cleanup": cleanup.as_json()}
        socket_path.unlink(missing_ok=True)
    write_receipt(receipt_path, receipt.stopped(cleanup))
    return 0, {"status": "stopped", "name": name, "cleanup": cleanup.as_json()}


def checkpoint(args: argparse.Namespace, root: Path, name: str) -> CommandResult:
    _receipt_path, receipt = load(root, name)
    checkpoint_path = safe_absolute(args.checkpoint_file, "unsafe_checkpoint_path")
    canonical = safe_absolute(args.canonical_state, "unsafe_canonical_path")
    try:
        return 0, observe_checkpoint(receipt, checkpoint_path, canonical).as_json()
    except CheckpointError as error:
        exit_code = 1 if error.reason == "checkpoint_mismatch" else 2
        raise AdapterError(error.reason, exit_code=exit_code) from error
