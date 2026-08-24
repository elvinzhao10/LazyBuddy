from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from test_lazybuddy_adaptive_installed_state import (
    PLUGIN_ROOT,
    _payload,
    _project,
    _run,
    _state,
)


APPEND_EVENT = PLUGIN_ROOT / "scripts" / "state" / "append-event.sh"
MATERIAL_FINGERPRINTS = (
    "host", "profile", "probe", "binary", "session", "worktree", "mcp",
    "generated_asset", "marketplace",
)
STORED_FINGERPRINTS = (*MATERIAL_FINGERPRINTS, "root", "revision")


def _bind_native_material(state_path: Path, project: Path) -> None:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["session_ids"] = ["installed-state-test"]
    state["runtime_fingerprints"] = [{
        "session_id": "installed-state-test",
        "host": "codebuddy-cli",
        "worktree": str(project),
        "fingerprints": {
            name: f"sha256:{index:064x}"
            for index, name in enumerate(STORED_FINGERPRINTS, start=1)
        },
    }]
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _progressed_native_state(tmp_path: Path) -> tuple[Path, Path, dict[str, object]]:
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    _bind_native_material(state_path, project)
    first = _run(project, _payload(project, prompt))
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["adaptive"]["currentStage"] = "implement"
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return project, state_path, first


def test_pin_compatible_resume_preserves_exact_decision_and_stage(tmp_path: Path) -> None:
    project, _, first = _progressed_native_state(tmp_path)

    resumed = _run(project, _payload(project, "Fix the localized error message."))

    assert resumed["continuation"] == "resumed"
    assert resumed["snapshot"]["decisionId"] == first["snapshot"]["decisionId"]
    assert resumed["snapshot"]["currentStage"] == "implement"


@pytest.mark.parametrize("changed_name", MATERIAL_FINGERPRINTS)
def test_material_fingerprint_mutation_reclassifies_native_continuation(
    tmp_path: Path,
    changed_name: str,
) -> None:
    project, state_path, first = _progressed_native_state(tmp_path)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["runtime_fingerprints"][0]["fingerprints"][changed_name] = "sha256:" + "f" * 64
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    resumed = _run(project, _payload(project, "Fix the localized error message."))

    assert resumed["continuation"] == "stale-reclassified"
    assert resumed["changedMaterial"] == ["hostFingerprint"]
    assert resumed["snapshot"]["decisionId"] != first["snapshot"]["decisionId"]
    assert resumed["snapshot"]["currentStage"] == "understand"


def test_unavailable_selected_probe_fails_closed_without_state_write(tmp_path: Path) -> None:
    project, state_path, _ = _progressed_native_state(tmp_path)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["runtime_fingerprints"][0]["fingerprints"]["probe"] = "unavailable"
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    before = state_path.read_bytes()

    resumed = _run(project, _payload(project, "Fix the localized error message."))

    assert resumed["dispatched"] == "blocked:runtime-fingerprint-unavailable"
    assert resumed["persistence"] == "skipped:runtime-fingerprint-unavailable"
    assert state_path.read_bytes() == before


@pytest.mark.parametrize("corruption", ("missing-host", "extra-fingerprint"))
def test_malformed_selected_binding_fails_closed_without_state_write(
    tmp_path: Path,
    corruption: str,
) -> None:
    project, state_path, _ = _progressed_native_state(tmp_path)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    binding = state["runtime_fingerprints"][0]
    if corruption == "missing-host":
        del binding["host"]
    else:
        binding["fingerprints"]["unexpected"] = "sha256:" + "f" * 64
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    before = state_path.read_bytes()

    resumed = _run(project, _payload(project, "Fix the localized error message."))

    assert resumed["dispatched"] == "blocked:runtime-fingerprint-unavailable"
    assert resumed["persistence"] == "skipped:runtime-fingerprint-unavailable"
    assert state_path.read_bytes() == before


def _event_fixture(tmp_path: Path, event_id: str) -> tuple[Path, Path, list[str], dict[str, str]]:
    project = _project(tmp_path)
    run_dir = _state(project, "Record native continuation evidence.").parent
    events_path = run_dir / "events.jsonl"
    events_path.write_text("", encoding="utf-8")
    payload = json.dumps({"event_id": event_id, "status": "accepted"})
    command = ["bash", str(APPEND_EVENT), "run-1", "native_continuation", payload]
    return run_dir, events_path, command, {**os.environ, "CWD": str(project)}


def _invoke_event(command: list[str], environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, check=False, capture_output=True, text=True,
        env=environment, timeout=5,
    )


def test_canonical_event_is_durable_before_idempotent_product_mirror(tmp_path: Path) -> None:
    run_dir, events_path, command, environment = _event_fixture(tmp_path, "event:todo28:001")

    first = _invoke_event(command, environment)
    replay = _invoke_event(command, environment)

    canonical = [json.loads(line) for line in (run_dir / "canonical-events.jsonl").read_text(encoding="utf-8").splitlines()]
    mirrored = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
    assert first.returncode == replay.returncode == 0
    assert canonical == [{
        "schema_version": 1, "event_id": "event:todo28:001",
        "ts": canonical[0]["ts"], "run_id": "run-1",
        "event": "native_continuation", "event_payload": {"status": "accepted"},
    }]
    assert len(mirrored) == 1
    assert mirrored[0]["event_id"] == "event:todo28:001"


def test_replay_repairs_interrupted_mirror_from_canonical_record(tmp_path: Path) -> None:
    run_dir, events_path, command, environment = _event_fixture(tmp_path, "event:todo28:repair")
    first = _invoke_event(command, environment)
    events_path.write_text("", encoding="utf-8")

    replay = _invoke_event(command, environment)

    assert first.returncode == replay.returncode == 0
    assert len((run_dir / "canonical-events.jsonl").read_text(encoding="utf-8").splitlines()) == 1
    assert len(events_path.read_text(encoding="utf-8").splitlines()) == 1


def test_malformed_event_fails_closed_and_prompt_injection_remains_inert(tmp_path: Path) -> None:
    project = _project(tmp_path)
    run_dir = _state(project, "Reject malformed native event.").parent
    sentinel = tmp_path / "prompt-injection-ran"
    payload = json.dumps({
        "event_id": "event:todo28:hostile", "event": "forged",
        "detail": f"$(touch {sentinel})",
    })

    completed = _invoke_event(
        ["bash", str(APPEND_EVENT), "run-1", "native_continuation", payload],
        {**os.environ, "CWD": str(project)},
    )

    assert completed.returncode != 0
    assert "overrides canonical identity" in completed.stderr
    assert not (run_dir / "canonical-events.jsonl").exists()
    assert not (run_dir / "events.jsonl").exists()
    assert not sentinel.exists()
