"""Capture real reconciliation rollback and evidence loss before the repair."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: python3 reconcile-probe.py --evidence-dir PATH
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

plugin = Path(__file__).resolve().parents[3]
evidence = Path(sys.argv[2])
records = []
with tempfile.TemporaryDirectory(prefix="b1-reconcile-") as directory:
    root = Path(directory)
    run = root / ".lazybuddy/runs/probe"
    (run / "checkpoints").mkdir(parents=True)
    old = "## TODOs\n- [x] T1: old requirement\n"
    new = "## TODOs\n- [x] T1: new requirement\n"
    state = {"run_id": "probe", "tasks": [{"id": "T1", "status": "done", "evidence": ["proof.txt"]}],
             "plan_reference": ".lazybuddy/runs/probe/plan.md", "progress": {"total_checkboxes": 1, "completed_checkboxes": 1}}
    (run / "state.json").write_text(json.dumps(state))
    (run / "events.jsonl").write_text("")
    (run / ".revision").write_text("1\n")
    (run / "plan.md").write_text(new)
    (run / "checkpoints/plan-revision.md").write_text(old)
    (run / "proof.txt").write_text("immutable proof\n")
    for fault in ["after-journal", ""]:
        argv = ["bash", str(plugin / "scripts/state/sync-plan-state.sh"), "probe", "--fix"]
        before = {name: (run / name).read_text() for name in ["state.json", "checkpoints/plan-revision.md", ".revision"]}
        result = subprocess.run(argv, env={**os.environ, "CWD": directory, "LAZYBUDDY_TX_FAULT": fault}, capture_output=True, text=True, timeout=20)
        recovery = subprocess.run([sys.executable, str(plugin / "scripts/state/state-transaction.py"), "recover", str(run)], capture_output=True, text=True, timeout=20)
        after = {name: (run / name).read_text() for name in before}
        records.append({"argv": argv, "fault": fault, "before": before, "exit": result.returncode,
                        "stdout": result.stdout, "stderr": result.stderr, "recovery": recovery.stdout, "after": after})
        if fault:
            (run / "checkpoints/plan-revision.md").write_text(old)
    records.append({"cleanup_registered": directory})
records.append({"cleanup_absent": not root.exists()})
(evidence / "reconcile-probe.json").write_text(json.dumps(records, indent=2) + "\n")
print(json.dumps(records, indent=2))
