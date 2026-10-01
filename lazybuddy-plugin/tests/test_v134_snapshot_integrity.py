"""Black-box stale-snapshot and finalization regressions in isolated projects."""
# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
# How to run: python3 -m pytest --import-mode=importlib tests/test_v134_snapshot_integrity.py
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import pytest

PLUGIN = Path(__file__).resolve().parents[1]
PRODUCT = PLUGIN.name.split("-")[0]


def seed(root: Path, task_status: str = "queued") -> Path:
    run = root / ("." + PRODUCT) / "runs" / "probe"
    run.mkdir(parents=True)
    state = {"run_id": "probe", "objective": "fixture", "status": "executing",
             "iteration": {"count": 0, "max": 500}, "review_status": "accepted",
             "verification_gates": [{"name": "test", "status": "passed"}],
             "tasks": [{"id": "T1", "status": task_status, "depends_on": []}],
             "plan_reference": "." + PRODUCT + "/runs/probe/plan.md"}
    (run / "state.json").write_text(json.dumps(state))
    (run / "events.jsonl").write_text("")
    (run / ".revision").write_text("7\n")
    (run / "plan.md").write_text("## TODOs\n- [x] T1: fixture task\n")
    return run


def environment(root: Path) -> dict[str, str]:
    return {**os.environ, "CWD": str(root), "PYTHONDONTWRITEBYTECODE": "1"}


def test_stale_shell_snapshot_cannot_overwrite_concurrent_commit(tmp_path: Path) -> None:
    # Given a run and a deterministic writer interleaved immediately before late hashes.
    run = seed(tmp_path)
    state = run / "state.json"
    old_digest = hashlib.sha256(state.read_bytes()).hexdigest()
    concurrent = json.loads(state.read_text())
    concurrent["concurrent_writer"] = "preserve-this-update"
    source = tmp_path / "concurrent.json"
    source.write_text(json.dumps(concurrent))
    binary = tmp_path / "bin"
    binary.mkdir()
    marker = tmp_path / "interleaved"
    real_shasum = shutil.which("shasum")
    assert real_shasum is not None
    transaction = PLUGIN / "scripts/state/state-transaction.py"
    interleave = shlex.join([sys.executable, str(transaction), "commit", str(run), "concurrent",
                            "state.json|" + old_digest + "|" + str(source)])
    shim = binary / "shasum"
    shim.write_text("#!/bin/sh\nset -eu\nif [ ! -f " + shlex.quote(str(marker)) + " ]; then\n"
                    "  touch " + shlex.quote(str(marker)) + "\n  " + interleave + " >/dev/null\nfi\nexec "
                    + shlex.quote(real_shasum) + " \"$@\"\n")
    shim.chmod(0o755)
    env = environment(tmp_path)
    env["PATH"] = str(binary) + os.pathsep + env["PATH"]
    # When update-task tries to commit bytes prepared before the other writer.
    result = subprocess.run(["bash", str(PLUGIN / "scripts/state/update-task.sh"), "probe", "T1", "done"],
                            env=env, capture_output=True, text=True, timeout=15)
    # Then its stale write is rejected while the concurrent state and revision survive.
    assert marker.exists()
    assert result.returncode != 0, result.stdout + result.stderr
    assert state.read_bytes() == source.read_bytes()
    assert (run / ".revision").read_text().strip() == "8"
    assert not (run / ".transaction-journal").exists()


@pytest.mark.parametrize("task_status", ["failed", "skipped", "unknown", "blocked", "queued", "running"])
def test_finalization_rejects_every_unfinished_task(tmp_path: Path, task_status: str) -> None:
    # Given passed verification/review and checked plan, but unfinished canonical work.
    run = seed(tmp_path, task_status)
    before = (run / "state.json").read_bytes()
    # When finalization checks the run.
    result = subprocess.run(["bash", str(PLUGIN / "scripts/loop/finalize-run.sh"), "probe"],
                            env=environment(tmp_path), capture_output=True, text=True, timeout=15)
    # Then no completion mutation or revision is committed.
    assert result.returncode != 0, result.stdout + result.stderr
    assert (run / "state.json").read_bytes() == before
    assert (run / ".revision").read_text().strip() == "7"


def test_finalization_preserves_valid_completion(tmp_path: Path) -> None:
    # Given completed canonical tasks and all existing completion gates passed.
    run = seed(tmp_path, "done")
    # When finalizing the run.
    result = subprocess.run(["bash", str(PLUGIN / "scripts/loop/finalize-run.sh"), "probe"],
                            env=environment(tmp_path), capture_output=True, text=True, timeout=15)
    # Then the existing completion route still commits exactly once.
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads((run / "state.json").read_text())["status"] == "complete"
    assert (run / ".revision").read_text().strip() == "8"


def test_legacy_commit_helper_without_snapshot_still_works(tmp_path: Path) -> None:
    # Given an explicit content write using the pre-existing commit helper contract.
    run = seed(tmp_path)
    target = run / "state.json"
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    source = tmp_path / "prepared.json"
    source.write_bytes(target.read_bytes())
    helper = PLUGIN / "scripts/state/state-paths.sh"
    script = "set -eu\nsource " + shlex.quote(str(helper)) + "\n" + shlex.join(
        ["state_commit_transaction", str(run), "compatible", "state.json|" + digest + "|" + str(source)])
    # When invoking it without a snapshot token, as existing explicit writers do.
    result = subprocess.run(["bash", "-c", script], env=environment(tmp_path), capture_output=True, text=True, timeout=15)
    # Then backward compatibility and Bash nounset safety are retained.
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == source.read_bytes()
    assert (run / ".revision").read_text().strip() == "8"


def test_read_only_plan_sync_preserves_state_and_revision(tmp_path: Path) -> None:
    # Given canonical work and a checked plan to inspect.
    run = seed(tmp_path, "done")
    before = (run / "state.json").read_bytes()
    # When sync is called without --fix.
    result = subprocess.run(["bash", str(PLUGIN / "scripts/state/sync-plan-state.sh"), "probe"],
                            env=environment(tmp_path), capture_output=True, text=True, timeout=15)
    # Then inspection does not acquire a mutation revision or rewrite state.
    assert result.returncode == 0, result.stdout + result.stderr
    assert (run / "state.json").read_bytes() == before
    assert (run / ".revision").read_text().strip() == "7"


def test_unversioned_human_plan_edit_survives_checkbox_snapshot(tmp_path: Path) -> None:
    # Given unchecked work and a human edit interleaved after snapshot generation.
    run = seed(tmp_path)
    plan = run / "plan.md"
    original = "## TODOs\n- [ ] T1: fixture task\n"
    human = "\nHuman note added while the agent prepared its checkbox patch.\n"
    plan.write_text(original)
    state_before = (run / "state.json").read_bytes()
    binary = tmp_path / "bin"
    binary.mkdir()
    marker = tmp_path / "human-edited"
    real_shasum = shutil.which("shasum")
    assert real_shasum is not None
    shim = binary / "shasum"
    shim.write_text("#!/bin/sh\nset -eu\nif [ ! -f " + shlex.quote(str(marker)) + " ]; then\n"
                    "  touch " + shlex.quote(str(marker)) + "\n  printf '%s' " + shlex.quote(human)
                    + " >> " + shlex.quote(str(plan)) + "\nfi\nexec " + shlex.quote(real_shasum) + " \"$@\"\n")
    shim.chmod(0o755)
    env = environment(tmp_path)
    env["PATH"] = str(binary) + os.pathsep + env["PATH"]
    # When checkbox update commits with a plan snapshot made before the human edit.
    result = subprocess.run(["bash", str(PLUGIN / "scripts/state/update-plan-checkbox.sh"), "probe", "T1"],
                            env=env, capture_output=True, text=True, timeout=15)
    # Then the captured plan digest rejects the write independently of run revision.
    assert marker.exists()
    assert result.returncode != 0, result.stdout + result.stderr
    assert plan.read_text() == original + human
    assert (run / "state.json").read_bytes() == state_before
    assert (run / ".revision").read_text().strip() == "7"
    assert not (run / ".transaction-journal").exists()


def test_checkbox_update_commits_captured_plan_and_task(tmp_path: Path) -> None:
    run = seed(tmp_path)
    plan = run / "plan.md"
    original = "## TODOs\n- [ ] T1: fixture task\n\nHuman note: café.\n"
    plan.write_text(original)
    result = subprocess.run(["bash", str(PLUGIN / "scripts/state/update-plan-checkbox.sh"), "probe", "T1"],
                            env=environment(tmp_path), capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert plan.read_text() == original.replace("- [ ]", "- [x]", 1)
    assert json.loads((run / "state.json").read_text())["tasks"][0]["status"] == "done"
    assert (run / ".revision").read_text().strip() == "8"
    assert not (run / ".transaction-journal").exists()
