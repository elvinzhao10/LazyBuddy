"""Controlled filesystem interleavings through the locked capture boundary."""
# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
# How to run: python3 -m pytest -q -s lazybuddy-plugin/tests/test_dashboard_completion.py
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/state"))
import dashboard_completion as completion
from dashboard_files import Binding, Files
from state_transaction import locked


@pytest.mark.parametrize("changed", ["authority", "plan", "receipt", "review", "artifact", "revert", "state", "git"])
def test_capture_rejects_changed_complete_reference_set(monkeypatch: pytest.MonkeyPatch, changed: str) -> None:
    with tempfile.TemporaryDirectory(prefix="b4-capture-race-") as temporary:
        root = Path(temporary).resolve()
        run = root / ".lazybuddy/runs/probe"
        run.mkdir(parents=True)
        (root / ".gitignore").write_text(".lazybuddy/\n")
        for args in [("init", "-q"), ("add", ".gitignore"), ("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture")]:
            subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=True, timeout=5)
        names = {name: f".lazybuddy/{name}.json" for name in ["plan", "receipt", "review", "artifact"]}
        names["authority"] = ".lazybuddy/runs/probe/completion-authority.json"
        names["state"] = ".lazybuddy/runs/probe/state.json"
        authority = {"plan": {"path": names["plan"]}, "criteria": [{"evidence_path": names["receipt"], "review_path": names["review"]}]}
        for name, relative in names.items():
            value = authority if name == "authority" else {"artifact": {"path": names["artifact"]}} if name == "receipt" else {"value": "original"}
            (root / relative).write_text(json.dumps(value))
        binding = Binding(root, run, "project", "probe", "reader", "node")
        files = Files(binding)
        before = {name: (root / relative).read_text() for name, relative in names.items()}
        original = completion.record
        calls = []

        def interleaved_record(directory: Path, relative: str) -> completion.Record:
            value = original(directory, relative)
            calls.append(relative)
            if relative == names["artifact"] and calls.count(relative) == 1:
                target = root / names["artifact" if changed == "revert" else changed] if changed != "git" else root / "untracked.txt"
                target.write_text("changed")
                if changed == "revert":
                    target.write_text(before["artifact"])
            return value

        monkeypatch.setattr(completion, "record", interleaved_record)
        with locked(run):
            files.read("state.json")
            bundle = completion.capture_completion(files)
        assert bundle["consistent"] is False
        print(json.dumps({"scenario": changed, "before": before,
                          "after": {name: (root / relative).read_text() for name, relative in names.items()},
                          "consistent": bundle["consistent"], "reads": calls, "root": str(root)}))
    assert not root.exists()
    print(json.dumps({"cleanup_absent": str(root)}))
