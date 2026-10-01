#!/usr/bin/env python3
"""Treat legacy hook text as data and record advisory events transactionally."""
import json
import os
from pathlib import Path
import subprocess
import sys

from state_transaction import TransactionError, checked_target, locked, recover_locked
from run_controller import read_object, save, timestamp


def main() -> None:
    event, product = sys.argv[1:]
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("hook payload too large")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("hook payload must be an object")
    cwd = payload.get("cwd") or os.getcwd()
    if not isinstance(cwd, str):
        raise ValueError("cwd must be a string")
    root = Path(cwd).resolve() / (".lazy" + product)
    runs = root / "runs"
    if root.is_symlink() or runs.is_symlink() or not runs.is_dir():
        return
    values = {key: payload[key] for key in ("task_id", "agent_id", "agent_type", "agent_type_name")
              if isinstance(payload.get(key), str)}
    subject = payload.get("task_subject", payload.get("subject", ""))
    if isinstance(subject, str):
        values["subject"] = subject[:200]
    if not values.get("task_id") and event.startswith("task_"):
        return
    for directory in sorted(runs.iterdir()):
        if directory.is_symlink() or not directory.is_dir():
            continue
        with locked(directory):
            recover_locked(directory)
            state = read_object(checked_target(directory, "state.json"))
            if state.get("status") not in ("active", "paused", "created", "planning", "executing", "blocked", "verifying", "reviewing"):
                continue
        script = Path(__file__).with_name("state-transaction.py")
        subprocess.run([sys.executable, str(script), "append-event", str(directory), directory.name,
                        event, json.dumps(values), timestamp()], check=True, capture_output=True)
        if event == "task_completed":
            with locked(directory):
                recover_locked(directory)
                state = read_object(checked_target(directory, "state.json"))
                tasks = state.get("tasks", [])
                progress = state.setdefault("progress", {})
                if not isinstance(tasks, list) or not isinstance(progress, dict):
                    raise ValueError("invalid task progress")
                progress["completed_checkboxes"] = sum(task.get("status") == "done" for task in tasks if isinstance(task, dict))
                progress["last_completed"] = values["task_id"]
                save(directory, state, "hook_task_progress")
        return


if __name__ == "__main__":
    try:
        main()
    except (TransactionError, OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        print(f"advisory hook deferred: {error}", file=sys.stderr)
