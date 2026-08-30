#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Final, TypedDict

from state_transaction import Write, commit_locked, locked, recover_locked

STORE_VERSION: Final = "lazyseries.cost-outcome-store.v1"
RECORD_VERSION: Final = "lazyseries.cost-outcome.v1"
RETENTION: Final = 20


class CostRecord(TypedDict):
    schema_version: str
    run_id: str
    project_identity: str
    route: str
    risk_reason: str
    elapsed_ms: int
    tool_invocations: int
    agent_invocations: int
    evidence_bytes: int
    reruns: int
    rework_count: int
    gate_outcomes: list[dict[str, str]]
    tokens: dict[str, str | int | None]


def parse_record(raw: str) -> CostRecord:
    value = json.loads(raw)
    required = {
        "schema_version", "run_id", "project_identity", "route", "risk_reason", "elapsed_ms",
        "tool_invocations", "agent_invocations", "evidence_bytes", "reruns", "rework_count",
        "gate_outcomes", "tokens",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise RuntimeError("cost outcome fields are invalid")
    if value["schema_version"] != RECORD_VERSION:
        raise RuntimeError("cost outcome schema version is invalid")
    return value


def read_store(path: Path) -> tuple[list[CostRecord], CostRecord | None]:
    if not path.exists():
        return [], None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != STORE_VERSION:
        raise RuntimeError("cost outcome telemetry store is invalid")
    completed = value.get("completed")
    if not isinstance(completed, list):
        raise RuntimeError("cost outcome completed records are invalid")
    return completed, value.get("current_run")


def record(project_root: Path, item: CostRecord) -> None:
    state_dir = project_root / ".lazybuddy" / "state" / "telemetry"
    state_dir.mkdir(parents=True, exist_ok=True)
    target = state_dir / "cost-outcomes.json"
    with locked(state_dir):
        recover_locked(state_dir)
        completed, _current = read_store(target)
        retained = [record for record in completed if record.get("run_id") != item["run_id"]]
        retained.append(item)
        store = {
            "schema_version": STORE_VERSION,
            "current_run": item,
            "completed": retained[-RETENTION:],
        }
        content = (json.dumps(store, indent=2, sort_keys=True) + "\n").encode()
        commit_locked(state_dir, "record_cost_outcome", (Write(target.name, content),))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise RuntimeError("usage: cost_outcome_telemetry.py PROJECT_ROOT")
    project_root = Path(argv[1])
    if not project_root.is_absolute() or project_root.is_symlink() or not project_root.is_dir():
        raise RuntimeError("telemetry project root is unsafe")
    record(project_root, parse_record(sys.stdin.read()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
