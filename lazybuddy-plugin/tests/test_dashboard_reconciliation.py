"""Exercise reconciliation checkpoint and history through actual shell entrypoints."""
# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
# How to run: python3 -m pytest -q lazybuddy-plugin/tests/test_dashboard_reconciliation.py
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

PLUGIN = Path(__file__).resolve().parents[1]


def seed(root: Path) -> Path:
    run = root / ".lazybuddy/runs/probe"
    (run / "checkpoints").mkdir(parents=True)
    state = {"run_id": "probe", "tasks": [{"id": "T1", "status": "done", "evidence": ["proof.txt"]}],
             "plan_reference": ".lazybuddy/runs/probe/plan.md", "progress": {"total_checkboxes": 1, "completed_checkboxes": 1}}
    (run / "state.json").write_text(json.dumps(state))
    (run / "events.jsonl").write_text("")
    (run / ".revision").write_text("1\n")
    (run / "plan.md").write_text("## TODOs\n- [x] T1: new requirement\n")
    (run / "checkpoints/plan-revision.md").write_text("## TODOs\n- [x] T1: old requirement\n")
    (root / "proof.txt").write_text("original evidence\n")
    return run


def sync(root: Path, fault: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(PLUGIN / "scripts/state/sync-plan-state.sh"), "probe", "--fix"],
                          env={**os.environ, "CWD": str(root), "LAZYBUDDY_TX_FAULT": fault}, capture_output=True, text=True, timeout=15)


@pytest.mark.parametrize("fault", ["after-stage", "after-journal", "after-commit", "after-install:1"])
def test_checkpoint_and_history_are_one_recoverable_commit(tmp_path: Path, fault: str) -> None:
    run = seed(tmp_path)
    old = (run / "checkpoints/plan-revision.md").read_bytes()
    assert sync(tmp_path, fault).returncode == 86
    recovery = subprocess.run([sys.executable, str(PLUGIN / "scripts/state/state-transaction.py"), "recover", str(run)], capture_output=True, text=True, timeout=15)
    assert recovery.returncode == 0, recovery.stderr
    committed = fault in ("after-commit", "after-install:1")
    assert (run / "checkpoints/plan-revision.md").read_bytes() == ((run / "plan.md").read_bytes() if committed else old)
    assert int((run / ".revision").read_text()) == 1 + committed
    if not committed:
        result = sync(tmp_path)
        assert result.returncode == 0, result.stderr
    state = json.loads((run / "state.json").read_text())
    assert state["tasks"][0]["evidence"] == ["proof.txt"]
    assert state["tasks"][0]["status"] == "queued"
    history = json.loads((run / "history/reconciliation-1/state.json").read_text())
    assert history["tasks"][0]["status"] == "done"
    assert (run / "history/reconciliation-1/artifacts/0").read_text() == "original evidence\n"
    assert sync(tmp_path).returncode == 0
    assert json.loads((run / "state.json").read_text())["tasks"][0]["status"] == "queued"


def test_invalid_plan_and_symlink_checkpoint_do_not_advance_snapshot(tmp_path: Path) -> None:
    run = seed(tmp_path)
    old = (run / "checkpoints/plan-revision.md").read_bytes()
    (run / "plan.md").write_text("not a valid checkbox plan")
    assert sync(tmp_path).returncode != 0
    assert (run / "checkpoints/plan-revision.md").read_bytes() == old
    checkpoint = run / "checkpoints/plan-revision.md"
    checkpoint.unlink()
    checkpoint.symlink_to(tmp_path / "proof.txt")
    assert sync(tmp_path).returncode != 0
    assert (tmp_path / "proof.txt").read_text() == "original evidence\n"


def test_cosmetic_plan_change_preserves_evidence_and_execution(tmp_path: Path) -> None:
    run = seed(tmp_path)
    (run / "plan.md").write_text("# Renamed heading\n\n## TODOs\n- [x] T1: old requirement\n")
    result = sync(tmp_path)
    assert result.returncode == 0, result.stderr
    task = json.loads((run / "state.json").read_text())["tasks"][0]
    assert task["status"] == "done"
    assert task["evidence"] == ["proof.txt"]
    assert "evidence_status" not in task
