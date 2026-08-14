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


def status(path: Path, expected: str) -> dict[str, str | int]:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.01)
            continue
        assert isinstance(value, dict), value
        state = value.get("state")
        if state == expected:
            return value
        time.sleep(0.01)
    raise AssertionError(f"supervisor did not publish atomic state {expected!r}")


def teardown(process: subprocess.Popen[bytes], teardown_path: Path) -> bytes:
    if process.poll() is None:
        teardown_path.touch(exist_ok=True)
    process.wait(timeout=WAIT_SECONDS)
    assert process.stdout is not None
    return process.stdout.read()


def load_supervisor(path: Path):
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("launch_supervisor_regression", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


supervisor = Path(sys.argv[1]).resolve(strict=True)
load_supervisor(supervisor)
contract_module = importlib.import_module("lazybuddy_supervisor_contract")
with tempfile.TemporaryDirectory(prefix="todo13-supervisor-", dir="/private/tmp") as temporary:
    root = Path(temporary)
    status_path = root / "status.json"
    ack_path = root / "ack.json"
    teardown_path = root / "teardown"
    target_started = root / "target-started"
    child_code = (
        "import pathlib,subprocess,sys; "
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
        f"pathlib.Path({str(target_started)!r}).write_text('started'); "
        "print('direct-child-complete')"
    )
    process = subprocess.Popen(
        [
            sys.executable,
            str(supervisor),
            "--status-file",
            str(status_path),
            "--ack-file",
            str(ack_path),
            "--teardown-file",
            str(teardown_path),
            "--parent-pid",
            str(os.getpid()),
            "--ack-timeout",
            "2",
            "--",
            sys.executable,
            "-c",
            child_code,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        ready = status(status_path, "ready")
        assert ready["supervisor_pid"] == process.pid, ready
        assert ready["supervisor_pgid"] == process.pid, ready
        assert not target_started.exists(), "target started before parent ownership acknowledgement"
        contract_module.write_ack(
            ack_path,
            contract_module.SupervisorAck(process.pid, process.pid, "observed-start-identity"),
        )
        value = status(status_path, "exited")
        assert value == {
            "schema_version": "lazybuddy.launch-supervisor.v1",
            "state": "exited",
            "supervisor_pid": process.pid,
            "supervisor_pgid": process.pid,
            "child_pid": value["child_pid"],
            "returncode": 0,
        }, value
        assert process.poll() is None, "supervisor exited before mandatory teardown"
        assert target_started.exists(), "acknowledged target did not start"
    finally:
        output = teardown(process, teardown_path)
    assert output == b"direct-child-complete\n", output
    assert json.loads(status_path.read_text(encoding="utf-8")) == value

    malformed_status = root / "malformed-status.json"
    malformed_status.write_text('{"schema_version":"lazybuddy.launch-supervisor.v1","state":"exited"}\n', encoding="utf-8")
    malformed_rejected = False
    try:
        contract_module.parse_status(malformed_status)
    except contract_module.SupervisorStatusError:
        malformed_rejected = True
    assert malformed_rejected, "incomplete supervisor status was accepted"

    for ack_case in ("absent", "malformed", "stale"):
        ack_status = root / f"{ack_case}-ack-status.json"
        ack_control = root / f"{ack_case}-ack.json"
        ack_teardown = root / f"{ack_case}-ack-teardown"
        forbidden_target = root / f"{ack_case}-target-started"
        ack_process = subprocess.Popen(
            [
                sys.executable,
                str(supervisor),
                "--status-file",
                str(ack_status),
                "--ack-file",
                str(ack_control),
                "--teardown-file",
                str(ack_teardown),
                "--parent-pid",
                str(os.getpid()),
                "--ack-timeout",
                "0.2",
                "--",
                sys.executable,
                "-c",
                f"import pathlib; pathlib.Path({str(forbidden_target)!r}).write_text('started')",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            ack_ready = status(ack_status, "ready")
            if ack_case == "malformed":
                ack_control.write_text("not-json\n", encoding="utf-8")
            elif ack_case == "stale":
                contract_module.write_ack(
                    ack_control,
                    contract_module.SupervisorAck(
                        int(ack_ready["supervisor_pid"]) + 1,
                        int(ack_ready["supervisor_pgid"]),
                        "stale-start-identity",
                    ),
                )
            ack_failure = status(ack_status, "launch-failed")
            assert "acknowledgement" in str(ack_failure["detail"]), ack_failure
            ack_process.wait(timeout=WAIT_SECONDS)
            assert not forbidden_target.exists(), f"{ack_case} acknowledgement started target"
        finally:
            teardown(ack_process, ack_teardown)

    parent_status = root / "parent-mismatch-status.json"
    parent_ack = root / "parent-mismatch-ack.json"
    parent_teardown = root / "parent-mismatch-teardown"
    parent_target = root / "parent-mismatch-target"
    parent_process = subprocess.Popen(
        [
            sys.executable,
            str(supervisor),
            "--status-file",
            str(parent_status),
            "--ack-file",
            str(parent_ack),
            "--teardown-file",
            str(parent_teardown),
            "--parent-pid",
            str(os.getpid() + 1),
            "--ack-timeout",
            "2",
            "--",
            sys.executable,
            "-c",
            f"import pathlib; pathlib.Path({str(parent_target)!r}).write_text('started')",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        parent_failure = status(parent_status, "launch-failed")
        assert "parent identity changed" in str(parent_failure["detail"]), parent_failure
        parent_process.wait(timeout=WAIT_SECONDS)
        assert not parent_target.exists(), "parent mismatch started target"
    finally:
        teardown(parent_process, parent_teardown)

    launch_failure_status = root / "launch-failure.json"
    launch_failure_teardown = root / "launch-failure-teardown"
    launch_failure_ack = root / "launch-failure-ack"
    launch_failure = subprocess.Popen(
        [
            sys.executable,
            str(supervisor),
            "--status-file",
            str(launch_failure_status),
            "--ack-file",
            str(launch_failure_ack),
            "--teardown-file",
            str(launch_failure_teardown),
            "--parent-pid",
            str(os.getpid()),
            "--ack-timeout",
            "2",
            "--",
            str(root / "missing-executable"),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        failure_ready = status(launch_failure_status, "ready")
        contract_module.write_ack(
            launch_failure_ack,
            contract_module.SupervisorAck(
                int(failure_ready["supervisor_pid"]),
                int(failure_ready["supervisor_pgid"]),
                "observed-launch-failure-start",
            ),
        )
        failure_value = status(launch_failure_status, "launch-failed")
        assert launch_failure.poll() is None, "launch-failed supervisor escaped mandatory teardown"
    finally:
        teardown(launch_failure, launch_failure_teardown)

print("PASS: target cannot start before atomic ready identity and parent acknowledgement")
print("PASS: absent malformed and stale acknowledgements fail closed before target start")
print("PASS: parent identity interruption tears down before target start")
print("PASS: supervisor publishes atomic outcome and remains group leader through teardown")
print("PASS: malformed and launch-failed supervisor states fail closed")
