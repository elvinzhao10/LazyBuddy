from __future__ import annotations

import json
from pathlib import Path

from test_lazybuddy_adaptive_installed_state import (
    _payload,
    _project,
    _run,
    _state,
)


FINGERPRINT_NAMES = (
    "host",
    "profile",
    "probe",
    "binary",
    "session",
    "worktree",
    "mcp",
    "generated_asset",
    "marketplace",
    "root",
    "revision",
)


LEGACY_INACTIVE_PACKET = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "efficiency"
    / "evals"
    / "lazybuddy-liveeval"
    / "lazybuddy"
    / "raw"
    / "direct"
    / "adaptive-directive.json"
)


def test_ordinary_requests_select_the_lowest_existing_workflow_without_commands(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    simple = _run(project, _payload(project, "Rename the local heading."))
    complex_payload = _payload(
        project,
        "Implement the cache correction across the parser and renderer.",
    )
    complex_payload["adaptive_context"] = {"scope": "cross-file", "file_count": 4}
    complex_decision = _run(project, complex_payload)

    assert simple["decision"]["mode"] == "direct"
    assert simple["runtime"]["workflowSurfaces"] == []
    assert complex_decision["decision"]["mode"] == "assisted"
    assert complex_decision["runtime"]["workflowSurfaces"] == []
    assert complex_decision["selection"]["workflowSurfaces"] == ["lazy-start-work"]
    assert simple["decision"]["explicitWorkflow"] is None
    assert complex_decision["decision"]["explicitWorkflow"] is None


def test_inactive_packet_is_quiet_compact_and_keeps_decision_fields(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    directive = _run(project, _payload(project, "Rename the local heading."))
    encoded = json.dumps(directive, separators=(",", ":"), sort_keys=True).encode()

    assert directive["dispatched"] == "selected:host-unobserved"
    assert directive["runtime"]["route"] == "selection-only"
    assert directive["runtime"]["degraded"] is False
    assert directive["runtime"]["workflowSurfaces"] == []
    assert "explanation" not in directive
    assert set(directive["decision"]) == {
        "approval",
        "explicitWorkflow",
        "mode",
        "responsibilities",
        "stages",
        "verificationLevel",
    }
    assert len(encoded) < LEGACY_INACTIVE_PACKET.stat().st_size * 3 // 4


def test_post_compaction_reuses_only_current_session_identity(tmp_path: Path) -> None:
    project = _project(tmp_path)
    prompt = "Fix the localized error message."
    state_path = _state(project, prompt)
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["last_compaction"] = "2026-09-05T12:00:00Z"
    state["session_ids"] = ["current-session"]
    state["runtime_fingerprints"] = [
        {
            "session_id": "current-session",
            "host": "workbuddy",
            "worktree": str(project),
            "fingerprints": {
                name: f"sha256:{index:064x}"
                for index, name in enumerate(FINGERPRINT_NAMES, start=1)
            },
        }
    ]
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    stale_payload = _payload(project, prompt)
    stale_payload["session_id"] = "stale-session"
    stale = _run(project, stale_payload)

    assert stale["continuation"] == "new"
    assert stale["persistence"] == "skipped:stale-compaction-state"
    assert "adaptive" not in json.loads(state_path.read_text(encoding="utf-8"))

    current_payload = _payload(project, prompt)
    current_payload["session_id"] = "current-session"
    current = _run(project, current_payload)
    resumed = _run(project, current_payload)

    assert current["persistence"] == "persisted:run-1"
    assert resumed["continuation"] == "resumed"
    assert resumed["snapshot"]["decisionId"] == current["snapshot"]["decisionId"]


def test_adaptive_memory_changes_only_after_an_accepted_boundary(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    prompt = "Install the dependency and fix the localized error."
    state_path = _state(project, prompt)
    before = state_path.read_bytes()

    blocked = _run(project, _payload(project, prompt))

    assert blocked["dispatched"] == "blocked:approval-required"
    assert blocked["persistence"] == "skipped:approval-required"
    assert state_path.read_bytes() == before


def test_terminal_result_is_not_reused_as_current_memory(tmp_path: Path) -> None:
    project = _project(tmp_path)
    prompt = "Rename the local heading."
    state_path = _state(project, prompt, status="complete")
    before = state_path.read_bytes()

    recovered = _run(project, _payload(project, prompt))

    assert recovered["continuation"] == "new"
    assert recovered["persistence"] == "skipped:no-active-state"
    assert state_path.read_bytes() == before
