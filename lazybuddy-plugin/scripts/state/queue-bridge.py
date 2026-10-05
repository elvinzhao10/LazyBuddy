"""Bounded queue CLI; snapshots lock queue before delegating the run reader."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: python3 queue-bridge.py read|command|activate|recover|snapshot --project-root ROOT --project-id ID --actor ID --node NODE [--run-id ID]
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from dashboard_files import Json, encoded
from queue_activation import activate, recover_activation
from queue_store import LIMIT, QueueBinding, QueueStore, scoped_fault
from state_transaction import TransactionError, locked, recover_locked


def run_snapshot(store: QueueStore) -> Json:
    binding = store.binding
    if binding.run_id is None:
        raise TransactionError("run binding required for snapshot")
    argv = [sys.executable, str(Path(__file__).with_name("dashboard-bridge.py")), "read",
            "--project-root", str(binding.root), "--project-id", binding.project_id,
            "--run-id", binding.run_id, "--actor", binding.actor, "--node", binding.node]
    result = subprocess.run(argv, input=b"{}", capture_output=True, check=False, timeout=35)
    if result.returncode:
        raise TransactionError(result.stderr.decode().strip() or "run snapshot rejected")
    snapshot = json.loads(result.stdout)
    snapshot.update(store.snapshot())
    return snapshot


def command(store: QueueStore, request: Json) -> Json:
    reduction = store.reduce("command", request)
    if not reduction["replay"]:
        store.document = reduction["store"]
        scoped_fault("command")
        store.save("dashboard_queue_command")
    return reduction["result"]


def main(argv: list[str]) -> Json:
    actions = {"read": lambda store, request: store.snapshot(), "command": command,
               "activate": activate, "recover": recover_activation,
               "snapshot": lambda store, request: run_snapshot(store)}
    if len(argv) < 2 or argv[1] not in actions:
        raise TransactionError("unknown queue action")
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise TransactionError("queue input too large")
    request = json.loads(raw or b"{}")
    binding = QueueBinding.parse(argv[2:])
    with locked(binding.queue):
        recover_locked(binding.queue)
        return actions[argv[1]](QueueStore(binding), request)


if __name__ == "__main__":
    try:
        print(encoded(main(sys.argv)).decode(), end="")
    except (TransactionError, OSError, UnicodeError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        print(f"queue: {error}", file=sys.stderr)
        raise SystemExit(65) from error
