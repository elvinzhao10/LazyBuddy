#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 lazybuddy-codebuddy-service.py --help
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import TypeAlias, assert_never

from lazybuddy_codebuddy_service_contract import ServiceKind
from lazybuddy_codebuddy_service_runtime import ServiceRuntimeError
from lazybuddy_codebuddy_service_commands import (
    NAME,
    AdapterError,
    activate,
    checkpoint,
    safe_absolute,
    start,
    state_lock,
    status,
    stop,
)


JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


def atomic_json(path: Path, value: dict[str, JSONValue]) -> None:
    safe_absolute(path, "unsafe_result_path")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    subparsers = value.add_subparsers(dest="action", required=True)
    for action in ("status", "stop"):
        child = subparsers.add_parser(action)
        child.add_argument("--state-root", required=True, type=Path)
        child.add_argument("--name", required=True)
        child.add_argument("--result-file", required=True, type=Path)
    child = subparsers.add_parser("start")
    child.add_argument("--state-root", required=True, type=Path)
    child.add_argument("--name", required=True)
    child.add_argument("--kind", required=True, choices=tuple(ServiceKind))
    child.add_argument("--binary", required=True, type=Path)
    child.add_argument("--cwd", required=True, type=Path)
    child.add_argument("--endpoint")
    child.add_argument("--ephemeral", action="store_true")
    child.add_argument("--timeout", type=int, default=5)
    child.add_argument("--result-file", required=True, type=Path)
    child = subparsers.add_parser("activate")
    child.add_argument("--state-root", required=True, type=Path)
    child.add_argument("--name", required=True)
    child.add_argument("--cwd", required=True, type=Path)
    child.add_argument("--session-id", required=True)
    child.add_argument("--result-file", required=True, type=Path)
    child = subparsers.add_parser("checkpoint")
    child.add_argument("--state-root", required=True, type=Path)
    child.add_argument("--name", required=True)
    child.add_argument("--checkpoint-file", required=True, type=Path)
    child.add_argument("--canonical-state", required=True, type=Path)
    child.add_argument("--result-file", required=True, type=Path)
    return value


def main() -> int:
    args = parser().parse_args()
    result_file = safe_absolute(args.result_file, "unsafe_result_path")
    try:
        root = safe_absolute(args.state_root, "unsafe_state_root", directory=True)
        if not NAME.fullmatch(args.name):
            raise AdapterError("invalid_service_name")
        with state_lock(root, args.name):
            match args.action:
                case "start": code, result = start(args, root, args.name)
                case "status": code, result = status(args, root, args.name)
                case "activate": code, result = activate(args, root, args.name)
                case "stop": code, result = stop(args, root, args.name)
                case "checkpoint": code, result = checkpoint(args, root, args.name)
                case unreachable: assert_never(unreachable)
    except AdapterError as error:
        code, result = error.exit_code, {"status": error.status, "reason": error.reason}
    except (OSError, ServiceRuntimeError) as error:
        reason = error.reason if isinstance(error, ServiceRuntimeError) else "adapter_io_error"
        code, result = 125, {"status": "unavailable", "reason": reason}
    atomic_json(result_file, result)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
