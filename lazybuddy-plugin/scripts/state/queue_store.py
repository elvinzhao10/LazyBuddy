"""Project queue transaction boundary and bounded contract parsing."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by queue-bridge.py.
from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypedDict

from dashboard_files import Json, bounded_read, encoded, safe_path
from state_transaction import MISSING, TransactionError, Write, commit_locked, read_revision, sha256_bytes
from state_transaction_files import fsync_directory

LIMIT: Final = 4 * 1024 * 1024


class QueueDocument(TypedDict):
    schema_version: int
    project_id: str
    revision: int
    plans: list[Json]
    commands: list[Json]
    intents: list[Json]


def directory(root: Path, relative: str) -> Path:
    """Create only regular directory components inside the bound project."""
    current = root
    for part in relative.split("/"):
        if not part or part in (".", "..") or "\\" in part:
            raise TransactionError("unsafe queue directory")
        current = current / part
        if current.is_symlink():
            raise TransactionError("unsafe queue directory")
        current.mkdir(exist_ok=True)
        if not current.is_dir() or current.resolve() != current:
            raise TransactionError("unsafe queue directory")
        fsync_directory(current.parent)
    return current


@dataclass(frozen=True, slots=True)
class QueueBinding:
    root: Path
    queue: Path
    project_id: str
    actor: str
    node: str
    run_id: str | None

    @classmethod
    def parse(cls, argv: list[str]) -> QueueBinding:
        if len(argv) not in (8, 10) or len(set(argv[::2])) != len(argv) // 2:
            raise TransactionError("invalid queue arguments")
        args = dict(zip(argv[::2], argv[1::2]))
        required = {"--project-root", "--project-id", "--actor", "--node"}
        if not required.issubset(args) or set(args) - required - {"--run-id"}:
            raise TransactionError("invalid queue arguments")
        root = Path(args["--project-root"]).absolute()
        if not root.is_dir() or root.resolve() != root:
            raise TransactionError("unsafe project root")
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}", args["--project-id"]) is None:
            raise TransactionError("invalid project identity")
        if not args["--actor"] or len(args["--actor"]) > 256:
            raise TransactionError("trusted actor required")
        queue = directory(root, ".lazybuddy/dashboard-queue")
        return cls(root, queue, args["--project-id"], args["--actor"], args["--node"], args.get("--run-id"))


class QueueStore:
    """Own a mutable queue document while its transaction lock is held."""

    def __init__(self, binding: QueueBinding) -> None:
        self.binding = binding
        path = safe_path(binding.queue, "queue.json")
        self.before = bounded_read(binding.queue, "queue.json") if path.exists() else None
        revision = read_revision(binding.queue)
        if self.before is None and revision != 0:
            raise TransactionError("queue state missing at committed revision")
        self.document: QueueDocument = json.loads(self.before) if self.before else {
            "schema_version": 1, "project_id": binding.project_id, "revision": revision,
            "plans": [], "commands": [], "intents": []}
        self.reduce("read")
        if self.document["revision"] != revision:
            raise TransactionError("queue committed revision mismatch")

    def reduce(self, action: str, request: Json = None) -> Json:
        payload = {"action": action, "request": request, "store": self.document,
                   "revision": self.document["revision"], "project_id": self.binding.project_id,
                   "actor": self.binding.actor}
        reducer = Path(__file__).resolve().parents[2] / "shared/dashboard/queue.mjs"
        result = subprocess.run([self.binding.node, str(reducer), "--reduce"], input=encoded(payload),
                                capture_output=True, check=False, timeout=10)
        if result.returncode:
            raise TransactionError(result.stderr.decode().strip() or "queue contract rejected")
        return json.loads(result.stdout)

    def save(self, operation: str) -> None:
        self.reduce("read")
        content = encoded(self.document)
        if len(content) > LIMIT:
            raise TransactionError("queue total bytes exceeded")
        expected = MISSING if self.before is None else sha256_bytes(self.before)
        commit_locked(self.binding.queue, operation, [Write("queue.json", content, expected)])
        self.before = content

    def snapshot(self) -> Json:
        linked = {intent["plan"]["id"] for intent in self.document["intents"] if intent["status"] == "linked"}
        pending = any(intent["status"] == "pending" for intent in self.document["intents"])
        readiness = []
        for plan in self.document["plans"]:
            reasons = [(pending, "ACTIVATION_RECOVERY_REQUIRED"), (plan["readiness"] != "ready", plan["readiness"].upper()),
                       (plan["decision_id"] is not None, "DECISION_RESOLUTION_UNAVAILABLE"),
                       (bool(set(plan["prerequisites"]) - linked), "PREREQUISITE_NOT_LINKED")]
            reason = next((label for blocked, label in reasons if blocked), None)
            readiness.append({"plan_id": plan["id"], "eligible": reason is None, "reason": reason})
        return {"queue_revision": self.document["revision"], "queue": self.document["plans"],
                "queue_readiness": readiness,
                "queue_activations": self.document["intents"],
                "queue_acknowledgements": [receipt["result"] for receipt in self.document["commands"]]}


def scoped_fault(scope: str) -> None:
    """Select existing journal fault stages independently for cross-scope QA."""
    requested = os.environ.get("LAZYBUDDY_QUEUE_TX_FAULT", "")
    if requested:
        prefix, _, phase = requested.partition("/")
        if prefix == scope:
            os.environ["LAZYBUDDY_TX_FAULT"] = phase
        else:
            os.environ.pop("LAZYBUDDY_TX_FAULT", None)
