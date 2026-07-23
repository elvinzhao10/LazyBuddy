from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
HOOK = PLUGIN_ROOT / "scripts" / "hooks" / "user-prompt-submit.sh"


def _git(project: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(project), *args],
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    _git(project, "init", "-q")
    _git(project, "config", "user.email", "adaptive@example.invalid")
    _git(project, "config", "user.name", "Adaptive Fixture")
    (project / ".gitignore").write_text(".lazybuddy/\n", encoding="utf-8")
    (project / "tracked.txt").write_text("clean\n", encoding="utf-8")
    _git(project, "add", ".gitignore", "tracked.txt")
    _git(project, "commit", "-qm", "fixture")
    return project


def _state(project: Path, prompt: str, *, status: str = "in_progress") -> Path:
    run_dir = project / ".lazybuddy" / "runs" / "run-1"
    run_dir.mkdir(parents=True)
    state_path = run_dir / "state.json"
    state_path.write_text(
        json.dumps(
            {
                "schema_version": "2",
                "run_id": "run-1",
                "status": status,
                "objective": prompt,
                "tasks": [{"id": "T1", "status": "pending", "future": True}],
                "updated_at": "2026-07-22T00:00:00Z",
                "userField": {"nested": [1, 2, 3]},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return state_path


def _payload(project: Path, prompt: str) -> dict[str, object]:
    return {
        "event": "user_prompt_submit",
        "cwd": str(project),
        "session_id": "installed-state-test",
        "prompt": prompt,
        "adaptive_context": {"scope": "localized", "file_count": 1},
        "adaptive_host": {
            "name": "workbuddy",
            "full_plugin": True,
            "capabilities_confirmed": True,
        },
    }


def _run(project: Path, payload: dict[str, object]) -> dict[str, object]:
    environment = os.environ.copy()
    environment.update(
        {
            "CODEBUDDY_PLUGIN_ROOT": str(PLUGIN_ROOT),
            "CWD": str(project),
        }
    )
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    result = json.loads(completed.stdout)
    assert isinstance(result, dict)
    return result


def test_related_active_state_persists_adaptive_and_preserves_unknown_fields(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)

    # When
    directive = _run(project, _payload(project, prompt))

    # Then
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert directive["persistence"] == "persisted:run-1"
    assert state["adaptive"] == directive["snapshot"]
    assert state["userField"] == {"nested": [1, 2, 3]}
    assert state["tasks"] == [{"id": "T1", "status": "pending", "future": True}]


def test_unrelated_active_state_is_not_overwritten(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    state_path = _state(project, "A different active objective.")
    before = state_path.read_bytes()

    # When
    directive = _run(project, _payload(project, "Fix the localized error message."))

    # Then
    assert directive["persistence"] == "skipped:unrelated-active-state"
    assert state_path.read_bytes() == before


def test_symlinked_state_ancestor_is_rejected_without_outside_write(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (project / ".lazybuddy").symlink_to(outside, target_is_directory=True)

    # When
    directive = _run(project, _payload(project, "Fix the localized error message."))

    # Then
    assert directive["persistence"] == "blocked:unsafe-state-path"
    assert directive["dispatched"] == "blocked:unsafe-state-path"
    assert list(outside.iterdir()) == []


def test_compatible_continuation_resumes_same_decision(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    first = _run(project, _payload(project, prompt))
    payload = _payload(project, prompt)
    payload["continuation_requested"] = True

    # When
    resumed = _run(project, payload)

    # Then
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert resumed["continuation"] == "resumed"
    assert resumed["snapshot"]["decisionId"] == first["snapshot"]["decisionId"]
    assert state["adaptive"]["decisionId"] == first["snapshot"]["decisionId"]


def test_corrupt_persisted_snapshot_reclassifies_without_resuming(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    first = _run(project, _payload(project, prompt))
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["adaptive"].update(
        {
            "capabilityClasses": ["bogus-capability"],
            "currentStage": "bogus-stage",
            "responsibilities": ["bogus-responsibility"],
            "stages": ["bogus-stage"],
        }
    )
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    before = state_path.read_bytes()

    # When
    directive = _run(project, _payload(project, prompt))

    # Then
    assert directive["continuation"] == "stale-reclassified"
    assert directive["persistence"] == "skipped:stale-state-preserved"
    assert directive["snapshot"]["decisionId"] != first["snapshot"]["decisionId"]
    assert "bogus-stage" not in directive["snapshot"]["stages"]
    assert state_path.read_bytes() == before


def test_dirty_revision_reclassifies_and_preserves_stale_snapshot(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    _run(project, _payload(project, prompt))
    before = json.loads(state_path.read_text(encoding="utf-8"))["adaptive"]
    (project / "tracked.txt").write_text("dirty\n", encoding="utf-8")
    payload = _payload(project, prompt)
    payload["continuation_requested"] = True

    # When
    directive = _run(project, payload)

    # Then
    after = json.loads(state_path.read_text(encoding="utf-8"))["adaptive"]
    assert directive["continuation"] == "stale-reclassified"
    assert directive["persistence"] == "skipped:stale-state-preserved"
    assert directive["decision"]["mode"] == "assisted"
    assert after == before
    assert directive["snapshot"]["revisionFingerprint"] != before["revisionFingerprint"]


def test_scope_or_host_mismatch_reclassifies_without_mutating_stale_state(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    _run(project, _payload(project, prompt))
    before = state_path.read_bytes()
    payload = _payload(project, prompt)
    payload["continuation_requested"] = True
    payload["adaptive_context"] = {"scope": "broad", "file_count": 6}
    payload["adaptive_host"] = {
        "name": "codebuddy",
        "full_plugin": True,
        "capabilities_confirmed": True,
    }

    # When
    directive = _run(project, payload)

    # Then
    assert directive["continuation"] == "stale-reclassified"
    assert directive["changedMaterial"] == ["scopeFingerprint"]
    assert directive["runtime"]["host"] == "not-observed"
    assert directive["runtime"]["hostReadiness"] == "pending"
    assert directive["runtime"]["route"] == "fallback-degraded"
    assert directive["persistence"] == "skipped:stale-state-preserved"
    assert state_path.read_bytes() == before


def test_cancelled_run_is_not_an_active_persistence_target(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt, status="cancelled")
    before = state_path.read_bytes()

    # When
    directive = _run(project, _payload(project, prompt))

    # Then
    assert directive["persistence"] == "skipped:no-active-state"
    assert state_path.read_bytes() == before


def test_repeated_interruptions_stop_at_two_adjacent_escalations(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Fix the failing localized check.")
    payload["adaptive_context"] = {
        "initial_mode": "direct",
        "scope_revealed_broader": True,
        "signals": {"verification_failure": True},
    }

    # When
    directive = _run(project, payload)

    # Then
    history = directive["snapshot"]["escalationHistory"]
    assert directive["snapshot"]["escalationCount"] == 2
    assert [transition["sequence"] for transition in history] == [1, 2]
    assert len(history) == 2


def test_existing_state_validator_accepts_persisted_portable_snapshot(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    environment = os.environ.copy()
    environment["CWD"] = str(project)
    created = subprocess.run(
        [
            "bash",
            str(PLUGIN_ROOT / "scripts" / "state" / "create-run.sh"),
            "run-1",
            prompt,
        ],
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    assert created.returncode == 0, created.stderr
    directive = _run(project, _payload(project, prompt))
    assert directive["persistence"] == "persisted:run-1"
    validated = subprocess.run(
        [
            "bash",
            str(PLUGIN_ROOT / "scripts" / "state" / "validate-state.sh"),
            "run-1",
        ],
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    assert validated.returncode == 0, validated.stdout + validated.stderr
    assert validated.stdout.startswith("PASS\n")
