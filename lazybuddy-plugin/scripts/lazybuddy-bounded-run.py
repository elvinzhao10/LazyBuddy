#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


def positive_integer(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def tail(value: str, limit: int = 4096) -> str:
    return value[-limit:]


def emit(status: str, label: str) -> None:
    print(f"{status}: {label}", file=sys.stderr, flush=True)


def write_result(path: Path, result: dict[str, object]) -> None:
    path.write_text(json.dumps(result, ensure_ascii=False) + "\n", encoding="utf-8")


@dataclass(frozen=True)
class ProcessRecord:
    pid: int
    parent_pid: int
    group_id: int
    state: str
    started: str


def process_records() -> dict[int, ProcessRecord]:
    completed = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,pgid=,stat=,lstart="],
        check=False,
        capture_output=True,
        text=True,
        timeout=1,
    )
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


def terminate_owned_group(process: subprocess.Popen[str]) -> dict[str, object]:
    descendants = descendant_records(process.pid)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=0.2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    current_records = process_records()
    remaining = [record.pid for record in descendants if is_same_process(record, current_records)]
    return {
        "process_group_terminated": True,
        "detectable_descendants_remaining": bool(remaining),
        "detectable_descendant_pids": sorted(remaining),
    }


def timeout_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--timeout", required=True, type=positive_integer)
    parser.add_argument("--result-file", required=True, type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command or args.command[0] != "--" or len(args.command) == 1:
        parser.error("a command after -- is required")
    command = args.command[1:]
    emit("START", args.label)
    try:
        process = subprocess.Popen(
            command,
            stdin=None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
    except OSError as error:
        write_result(args.result_file, {"status": "unavailable", "reason": "launch_error", "tail": tail(str(error))})
        emit("FAIL", args.label)
        return 125
    try:
        stdout, stderr = process.communicate(timeout=args.timeout)
    except subprocess.TimeoutExpired as error:
        cleanup = terminate_owned_group(process)
        stdout = timeout_output(error.output)
        stderr = timeout_output(error.stderr)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()
        write_result(
            args.result_file,
            {
                "status": "timeout",
                "reason": "deadline_exceeded",
                "tail": tail(stdout + stderr),
                "cleanup": cleanup,
            },
        )
        emit("TIMEOUT", args.label)
        detectable = str(cleanup["detectable_descendants_remaining"]).lower()
        print(f"CLEANUP: {args.label} detectable_descendants_remaining={detectable}", file=sys.stderr, flush=True)
        return 124
    if process.returncode == 0:
        write_result(args.result_file, {"status": "pass", "reason": "ok", "tail": tail((stdout or "") + (stderr or ""))})
        emit("PASS", args.label)
        return 0
    write_result(args.result_file, {"status": "fail", "reason": f"exit_{process.returncode}", "tail": tail((stdout or "") + (stderr or ""))})
    emit("FAIL", args.label)
    return process.returncode if process.returncode > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
