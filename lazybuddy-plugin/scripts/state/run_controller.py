#!/usr/bin/env python3
"""Serialize task claims, iteration limits, initialization and hook projections."""
from __future__ import annotations

import json
import sys
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Union

from state_transaction import TransactionError, Write, checked_target, commit_locked, locked, recover_locked

JsonValue = Union[None, bool, int, float, str, List["JsonValue"], Dict[str, "JsonValue"]]
StateObject = Dict[str, JsonValue]


def read_object(path: Path) -> StateObject:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"expected object: {path.name}")
    return value


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def save(run_dir: Path, state: StateObject, operation: str) -> None:
    state["updated_at"] = timestamp()
    commit_locked(run_dir, operation, [Write("state.json", (json.dumps(state, indent=2) + "\n").encode())])


def claim(run_dir: Path, state: StateObject, cycle: bool) -> tuple[StateObject, int]:
    tasks = state.get("tasks", [])
    if not isinstance(tasks, list) or any(not isinstance(task, dict) for task in tasks):
        raise ValueError("tasks must be an array of objects")
    iteration = state.get("iteration", {})
    if not isinstance(iteration, dict):
        raise ValueError("iteration must be an object")
    count, limit = iteration.get("count", 0), iteration.get("max", 500)
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (count, limit)):
        raise ValueError("iteration count and max must be nonnegative integers")
    if count >= limit:
        return {"status": "exhausted", "reason": "iteration_limit", "count": count, "max": limit}, 1
    status = state.get("status")
    if status == "failed":
        return {"status": "failed", "reason": "run_failed"}, 1
    if status in ("complete", "completed"):
        return {"status": "exhausted", "reason": "completion_requires_assessment", "completion_authority": False}, 1
    if status in ("cancelled", "stopped"):
        return {"status": "exhausted", "reason": "run_terminal", "completion_authority": False}, 1
    if status not in ("created", "planning", "active", "executing"):
        return {"status": "blocked", "reason": "run_not_dispatchable"}, 1
    done = {task.get("id") for task in tasks if task.get("status") == "done"}
    for task in tasks:
        if task.get("status") != "queued":
            continue
        identity, dependencies = task.get("id"), task.get("depends_on", [])
        if not isinstance(identity, str) or not identity:
            raise ValueError("queued task requires a nonempty id")
        if not isinstance(dependencies, list) or any(not isinstance(dep, str) for dep in dependencies):
            raise ValueError("depends_on must be an array of task ids")
        if set(dependencies).issubset(done):
            task["status"] = "running"
            if cycle:
                state["status"] = "executing"
                iteration["count"] = count + 1
                state["iteration"] = iteration
            save(run_dir, state, "run_cycle" if cycle else "claim_task")
            return ({"status": "continue", "task": task} if cycle else task), 0
    statuses = {task.get("status") for task in tasks}
    if "queued" in statuses or "running" in statuses:
        return {"status": "blocked", "reason": "running" if "running" in statuses else "dependencies"}, 1
    if "failed" in statuses or "skipped" in statuses:
        return {"status": "failed", "reason": "unfinished_tasks"}, 1
    if statuses - {"done"}:
        return {"status": "failed", "reason": "invalid_task_status"}, 1
    return {"status": "exhausted", "reason": "queue_empty", "completion_authority": False}, 1


def main() -> int:
    operation, directory, *args = sys.argv[1:]
    run_dir = Path(directory)
    with locked(run_dir):
        recover_locked(run_dir)
        target = checked_target(run_dir, "state.json")
        if operation == "create":
            objective, state_source, event_source = args
            if target.exists():
                existing = read_object(target)
                if existing.get("run_id") != run_dir.name or existing.get("objective") != objective:
                    raise ValueError("run already exists with a different identity or objective")
                print(run_dir)
                return 0
            for name in ("events.jsonl", "canonical-events.jsonl"):
                if checked_target(run_dir, name).exists():
                    raise ValueError("refusing to initialize an existing run ledger")
            commit_locked(run_dir, "create_run", [Write("state.json", Path(state_source).read_bytes()),
                                                    Write("events.jsonl", Path(event_source).read_bytes())])
            print(run_dir)
            return 0
        state = read_object(target)
        if operation == "hook":
            event_id, now, event, outcome, *extra = args
            lifecycle = state.setdefault("hook_lifecycle", {})
            if not isinstance(lifecycle, dict):
                raise ValueError("hook_lifecycle must be an object")
            lifecycle["last_event"] = {"event": event, "event_id": event_id, "occurred_at": now}
            if event.startswith("Permission"):
                lifecycle["last_permission"] = {"event_id": event_id, "outcome": outcome, "completion_authority": False}
            scopes = json.loads(extra[0]) if extra else []
            if scopes:
                if not isinstance(scopes, list) or any(not isinstance(scope, str) for scope in scopes):
                    raise ValueError("invalid invalidation scopes")
                invalidations = lifecycle.setdefault("invalidations", [])
                if not isinstance(invalidations, list):
                    raise ValueError("invalid invalidation ledger")
                invalidations.append({"event": event, "event_id": event_id, "scopes": scopes, "occurred_at": now, "completion_authority": False})
            save(run_dir, state, "hook_projection")
            return 0
        if operation not in ("claim", "cycle"):
            raise ValueError("unknown run operation")
        result, code = claim(run_dir, state, operation == "cycle")
        checkpoint_due = operation == "cycle" and code == 0 and state["iteration"]["count"] % 5 == 0
    if checkpoint_due:
        checkpoint = Path(__file__).with_name("checkpoint.sh")
        completed = subprocess.run(["bash", str(checkpoint), run_dir.name], stdout=subprocess.DEVNULL, check=False)
        if completed.returncode != 0:
            raise ValueError("checkpoint failed after committed task claim")
    print(json.dumps(result), file=sys.stdout if code == 0 or operation == "cycle" else sys.stderr)
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (TransactionError, OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"status": "error", "reason": str(error)}), file=sys.stderr)
        raise SystemExit(1)
