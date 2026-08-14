from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import assert_never

from lazybuddy_codebuddy_service_contract import Endpoint, ServiceKind, SessionMode
from lazybuddy_codebuddy_service_runtime import ServiceRuntimeError, http_target


@dataclass(frozen=True, slots=True)
class CommandSpec:
    kind: ServiceKind
    binary: Path
    name: str
    endpoint: Endpoint | None
    mode: SessionMode
    socket_root: Path


def command_for(spec: CommandSpec) -> tuple[str, ...]:
    match spec.kind:
        case ServiceKind.DAEMON:
            return (str(spec.binary), "daemon", "start")
        case ServiceKind.BACKGROUND:
            return (str(spec.binary), "--bg", "--name", spec.name)
        case ServiceKind.SERVE:
            if spec.endpoint is None:
                raise ServiceRuntimeError("missing_endpoint")
            target = http_target(spec.endpoint.value)
            ephemeral = ("--no-session-persistence",) if spec.mode is SessionMode.EPHEMERAL else ()
            return (str(spec.binary), "--serve", "--port", str(target.port), *ephemeral)
        case ServiceKind.PREWARM:
            assignment = f"CODEBUDDY_CODE_PREWARM_SOCKET_PATH={spec.socket_root}"
            return ("/usr/bin/env", assignment, str(spec.binary), "--prewarm", "--prewarm-id", spec.name)
        case unreachable:
            assert_never(unreachable)
