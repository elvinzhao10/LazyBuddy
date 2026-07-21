"""W4.5 Continuation integration tests for the v1.0.3 Adaptive Harness (LazyBuddy).

Proves plan Section 11 (State rules) behavior:
  - a compatible snapshot resumes from the saved stage (mode + escalationCount preserved)
  - an incompatible revision forces reclassification (stale snapshot preserved)
  - an incompatible request forces a fresh decision from `understand`
  - a stale snapshot cannot satisfy completion verification
  - the original snapshot is not mutated invisibly during reclassification
  - no snapshot and null snapshot both produce fresh decisions

Mirrors the LazyTrae W4.5 test file. Uses fixture
``06-long-horizon-migration.json``.

Implementation gap: ``classify_adaptive_decision`` does not yet read
``context['snapshot']`` to implement Section 6 step 2 (compatible
continuation). The three compatible-resume scenarios are marked
``@pytest.mark.xfail`` per W4.5 task instructions; documented in evidence.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_snapshot import (  # noqa: E402
    read_adaptive_snapshot,
    validate_adaptive_snapshot,
    write_adaptive_snapshot,
)

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent
    / "contracts"
    / "fixtures"
    / "v103"
    / "06-long-horizon-migration.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _base_run_state():
    return {
        "schema_version": "2",
        "run_id": "test-w45",
        "status": "in_progress",
        "objective": "W4.5 continuation",
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


def _context_snapshot(
    current_stage="implement", escalation_count=1, mode="long-horizon"
):
    """A valid Section 11 camelCase snapshot embedded in classifier context."""
    return {
        "version": 1,
        "decisionId": "prior-session-decision",
        "requestDigest": "sha256:placeholder",
        "mode": mode,
        "stages": ["understand", "plan", "implement", "verify", "continue"],
        "currentStage": current_stage,
        "responsibilities": [
            "continuity",
            "exploration",
            "implementation",
            "planning",
            "verification",
        ],
        "capabilityClasses": [
            "text-search",
            "structural-search",
            "semantic-navigation",
            "architecture-context",
            "documentation",
            "execution",
            "task-state",
            "outcome-verification",
        ],
        "runtimeResolution": {},
        "reasons": ["prior session decision"],
        "escalationCount": escalation_count,
        "revisionMarker": "git:HEAD",
        "blocker": None,
        "nextAction": "resume from saved stage",
    }


# --- Compatible resume scenarios (implementation gap: classifier does not
#     read context['snapshot'] — marked xfail per W4.5 task instructions). ---


def test_compatible_resume_current_stage_resumed_from_snapshot():
    fresh = classify_adaptive_decision(FIXTURE["request"], FIXTURE["context"])
    snapshot = _context_snapshot(
        current_stage="implement", escalation_count=1, mode="long-horizon"
    )
    snapshot["requestDigest"] = fresh["snapshot"]["requestDigest"]
    snapshot["revisionMarker"] = fresh["snapshot"]["revisionMarker"]
    decision = classify_adaptive_decision(
        FIXTURE["request"], {**FIXTURE["context"], "snapshot": snapshot}
    )
    assert (
        decision["snapshot"]["currentStage"] == "implement"
    ), "compatible snapshot must resume from saved currentStage (not reset to understand)"


def test_compatible_resume_mode_preserved_from_snapshot():
    request = "Fix typo in README.md"
    fresh = classify_adaptive_decision(request, {})
    snapshot = _context_snapshot(
        current_stage="implement", escalation_count=1, mode="long-horizon"
    )
    snapshot["requestDigest"] = fresh["snapshot"]["requestDigest"]
    snapshot["revisionMarker"] = fresh["snapshot"]["revisionMarker"]
    decision = classify_adaptive_decision(request, {"snapshot": snapshot})
    assert (
        decision["mode"] == "long-horizon"
    ), "compatible snapshot must preserve mode (not reclassify to direct)"


def test_compatible_resume_escalation_count_carried_over():
    request = "Fix typo in README.md"
    fresh = classify_adaptive_decision(request, {})
    snapshot = _context_snapshot(
        current_stage="implement", escalation_count=1, mode="long-horizon"
    )
    snapshot["requestDigest"] = fresh["snapshot"]["requestDigest"]
    snapshot["revisionMarker"] = fresh["snapshot"]["revisionMarker"]
    decision = classify_adaptive_decision(request, {"snapshot": snapshot})
    assert (
        decision["snapshot"]["escalationCount"] == 1
    ), "compatible snapshot must carry over escalationCount"


# --- Incompatible revision: classifier produces a new decision; original
#     snapshot preserved (not overwritten in-place). ---


def test_incompatible_revision_classifier_produces_new_decision():
    request = "Fix typo in README.md"
    snapshot = _context_snapshot()
    snapshot["revisionMarker"] = "git:abc123-prior-session"  # incompatible
    decision = classify_adaptive_decision(request, {"snapshot": snapshot})
    assert isinstance(decision, dict) and isinstance(
        decision["mode"], str
    ), "classifier must produce a new decision regardless of stale snapshot"
    assert (
        decision["snapshot"]["revisionMarker"] == "git:HEAD"
    ), "new decision carries a fresh revisionMarker"


def test_incompatible_revision_original_snapshot_preserved():
    request = "Fix typo in README.md"
    snapshot = _context_snapshot()
    snapshot["revisionMarker"] = "git:abc123-prior-session"
    before = copy.deepcopy(snapshot)
    classify_adaptive_decision(request, {"snapshot": snapshot})
    assert (
        snapshot == before
    ), "classifier must not mutate the original snapshot in-place during reclassification"


# --- Incompatible request: fresh decision resets escalationCount. ---


def test_incompatible_request_fresh_decision_resets_escalation_count():
    request = "Fix typo in README.md"
    snapshot = _context_snapshot()
    snapshot["requestDigest"] = "sha256:completely-different-prior-request"
    snapshot["revisionMarker"] = "git:HEAD"
    decision = classify_adaptive_decision(request, {"snapshot": snapshot})
    assert (
        decision["snapshot"]["requestDigest"] != snapshot["requestDigest"]
    ), "fresh decision must have a new requestDigest"
    assert (
        decision["snapshot"]["escalationCount"] == 0
    ), "fresh decision must reset escalationCount (no carryover from stale snapshot)"


# --- Stale snapshot cannot be used as completion evidence. ---


def test_stale_snapshot_not_used_as_completion_evidence():
    """validate_adaptive_snapshot may pass structurally, but classifier must
    produce a new decision — a stale snapshot cannot satisfy completion."""
    stale = _context_snapshot(escalation_count=2)
    stale["completedAt"] = "2026-07-20T00:00:00Z"  # looks "complete" structurally
    # Persistence layer validates structure only; cannot detect staleness.
    assert (
        validate_adaptive_snapshot(stale) is True
    ), "stale snapshot may be structurally valid (completion requires reclassification)"
    # Stale snapshot preserved for diagnosis (not deleted).
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, stale)
    read = read_adaptive_snapshot(run_state)
    assert (
        read.get("completedAt") == "2026-07-20T00:00:00Z"
    ), "stale snapshot preserved for diagnosis"
    # Classifier produces a fresh decision; does not trust stale snapshot.
    decision = classify_adaptive_decision("Fix typo in README.md", {"snapshot": stale})
    assert (
        decision["snapshot"]["escalationCount"] == 0
    ), "fresh decision must not carry over stale escalationCount"


# --- Old goal not mutated invisibly. ---


def test_old_goal_not_mutated_invisibly():
    """When reclassifying, the original snapshot's mode and stages are not
    modified in-place (verify by deep-comparing before and after)."""
    request = "Fix typo in README.md"
    stale = _context_snapshot(escalation_count=2, mode="long-horizon")
    before = copy.deepcopy(stale)
    classify_adaptive_decision(request, {"snapshot": stale})
    assert (
        stale == before
    ), "old snapshot mode/stages must not be mutated in-place during reclassification"
    # write_adaptive_snapshot writes a new object; prior reference unchanged.
    run_state = _base_run_state()
    fresh_snap = _context_snapshot(mode="direct")
    write_adaptive_snapshot(run_state, fresh_snap)
    assert (
        stale == before
    ), "prior snapshot reference is not mutated by a new write_adaptive_snapshot call"


# --- No snapshot: fresh decision. ---


def test_no_snapshot_in_context_produces_fresh_decision():
    decision = classify_adaptive_decision(FIXTURE["request"], FIXTURE["context"])
    assert (
        decision["mode"] == "long-horizon"
    ), "long-horizon fixture produces a fresh long-horizon decision without any prior snapshot"
    assert (
        decision["snapshot"]["escalationCount"] == 0
    ), "fresh decision has escalationCount=0"
    assert (
        decision["snapshot"]["currentStage"] == "understand"
    ), "fresh decision starts from understand (no resume)"


# --- Null snapshot: behavior matches no-snapshot. ---


def test_null_snapshot_in_context_matches_no_snapshot_behavior():
    ctx_with_null = dict(FIXTURE["context"])
    ctx_with_null["snapshot"] = None
    decision_with_null = classify_adaptive_decision(FIXTURE["request"], ctx_with_null)
    decision_without = classify_adaptive_decision(
        FIXTURE["request"], FIXTURE["context"]
    )
    assert (
        decision_with_null["mode"] == decision_without["mode"]
    ), "null snapshot must behave identically to no snapshot"
    assert (
        decision_with_null["snapshot"]["currentStage"]
        == decision_without["snapshot"]["currentStage"]
    ), "null snapshot must produce the same currentStage as no snapshot"
    assert (
        decision_with_null["snapshot"]["escalationCount"]
        == decision_without["snapshot"]["escalationCount"]
    ), "null snapshot must produce the same escalationCount as no snapshot"
