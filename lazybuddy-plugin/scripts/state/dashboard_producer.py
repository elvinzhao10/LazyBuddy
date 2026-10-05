"""Transactional publication for observed producer processes and completion proof."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by dashboard-bridge.py.
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TypedDict

from dashboard_files import Files, Json, encoded
from state_transaction import TransactionError, Write, commit_locked, sha256_bytes


class AttemptRequest(TypedDict):
    attempt: dict[str, Json]
    invocation: dict[str, Json]


EventWriter = Callable[[Files, dict[str, Json]], Write]
ATTEMPT_FIELDS = {"id", "task_id", "criterion_id", "criterion_version", "plan_revision",
                  "consumed_plan_revision", "worker_id", "parent_task_id", "source_revision",
                  "execution", "verification", "started_at", "finished_at", "evidence"}


def producer_context(files: Files, request: Json, snapshot: dict[str, Json]) -> Json:
    required = {"parent_task_id", "task_id", "criterion_id", "plan_commands_file", "command_index"}
    if not isinstance(request, dict) or set(request) != required:
        raise TransactionError("invalid producer context request")
    parent_id = _text(request["parent_task_id"], "parent_task_id")
    task_id = _text(request["task_id"], "task_id")
    criterion_id = _text(request["criterion_id"], "criterion_id")
    command_index = request["command_index"]
    if not isinstance(command_index, int) or isinstance(command_index, bool) or command_index < 0:
        raise TransactionError("invalid producer command index")
    state = snapshot["state"]
    if not isinstance(state, dict) or not isinstance(state.get("tasks"), list):
        raise TransactionError("invalid producer state")
    running = [item for item in state["tasks"] if isinstance(item, dict) and item.get("status") == "running"]
    if len(running) != 1 or running[0].get("id") != parent_id:
        raise TransactionError("producer requires exactly one authoritative running parent")
    task = next((item for item in state["tasks"] if isinstance(item, dict) and item.get("id") == task_id), None)
    criterion = next((item for item in (task or {}).get("criteria", []) if item.get("id") == criterion_id), None)
    authority = running[0].get("execution_authority")
    if task is None or criterion is None or not isinstance(authority, dict):
        raise TransactionError("producer context identity mismatch")
    if authority.get("repo_head") != snapshot["source_revision"] or criterion_id not in authority.get("criterion_ids", []):
        raise TransactionError("producer context outside execution authority")
    reference = _text(state.get("plan_reference"), "plan_reference")
    prefix = f".lazybuddy/runs/{files.binding.run_id}/"
    if authority.get("plan_reference") != reference or not reference.startswith(prefix):
        raise TransactionError("producer plan authority mismatch")
    plan = files.read(reference[len(prefix):])
    if plan != files.read("checkpoints/plan-revision.md") or sha256_bytes(plan) != snapshot["plan_digest"]:
        raise TransactionError("producer plan checkpoint mismatch")
    commands_path = _text(authority.get("plan_commands_path"), "plan_commands_path")
    hinted = _text(request["plan_commands_file"], "plan_commands_file")
    if commands_path != hinted and str(files.binding.root / commands_path) != hinted:
        raise TransactionError("producer command authority hint mismatch")
    if not commands_path.startswith(prefix):
        raise TransactionError("producer command authority outside run")
    command_bytes = files.read(commands_path[len(prefix):])
    if sha256_bytes(command_bytes) != authority.get("plan_commands_sha256"):
        raise TransactionError("producer command authority digest mismatch")
    commands = json.loads(command_bytes)
    if not isinstance(commands, list) or command_index >= len(commands) or not isinstance(commands[command_index], list):
        raise TransactionError("producer command authority malformed")
    argv = commands[command_index]
    if not argv or len(argv) > 128 or any(not isinstance(item, str) or not item or len(item) > 1024 for item in argv):
        raise TransactionError("producer command argv malformed")
    return {"project_id": files.binding.project_id, "run_id": files.binding.run_id, "parent_task_id": parent_id,
            "task_id": task_id, "criterion_id": criterion_id, "criterion_version": criterion.get("version"),
            "revision": snapshot["revision"], "plan_revision": snapshot["plan_revision"],
            "plan_digest": snapshot["plan_digest"], "source_revision": snapshot["source_revision"],
            "plan_commands_sha256": authority["plan_commands_sha256"], "argv": argv}


def _text(value: Json, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise TransactionError(f"invalid producer {label}")
    return value


def _attempt(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict) or set(value) != ATTEMPT_FIELDS:
        raise TransactionError("invalid producer attempt")
    for name in ("id", "task_id", "worker_id", "parent_task_id", "source_revision"):
        _text(value.get(name), name)
    if value.get("criterion_id") is not None:
        _text(value.get("criterion_id"), "criterion_id")
    for name in ("criterion_version", "plan_revision", "consumed_plan_revision"):
        if not isinstance(value.get(name), int) or isinstance(value.get(name), bool) or value[name] < 0:
            raise TransactionError(f"invalid producer {name}")
    if value["consumed_plan_revision"] != value["plan_revision"]:
        raise TransactionError("producer dispatch revision mismatch")
    if value.get("execution") not in {"running", "finished", "failed", "cancelled"}:
        raise TransactionError("invalid producer execution")
    if value.get("verification") not in {"unverified", "verifying", "failed"}:
        raise TransactionError("invalid producer verification")
    evidence = value.get("evidence")
    if not isinstance(evidence, list) or len(evidence) > 32:
        raise TransactionError("invalid producer evidence")
    return value


def _binding(snapshot: dict[str, Json], attempt: dict[str, Json]) -> tuple[dict[str, Json], dict[str, Json]]:
    state = snapshot["state"]
    if not isinstance(state, dict) or not isinstance(state.get("tasks"), list):
        raise TransactionError("invalid producer state")
    tasks = [task for task in state["tasks"] if isinstance(task, dict)]
    running = [task for task in tasks if task.get("status") == "running"]
    if len(running) != 1 or running[0].get("id") != attempt["parent_task_id"]:
        raise TransactionError("producer requires exactly one authoritative running parent")
    task = next((item for item in tasks if item.get("id") == attempt["task_id"]), None)
    if task is None:
        raise TransactionError("producer task is unknown")
    criteria = task.get("criteria", [])
    criterion = next((item for item in criteria if isinstance(item, dict) and item.get("id") == attempt["criterion_id"]), None)
    if criterion is None:
        raise TransactionError("producer criterion is unknown")
    return task, criterion


def _attempt_path(identity: str, phase: str) -> str:
    return f"producer-attempts/{hashlib.sha256(identity.encode()).hexdigest()}/{phase}.json"


def publish_attempt(files: Files, request: Json, snapshot: dict[str, Json], event_writer: EventWriter) -> Json:
    if not isinstance(request, dict) or set(request) != {"attempt", "invocation"} or not isinstance(request["invocation"], dict):
        raise TransactionError("invalid producer publication")
    attempt = _attempt(request["attempt"])
    task, criterion = _binding(snapshot, attempt)
    invocation = request["invocation"]
    if invocation.get("attempt_id") != attempt["id"] or invocation.get("worker_id") != attempt["worker_id"]:
        raise TransactionError("producer invocation identity mismatch")
    phase = "start" if attempt["execution"] == "running" else "terminal"
    if phase == "start" and (attempt["finished_at"] is not None or not isinstance(invocation.get("runner_pid"), int)):
        raise TransactionError("producer start is not observed")
    if phase == "terminal":
        start = json.loads(files.read(_attempt_path(_text(attempt["id"], "attempt_id"), "start")))
        if start.get("context_sha256") != invocation.get("context_sha256") or start.get("runner_pid") != invocation.get("runner_pid"):
            raise TransactionError("producer terminal identity mismatch")
    manifest = encoded(invocation)
    manifest_path = _attempt_path(_text(attempt["id"], "attempt_id"), phase)
    reference = f".lazybuddy/runs/{files.binding.run_id}/{manifest_path}"
    evidence = attempt["evidence"]
    assert isinstance(evidence, list)
    evidence.append({"path": reference, "sha256": sha256_bytes(manifest), "provenance": "actual bounded process invocation"})
    state = snapshot["state"]
    assert isinstance(state, dict)
    writes = [files.immutable(manifest_path, manifest)]
    current = (criterion.get("version") == attempt["criterion_version"] and snapshot["plan_revision"] == attempt["plan_revision"]
               and snapshot["source_revision"] == attempt["source_revision"])
    if phase == "terminal" and current:
        terminal = {"finished": "done", "failed": "failed", "cancelled": "cancelled"}[attempt["execution"]]
        task["status"] = terminal
        writes.append(files.write("state.json", encoded(state)))
    event = {"schema_version": 1, "event_id": f"producer:{attempt['id']}:{phase}",
             "ts": datetime.now(timezone.utc).isoformat(), "run_id": files.binding.run_id,
             "event": "attempt_result", "event_payload": attempt}
    writes.append(event_writer(files, event))
    revision = commit_locked(files.binding.run, f"producer_{phase}", writes)
    return {"revision": revision, "attempt_id": attempt["id"], "execution": attempt["execution"], "manifest": reference}


def _successful_manifest(files: Files, attempt_id: str, worker_id: str, request: dict[str, Json]) -> dict[str, Json]:
    value = json.loads(files.read(_attempt_path(attempt_id, "terminal")))
    result = value.get("result")
    tracked = value.get("tracked_pids")
    if (value.get("attempt_id") != attempt_id or value.get("worker_id") != worker_id or
            not isinstance(result, dict) or result.get("status") != "pass"):
        raise TransactionError("completion process did not succeed")
    expected = {"task_id": request["task_id"], "criterion_id": request["criterion_id"],
                "criterion_version": request["criterion_version"], "plan_revision": request["plan_revision"],
                "source_revision": request["source_revision"]}
    if any(value.get(name) != expected_value for name, expected_value in expected.items()):
        raise TransactionError("completion process context mismatch")
    if not isinstance(value.get("runner_pid"), int) or not isinstance(tracked, list) or not tracked:
        raise TransactionError("completion process identity is unavailable")
    return value


def publish_completion(files: Files, request: Json, snapshot: dict[str, Json]) -> Json:
    required = {"task_id", "criterion_id", "criterion_version", "plan_revision", "source_revision", "artifact_path",
                "executor_id", "executor_attempt_id", "verifier_id", "verifier_attempt_id", "package_version"}
    if not isinstance(request, dict) or set(request) != required:
        raise TransactionError("invalid completion publication")
    task_id = _text(request["task_id"], "task_id")
    criterion_id = _text(request["criterion_id"], "criterion_id")
    executor_id = _text(request["executor_id"], "executor_id")
    verifier_id = _text(request["verifier_id"], "verifier_id")
    executor_attempt = _text(request["executor_attempt_id"], "executor_attempt_id")
    verifier_attempt = _text(request["verifier_attempt_id"], "verifier_attempt_id")
    if executor_id == verifier_id:
        raise TransactionError("completion reviewer is not independent")
    probe = {"task_id": task_id, "criterion_id": criterion_id, "parent_task_id": next(
        (item.get("id") for item in snapshot["state"]["tasks"] if item.get("status") == "running"), None)}
    probe.update({"id": verifier_attempt, "worker_id": verifier_id, "source_revision": request["source_revision"],
                  "criterion_version": request["criterion_version"], "plan_revision": request["plan_revision"],
                  "consumed_plan_revision": request["plan_revision"], "execution": "finished", "verification": "verifying",
                  "started_at": None, "finished_at": None, "evidence": []})
    task, criterion = _binding(snapshot, _attempt(probe))
    if criterion.get("version") != request["criterion_version"] or snapshot["plan_revision"] != request["plan_revision"]:
        raise TransactionError("completion criterion is stale")
    if snapshot["source_revision"] != request["source_revision"] or task.get("status") != "done":
        raise TransactionError("completion execution is not current and finished")
    executor = _successful_manifest(files, executor_attempt, executor_id, request)
    verifier = _successful_manifest(files, verifier_attempt, verifier_id, request)
    executor_pids = {executor["runner_pid"], *executor["tracked_pids"]}
    verifier_pids = {verifier["runner_pid"], *verifier["tracked_pids"]}
    if executor_pids & verifier_pids:
        raise TransactionError("completion processes are not distinct")
    artifact_source = _text(request["artifact_path"], "artifact_path")
    artifact = files.evidence(artifact_source)
    suffix = hashlib.sha256(f"{criterion_id}\n{request['criterion_version']}\n{verifier_attempt}".encode()).hexdigest()
    base = f"completion/{suffix}"
    artifact_path = f".lazybuddy/runs/{files.binding.run_id}/{base}/artifact"
    review_path = f".lazybuddy/runs/{files.binding.run_id}/{base}/review.json"
    receipt_path = f".lazybuddy/runs/{files.binding.run_id}/{base}/receipt.json"
    review = {"verdict": "approved", "verifier": {"identity": verifier_id},
              "invocation_sha256": sha256_bytes(encoded(verifier))}
    review_bytes = encoded(review)
    command = json.dumps(verifier.get("argv"), separators=(",", ":"))
    if len(command.encode()) > 4096:
        raise TransactionError("completion verifier command is too large")
    receipt = {"schema_version": "lazyseries.completion-evidence.v1", "run_id": files.binding.run_id,
               "task_id": task_id, "criterion_id": criterion_id, "repo_head": request["source_revision"],
               "package_version": request["package_version"], "command": command,
               "exit_code": 0, "started_at": verifier["started_at"], "finished_at": verifier["finished_at"],
               "artifact": {"path": artifact_path, "sha256": sha256_bytes(artifact)},
               "executor": {"identity": executor_id}, "verifier": {"identity": verifier_id},
               "review": {"verdict": "approved", "source_sha256": sha256_bytes(review_bytes)}}
    plan_path = _text(snapshot["state"].get("plan_reference"), "plan_reference")
    plan = files.evidence(plan_path)
    if hashlib.sha256(plan).hexdigest() != snapshot["plan_digest"] or re.search(
            rf"^- \[x\] \[{re.escape(criterion_id)}\](?:\s|$)", plan.decode(), re.MULTILINE) is None:
        raise TransactionError("completion checked plan authority mismatch")
    authority_path = "completion-authority.json"
    prior_bytes = files.read(authority_path)
    prior = json.loads(prior_bytes) if prior_bytes else {}
    prior_current = (prior.get("run_id") == files.binding.run_id and prior.get("repo_head") == request["source_revision"]
                     and prior.get("package_version") == request["package_version"]
                     and prior.get("plan", {}).get("path") == plan_path
                     and prior.get("plan", {}).get("sha256") == snapshot["plan_digest"])
    criteria = []
    for state_task in snapshot["state"]["tasks"]:
        for item in state_task.get("criteria", []):
            old = next((entry for entry in prior.get("criteria", []) if prior_current and entry.get("task_id") == state_task.get("id")
                        and entry.get("criterion_id") == item.get("id") and entry.get("criterion_version", 1) == item.get("version")), None)
            complete = state_task.get("id") == task_id and item.get("id") == criterion_id
            criteria.append(old if old and not complete else {"task_id": state_task.get("id"), "criterion_id": item.get("id"),
                "criterion_version": item.get("version"), "applicable": item.get("applicability") == "required",
                "status": "complete" if complete else "pending", "evidence_path": receipt_path if complete else "pending",
                "review_path": review_path if complete else "pending"})
    authority = {"schema_version": "lazyseries.completion-authority.v1", "run_id": files.binding.run_id,
                 "repo_head": request["source_revision"], "package_version": request["package_version"],
                 "plan": {"id": f"plan-revision:{request['plan_revision']}", "path": plan_path,
                          "sha256": snapshot["plan_digest"]}, "criteria": criteria}
    writes = [files.immutable(f"{base}/artifact", artifact), files.immutable(f"{base}/review.json", review_bytes),
              files.immutable(f"{base}/receipt.json", encoded(receipt)), files.write(authority_path, encoded(authority))]
    revision = commit_locked(files.binding.run, "producer_completion", writes)
    return {"revision": revision, "criterion_id": criterion_id, "receipt": receipt_path, "review": review_path,
            "artifact": artifact_path}
