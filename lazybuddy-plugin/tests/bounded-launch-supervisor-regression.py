#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 bounded-launch-supervisor-regression.py <supervisor>
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Final


WAIT_SECONDS: Final = 5.0


def status(path: Path) -> dict[str, str | int]:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.01)
            continue
        assert isinstance(value, dict), value
        state = value.get("state")
        if state in {"exited", "launch-failed"}:
            return value
        time.sleep(0.01)
    raise AssertionError("supervisor did not publish a terminal atomic status")


def process_present(pid: int) -> bool:
    completed = subprocess.run(
        ["/bin/ps", "-p", str(pid), "-o", "stat="],
        check=False,
        capture_output=True,
        text=True,
        timeout=WAIT_SECONDS,
    )
    return completed.returncode == 0 and bool(completed.stdout.strip()) and not completed.stdout.lstrip().startswith("Z")


def load_supervisor(path: Path):
    spec = importlib.util.spec_from_file_location("launch_supervisor_regression", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


supervisor = Path(sys.argv[1]).resolve(strict=True)
supervisor_module = load_supervisor(supervisor)
with tempfile.TemporaryDirectory(prefix="todo13-supervisor-", dir="/private/tmp") as temporary:
    root = Path(temporary)
    status_path = root / "status.json"
    teardown_path = root / "teardown"
    stdout_path = root / "stdout"
    stderr_path = root / "stderr"
    descendant_path = root / "descendant.pid"
    child_code = (
        "import pathlib,subprocess,sys; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
        f"pathlib.Path({str(descendant_path)!r}).write_text(str(child.pid)); "
        "print('direct-child-complete')"
    )
    with stdout_path.open("wb") as stdout_handle, stderr_path.open("wb") as stderr_handle:
        process = subprocess.Popen(
            [
                sys.executable,
                str(supervisor),
                "--status-file",
                str(status_path),
                "--teardown-file",
                str(teardown_path),
                "--",
                sys.executable,
                "-c",
                child_code,
            ],
            stdin=subprocess.DEVNULL,
            stdout=stdout_handle,
            stderr=stderr_handle,
            start_new_session=True,
        )
        value = status(status_path)
        assert value == {
            "schema_version": "lazybuddy.launch-supervisor.v1",
            "state": "exited",
            "child_pid": value["child_pid"],
            "returncode": 0,
        }, value
        assert process.poll() is None, "supervisor exited before mandatory teardown"
        descendant_pid = int(descendant_path.read_text(encoding="utf-8"))
        assert process_present(descendant_pid), descendant_pid
        teardown_path.touch()
        process.wait(timeout=WAIT_SECONDS)
    deadline = time.monotonic() + WAIT_SECONDS
    while process_present(descendant_pid) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not process_present(descendant_pid), "owned inherited-descriptor descendant survived group teardown"
    assert json.loads(status_path.read_text(encoding="utf-8")) == value

    malformed_status = root / "malformed-status.json"
    malformed_status.write_text('{"schema_version":"lazybuddy.launch-supervisor.v1","state":"exited"}\n', encoding="utf-8")
    malformed_rejected = False
    try:
        supervisor_module.parse_status(malformed_status)
    except supervisor_module.SupervisorStatusError:
        malformed_rejected = True
    assert malformed_rejected, "incomplete supervisor status was accepted"

    launch_failure_status = root / "launch-failure.json"
    launch_failure_teardown = root / "launch-failure-teardown"
    launch_failure = subprocess.Popen(
        [
            sys.executable,
            str(supervisor),
            "--status-file",
            str(launch_failure_status),
            "--teardown-file",
            str(launch_failure_teardown),
            "--",
            str(root / "missing-executable"),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    failure_value = status(launch_failure_status)
    assert failure_value["state"] == "launch-failed", failure_value
    assert launch_failure.poll() is None, "launch-failed supervisor escaped mandatory teardown"
    launch_failure_teardown.touch()
    launch_failure.wait(timeout=WAIT_SECONDS)

print("PASS: supervisor publishes atomic outcome and remains group leader through teardown")
print("PASS: malformed and launch-failed supervisor states fail closed")
