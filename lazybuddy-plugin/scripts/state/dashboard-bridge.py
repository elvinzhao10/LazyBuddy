"""Locked dashboard adapter; all mutations reuse the existing run journal."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: python3 dashboard-bridge.py read|command|consume --project-root PATH --project-id ID --run-id ID --actor ID --node NODE
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dashboard_files import Binding, Files, Json, LIMIT, encoded
from dashboard_history import preserve
from dashboard_completion import capture_completion
from dashboard_producer import producer_context, publish_attempt, publish_completion
from state_transaction import TransactionError, Write, commit_locked, locked, read_revision, recover_locked


def capture(files: Files) -> dict[str, Json]:
    state = json.loads(files.read("state.json"))
    binding = files.binding
    if state.get("run_id") != binding.run_id or state.get("dashboard_project_id", binding.project_id) != binding.project_id:
        raise TransactionError("run/project identity mismatch")
    sources = []
    for name, kind in [("canonical-events.jsonl", "runtime"), ("events.jsonl", "legacy")]:
        text = files.read(name).decode()
        sources.append({"id": kind, "kind": kind, "generation": "1", "text": text})
    files.read(".revision")
    head = subprocess.run(["git", "-C", str(binding.root), "rev-parse", "HEAD"], capture_output=True, timeout=5, check=False)
    reference = state.get("plan_reference", "")
    editable = isinstance(reference, str) and reference.startswith(f".lazybuddy/runs/{binding.run_id}/")
    return {"project_id": binding.project_id, "run_id": binding.run_id,
            "revision": read_revision(binding.run), "plan_revision": state.get("plan_revision", 0),
            "state": state, "sources": sources, "source_revision": head.stdout.decode().strip() if head.returncode == 0 else None,
            "plan_digest": state.get("_approved_plan_sha256"),
            "editability": {"supported": editable, "reason": None if editable else "EXTERNAL_PLAN_READ_ONLY"}}


def event_write(files: Files, event: dict[str, Json]) -> Write:
    content = files.read("canonical-events.jsonl")
    if content and not content.endswith(b"\n"):
        raise TransactionError("unterminated event ledger")
    for line in content.splitlines():
        json.loads(line)
    return files.write("canonical-events.jsonl", content + encoded(event))


def consume(files: Files, request: dict[str, Json]) -> Json:
    snapshot = capture(files)
    state = snapshot["state"]
    if set(request) != {"expected_revision", "plan_revision"} or any(type(value) is not int or value < 0 for value in request.values()):
        raise TransactionError("invalid consumption request")
    if request["expected_revision"] != snapshot["revision"] or request["plan_revision"] != snapshot["plan_revision"]:
        raise TransactionError("stale consumption revision")
    reference = state.get("plan_reference", "")
    prefix = f".lazybuddy/runs/{files.binding.run_id}/"
    if not reference.startswith(prefix):
        raise TransactionError("consumption requires run-owned plan")
    plan = files.read(reference[len(prefix):])
    if plan != files.read("checkpoints/plan-revision.md") or hashlib.sha256(plan).hexdigest() != state.get("_approved_plan_sha256"):
        raise TransactionError("consumption plan changed without reconciliation")
    acknowledgements = state.get("acknowledgements", [])
    applied = []
    for acknowledgement in acknowledgements:
        if acknowledgement["status"] == "pending_agent" and acknowledgement["plan_revision"] == request["plan_revision"]:
            acknowledgement["status"] = "applied"
            acknowledgement["consumed_plan_revision"] = request["plan_revision"]
            applied.append(acknowledgement["command_id"])
    if not applied:
        return {"revision": snapshot["revision"], "applied": []}
    event = {"schema_version": 1, "event_id": f"consumed:{snapshot['revision'] + 1}", "ts": datetime.now(timezone.utc).isoformat(),
             "run_id": files.binding.run_id, "event": "plan_revision_consumed",
             "event_payload": {"actor": files.binding.actor, **request, "command_ids": applied}}
    revision = commit_locked(files.binding.run, "dashboard_consume", [files.write("state.json", encoded(state)), event_write(files, event)])
    return {"revision": revision, "applied": applied, "consumed_plan_revision": request["plan_revision"]}


def command(files: Files, request: Json) -> Json:
    snapshot = capture(files)
    reducer = Path(__file__).resolve().parents[2] / "shared/dashboard/commands.mjs"
    result = subprocess.run([files.binding.node, str(reducer), "--reduce"],
                            input=encoded({**snapshot, "command": request, "actor": files.binding.actor}),
                            capture_output=True, timeout=10, check=False)
    if result.returncode != 0:
        raise TransactionError(result.stderr.decode().strip() or "command validation failed")
    reduction = json.loads(result.stdout)
    if reduction["replay"]:
        return reduction["result"]
    state = reduction["state"]
    revision = snapshot["revision"] + 1
    prefix = f"history/dashboard-{revision}"
    writes = [files.immutable(prefix + "/state.json", encoded(reduction["historical"]))]
    writes.extend(preserve(files, reduction["historical"], prefix))
    reference = state.get("plan_reference")
    relative = f".lazybuddy/runs/{files.binding.run_id}/"
    if not isinstance(reference, str) or not reference.startswith(relative):
        raise TransactionError("EXTERNAL_PLAN_READ_ONLY: dashboard requires run-owned plan reference")
    plan_name = reference[len(relative):]
    plan = files.read(plan_name)
    if not plan:
        raise TransactionError("plan missing")
    checkpoint = files.read("checkpoints/plan-revision.md")
    if checkpoint and (checkpoint != plan or state.get("_approved_plan_sha256", hashlib.sha256(plan).hexdigest()) != hashlib.sha256(plan).hexdigest()):
        raise TransactionError("plan changed without reconciliation")
    writes.append(files.immutable(prefix + "/plan.md", plan))
    if request["operation"] == "attach_evidence":
        evidence = request["payload"]["evidence"]
        content = files.evidence(evidence["path"])
        digest = hashlib.sha256(content).hexdigest()
        if evidence["sha256"] is not None and evidence["sha256"] != digest:
            raise TransactionError("evidence digest mismatch")
        writes.append(files.immutable(prefix + "/evidence", content))
        state["evidence_submissions"][-1]["archived_path"] = prefix + "/evidence"
        state["evidence_submissions"][-1]["archived_sha256"] = digest
    marker = b"\n<!-- lazybuddy-dashboard-authority -->\n"
    if plan.count(marker) > 1:
        raise TransactionError("ambiguous dashboard plan section")
    base = plan.split(marker)[0]
    view = {"plan_revision": state["plan_revision"], "tasks": state["tasks"], "decisions": state.get("decisions", [])}
    rendered = encoded(view).replace(b"<", b"\\u003c").replace(b">", b"\\u003e").replace(b"`", b"\\u0060")
    plan = base + marker + b"```json\n" + rendered + b"```\n"
    state["_approved_plan_sha256"] = hashlib.sha256(plan).hexdigest()
    event = {"schema_version": 1, "event_id": f"command:{revision}", "ts": datetime.now(timezone.utc).isoformat(),
             "run_id": files.binding.run_id, "event": "dashboard_command_saved",
             "event_payload": {"command": request, "actor": files.binding.actor, "acknowledgement": reduction["result"]}}
    writes.extend([files.write("state.json", encoded(state)), files.write(plan_name, plan),
                   files.write("checkpoints/plan-revision.md", plan), event_write(files, event)])
    if len(writes) > 1024 or any(len(write.content) > LIMIT for write in writes):
        raise TransactionError("dashboard transaction exceeds bounded inputs")
    commit_locked(files.binding.run, "dashboard_command", writes)
    return reduction["result"]


def main(argv: list[str]) -> Json:
    if len(argv) < 2 or argv[1] not in ("read", "command", "consume", "attempt", "complete", "producer-context"):
        raise TransactionError("unknown dashboard action")
    binding = Binding.parse(argv[2:])
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise TransactionError("dashboard request too large")
    request = json.loads(raw or b"{}")
    with locked(binding.run):
        recover_locked(binding.run)
        files = Files(binding)
        actions = {"read": lambda: {**capture(files), "_completion_capture": capture_completion(files)},
                   "command": lambda: command(files, request), "consume": lambda: consume(files, request),
                   "attempt": lambda: publish_attempt(files, request, capture(files), event_write),
                   "complete": lambda: publish_completion(files, request, capture(files)),
                   "producer-context": lambda: producer_context(files, request, capture(files))}
        return actions[argv[1]]()


if __name__ == "__main__":
    try:
        print(encoded(main(sys.argv)).decode(), end="")
    except (TransactionError, OSError, UnicodeError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        print(f"dashboard: {error}", file=sys.stderr)
        raise SystemExit(65) from error
