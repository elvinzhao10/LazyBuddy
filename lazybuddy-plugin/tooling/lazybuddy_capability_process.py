from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path
from types import FrameType

from lazybuddy_capability_contract import fail


def timeout_seconds() -> int:
    raw = os.environ.get("LAZYBUDDY_CAPABILITY_TIMEOUT_SECONDS", "10")
    if not raw.isdecimal() or int(raw) < 1:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "LAZYBUDDY_CAPABILITY_TIMEOUT_SECONDS must be positive")
    return int(raw)


def terminate(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run_process(command: list[str], workspace: Path, timeout: int) -> str:
    process = subprocess.Popen(command, cwd=workspace, text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    previous_term = signal.getsignal(signal.SIGTERM)
    previous_int = signal.getsignal(signal.SIGINT)

    def cancelled(_: int, __: FrameType | None) -> None:
        terminate(process)
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    try:
        output, error = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        terminate(process)
        fail("AUTOMATIC_TOOLING_TIMEOUT", f"local capability exceeded {timeout}s")
    except KeyboardInterrupt:
        terminate(process)
        fail("AUTOMATIC_TOOLING_TIMEOUT", "local capability cancelled")
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        signal.signal(signal.SIGINT, previous_int)
    if process.returncode != 0 and process.returncode != 1:
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", error.strip() or "local provider failed")
    return output
