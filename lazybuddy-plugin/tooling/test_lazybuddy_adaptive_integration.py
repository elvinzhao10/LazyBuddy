"""Integration tests for the v1.0.3 adaptive harness pipeline (W3.4 + W3.5).

Exercises the full flow for each fixture:
  classify_adaptive_decision -> validate_adaptive_snapshot
  -> write_adaptive_snapshot -> read_adaptive_snapshot
  -> format_adaptive_explanation -> write_state_file_atomic
  -> load_state_file -> read_adaptive_snapshot again.

NOTE: This file lives in tooling/ rather than tests/ because the Trae IDE
sandbox blocked new-file creation in tests/ during this session. Pytest
discovers it here via `python -m pytest tooling/test_lazybuddy_adaptive_integration.py`.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_explanation import format_adaptive_explanation  # noqa: E402
from lazybuddy_adaptive_snapshot import (  # noqa: E402
    SNAPSHOT_REQUIRED_FIELDS,
    SINGLE_WRITER,
    clear_adaptive_snapshot,
    load_state_file,
    read_adaptive_snapshot,
    validate_adaptive_snapshot,
    write_adaptive_snapshot,
    write_state_file_atomic,
)

# Each fixture: (label, request, context). Covers all 5 modes plus edge cases.
FIXTURES = [
    ("direct-localized", "Fix typo in errors.js", {}),
    ("assisted-unfamiliar", "Diagnose stale data after refactor",
     {"scope": "bounded", "repository_familiarity": "unfamiliar", "file_count": 4}),
    ("planned-broad", "Add export-to-PDF feature",
     {"scope": "broad", "acceptance_criteria": "incomplete"}),
    ("orchestrated-security", "Change authorization logic for /admin/billing endpoint",
     {"risk_signals": ["security-sensitive", "authorization-change"],
      "scope_signals": ["touches authorization middleware"]}),
    ("orchestrated-release", "Cut v2.1.0 release: bump version, update changelog, build artifacts",
     {"risk_signals": ["release-or-publication"]}),
    ("long-horizon", "Migrate session auth to JWT over 3 sessions",
     {"session_scope": "multi-session", "checkpoint_requirement": "durable"}),
    ("explicit-override", "Create a plan only - do not implement yet. Use lazy-ulw-plan", {}),
    ("verify-fail-escalation", "Fix failing unit test",
     {"signals": {"verification_failure": True}, "initial_mode": "direct"}),
    ("provider-fallback", "Refactor search service to support fuzzy matching",
     {"preferred_provider_unavailable": True, "scope": "bounded"}),
    ("empty-default", "", {}),
]


def _base_run_state():
    """Return a minimal v1.0.2-compatible run state with the 15 fixed fields, no adaptive."""
    return {
        "schema_version": "2",
        "run_id": "test-run-001",
        "status": "in_progress",
        "objective": "Test objective",
        "tasks": [],
        "tasks_done": 0,
        "tasks_total": 0,
        "verification_gates": [],
        "review_status": "pending",
        "iteration_count": 0,
        "last_checkpoint": "",
        "created_at": "2026-07-20T00:00:00Z",
        "updated_at": "2026-07-20T00:00:00Z",
        "mode": "adaptive",
        "plan_path": "",
        "current_task_id": "",
    }


@pytest.mark.parametrize("label,request_text,context", FIXTURES,
                         ids=[f[0] for f in FIXTURES])
def test_full_pipeline_classify_to_explanation(label, request_text, context):
    """End-to-end: detector -> snapshot -> write -> read -> explain."""
    decision = classify_adaptive_decision(request_text, context)
    snapshot = decision["snapshot"]
    assert validate_adaptive_snapshot(snapshot), f"{label}: snapshot invalid"

    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, snapshot)
    assert run_state["adaptive"] is not None

    read_back = read_adaptive_snapshot(run_state)
    assert read_back is not None
    assert read_back["mode"] == snapshot["mode"]
    assert read_back["decisionId"] == snapshot["decisionId"]

    explanation = format_adaptive_explanation(run_state)
    assert explanation is not None
    assert "Mode:" in explanation
    assert "Selected stages:" in explanation
    assert "Responsibilities:" in explanation
    assert "Capabilities:" in explanation
    assert "Single-writer: orchestrator" in explanation


@pytest.mark.parametrize("label,request_text,context", FIXTURES,
                         ids=[f[0] for f in FIXTURES])
def test_each_fixture_snapshot_has_all_14_fields(label, request_text, context):
    decision = classify_adaptive_decision(request_text, context)
    snapshot = decision["snapshot"]
    for field in SNAPSHOT_REQUIRED_FIELDS:
        assert field in snapshot, f"{label}: missing {field}"


@pytest.mark.parametrize("label,request_text,context", FIXTURES,
                         ids=[f[0] for f in FIXTURES])
def test_atomic_write_roundtrip_preserves_adaptive(label, request_text, context, tmp_path):
    decision = classify_adaptive_decision(request_text, context)
    snapshot = decision["snapshot"]
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, snapshot)

    state_path = str(tmp_path / "state.json")
    write_state_file_atomic(state_path, run_state)
    loaded = load_state_file(state_path)
    assert "adaptive" in loaded
    assert loaded["adaptive"]["mode"] == snapshot["mode"]
    assert loaded["adaptive"]["decisionId"] == snapshot["decisionId"]
    assert loaded["adaptive"]["updated_at"]  # stamped by write_adaptive_snapshot
    # All 14 fields survive the round-trip
    for field in SNAPSHOT_REQUIRED_FIELDS:
        assert field in loaded["adaptive"], f"{label}: lost {field} after round-trip"


@pytest.mark.parametrize("label,request_text,context", FIXTURES,
                         ids=[f[0] for f in FIXTURES])
def test_each_fixture_explanation_has_required_sections(label, request_text, context):
    decision = classify_adaptive_decision(request_text, context)
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    explanation = format_adaptive_explanation(run_state)
    assert explanation is not None
    for section in ("Mode:", "Selected stages:", "Responsibilities:",
                    "Capabilities:", "Not selected:", "Approval required:",
                    "Escalation count:", "Single-writer:", "Next action:"):
        assert section in explanation, f"{label}: missing section {section!r}"


@pytest.mark.parametrize("label,request_text,context", FIXTURES,
                         ids=[f[0] for f in FIXTURES])
def test_each_fixture_mode_rendered_correctly(label, request_text, context):
    decision = classify_adaptive_decision(request_text, context)
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    explanation = format_adaptive_explanation(run_state)
    expected_mode = decision["mode"]
    # Mode line is the Title-cased form (e.g. "Long Horizon" for "long-horizon").
    expected_title = expected_mode.replace("-", " ").title()
    assert f"Mode: {expected_title}" in explanation


def test_v102_backward_compat_no_adaptive_field():
    """A v1.0.2 state without the adaptive key still loads and explains as None."""
    run_state = _base_run_state()
    run_state.pop("adaptive", None)  # ensure no adaptive key at all
    assert read_adaptive_snapshot(run_state) is None
    assert format_adaptive_explanation(run_state) is None


def test_v102_backward_compat_adaptive_null():
    """A v1.0.2 state with adaptive=null still explains as None."""
    run_state = _base_run_state()
    run_state["adaptive"] = None
    assert read_adaptive_snapshot(run_state) is None
    assert format_adaptive_explanation(run_state) is None


def test_clear_then_explanation_is_none():
    """After clear_adaptive_snapshot, format returns None."""
    decision = classify_adaptive_decision("Fix typo", {})
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    assert format_adaptive_explanation(run_state) is not None
    clear_adaptive_snapshot(run_state)
    assert run_state["adaptive"] is None
    assert format_adaptive_explanation(run_state) is None


def test_single_writer_constant_value():
    """The single-writer rule is the orchestrator across the pipeline."""
    assert SINGLE_WRITER == "orchestrator"
    # Explanation must surface the single-writer rule.
    decision = classify_adaptive_decision("Fix typo", {})
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    explanation = format_adaptive_explanation(run_state)
    assert "Single-writer: orchestrator" in explanation


def test_pipeline_does_not_mutate_caller_snapshot():
    """write_adaptive_snapshot must not mutate the caller's snapshot dict."""
    decision = classify_adaptive_decision("Fix typo", {})
    snapshot = decision["snapshot"]
    original_keys = set(snapshot.keys())
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, snapshot)
    # Caller's snapshot may or may not have updated_at, but the original
    # fields must remain unchanged.
    for field in SNAPSHOT_REQUIRED_FIELDS:
        assert field in snapshot
    # The caller's snapshot should not gain updated_at (write copies it).
    assert "updated_at" not in snapshot or "updated_at" in original_keys


def test_atomic_write_clears_adaptive_on_round_trip(tmp_path):
    """A round-trip with no adaptive block preserves the v1.0.2 shape."""
    run_state = _base_run_state()
    state_path = str(tmp_path / "state.json")
    write_state_file_atomic(state_path, run_state)
    loaded = load_state_file(state_path)
    assert "adaptive" not in loaded
    assert read_adaptive_snapshot(loaded) is None
    assert format_adaptive_explanation(loaded) is None


def test_five_modes_covered_by_fixtures():
    """The fixture set must exercise all 5 modes."""
    modes_seen = set()
    for label, request_text, context in FIXTURES:
        decision = classify_adaptive_decision(request_text, context)
        modes_seen.add(decision["mode"])
    assert modes_seen == {"direct", "assisted", "planned", "orchestrated", "long-horizon"}
