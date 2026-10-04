"""Recover the frozen queue-to-run handoff under queue then run locks."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by queue-bridge.py activate/recover.
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from dashboard_files import Json, bounded_read, encoded, safe_path
from queue_store import QueueStore, directory, scoped_fault
from state_transaction import MISSING, TransactionError, Write, commit_locked, locked, read_revision, recover_locked, sha256_bytes


def initialize(store: QueueStore, intent: Json) -> None:
    request = intent["request"]
    binding = store.binding
    if intent["status"] == "linked" and not (binding.root / ".lazybuddy/runs" / request["run_id"]).is_dir():
        raise TransactionError("LINKED_RUN_MISSING")
    run = directory(binding.root, f".lazybuddy/runs/{request['run_id']}")
    provenance = {key: intent[key] for key in ("request", "content_hash", "actor", "plan")}
    content = intent["content"].encode()
    with locked(run):
        recover_locked(run)
        state_path = safe_path(run, "state.json")
        if state_path.exists():
            state = json.loads(bounded_read(run, "state.json"))
            if (state.get("run_id") != request["run_id"] or state.get("objective") != request["objective"]
                    or state.get("dashboard_project_id") != binding.project_id
                    or state.get("plan_reference") != f".lazybuddy/runs/{request['run_id']}/plan.md"
                    or state.get("activation_provenance") != provenance
                    or bounded_read(run, "activation.json") != encoded(provenance)
                    or bounded_read(run, "activation-plan.md") != content):
                raise TransactionError("ACTIVATION_RUN_COLLISION")
            plan = bounded_read(run, "plan.md")
            if (bounded_read(run, "checkpoints/plan-revision.md") != plan
                    or sha256_bytes(plan) != state.get("_approved_plan_sha256")):
                raise TransactionError("ACTIVATION_RUN_PLAN_CHANGED")
            return
        if intent["status"] == "linked":
            raise TransactionError("LINKED_RUN_MISSING")
        if read_revision(run) != 0 or any(path.name != ".transaction.lock" and path.name != ".revision" for path in run.iterdir()):
            raise TransactionError("ACTIVATION_RUN_ORPHAN")
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        state = {"schema_version": "2", "run_id": request["run_id"], "created_at": now, "updated_at": now,
                 "objective": request["objective"], "status": "created", "tasks": [], "verification_gates": [],
                 "plan_reference": f".lazybuddy/runs/{request['run_id']}/plan.md", "plan_revision": 1,
                 "_approved_plan_sha256": request["source_sha256"], "activation_provenance": provenance,
                 "dashboard_project_id": binding.project_id, "review_status": "not_started",
                 "progress": {"total_checkboxes": 0, "completed_checkboxes": 0},
                 "iteration": {"count": 0, "max": 500, "mode": "normal"}, "last_checkpoint": None,
                 "budget": {"max_tokens": None, "max_cost_usd": None}, "session_ids": [], "runtime_fingerprints": []}
        event = {"schema_version": 1, "event_id": f"activation:{request['activation_id']}", "ts": now,
                 "run_id": request["run_id"], "event": "run_created",
                 "event_payload": {"objective": request["objective"], "activation_provenance": provenance}}
        legacy = {key: event[key] for key in ("event_id", "ts", "run_id", "event")}
        legacy.update(event["event_payload"])
        writes = [Write("state.json", encoded(state), MISSING), Write("events.jsonl", encoded(legacy), MISSING),
                  Write("canonical-events.jsonl", encoded(event), MISSING), Write("activation.json", encoded(provenance), MISSING),
                  Write("activation-plan.md", content, MISSING), Write("plan.md", content, MISSING),
                  Write("checkpoints/plan-revision.md", content, MISSING)]
        scoped_fault("run")
        commit_locked(run, "activate_queued_plan", writes)


def finish(store: QueueStore, intent: Json) -> Json:
    initialize(store, intent)
    if intent["status"] == "linked":
        return intent["result"]
    if os.environ.get("LAZYBUDDY_QUEUE_FAULT") == "after-run":
        os._exit(86)
    intent["status"] = "linked"
    store.document["plans"] = [plan for plan in store.document["plans"] if plan["id"] != intent["plan"]["id"]]
    store.document["revision"] += 1
    scoped_fault("confirmation")
    store.save("confirm_queue_activation")
    return intent["result"]


def activate(store: QueueStore, request: Json) -> Json:
    reduction = store.reduce("activate", request)
    if reduction["replay"]:
        return finish(store, next(item for item in store.document["intents"] if item["request"]["activation_id"] == request["activation_id"]))
    content = bounded_read(store.binding.root, request["source_path"])
    if not content or len(content) > 1024 * 1024 or sha256_bytes(content) != request["source_sha256"]:
        raise TransactionError("ACTIVATION_SOURCE_CHANGED")
    intent = {"request": reduction["request"], "content_hash": reduction["content_hash"], "actor": store.binding.actor,
              "plan": reduction["plan"], "content": content.decode(), "status": "pending",
              "result": {"activation_id": request["activation_id"], "plan_id": request["plan_id"],
                         "run_id": request["run_id"], "status": "linked"}}
    store.document["intents"].append(intent)
    store.document["revision"] += 1
    scoped_fault("intent")
    store.save("queue_activation_intent")
    if os.environ.get("LAZYBUDDY_QUEUE_FAULT") == "after-intent":
        os._exit(86)
    return finish(store, intent)


def recover_activation(store: QueueStore, request: Json) -> Json:
    if not isinstance(request, dict) or set(request) != {"activation_id"}:
        raise TransactionError("invalid activation recovery")
    intent = next((item for item in store.document["intents"] if item["request"]["activation_id"] == request["activation_id"]), None)
    if intent is None:
        raise TransactionError("UNKNOWN_ACTIVATION")
    return finish(store, intent)
