"""W4.1 Explicit Override integration tests for the v1.0.3 Adaptive Harness.

Proves that explicit user workflow requests remain authoritative and are not
silently downgraded or replaced by the adaptive classifier. Mirrors the
LazyTrae adaptive-w4-1-explicit-override.test.js for behavioral parity per
plan Section 6 (resolution order step 1) and the 07-explicit-workflow-override
fixture.

Scenarios covered (equivalent coverage in both repos):
  1. Fixture regression -- 07-explicit-workflow-override.json
  2. "create a plan only" -> planned mode, no implement stage
  3. "do this directly; do not create a plan" -> direct mode, no plan stage
  4. "run an independent review" -> orchestrated mode with review responsibility
  5. "use lazy-ulw-loop for this" -> long-horizon mode
  6. Negative -- explicit lazy-ulw-plan must NOT be downgraded to direct
  7. Negative -- explicit lazy-review-work must NOT be silently replaced
  8. Authority -- explicit selection preserved when boundaries are present
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402

FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent
    / "contracts" / "fixtures" / "v103" / "07-explicit-workflow-override.json"
)

REVIEW_RESPONSIBILITIES = ("quality-review", "security-review", "release-review")


def _load_fixture() -> dict:
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_fixture_explicit_override_produces_expected_planned_decision():
    """W4.1 fixture: 07-explicit-workflow-override.json produces expected planned decision."""
    fx = _load_fixture()
    decision = classify_adaptive_decision(fx["request"], fx["context"])

    assert decision["mode"] == fx["expected_decision"]["mode"]
    assert decision["stages"] == fx["expected_decision"]["stages"]
    assert "implement" not in decision["stages"], (
        "plan-only request must not include the implement stage"
    )
    assert decision["responsibilities"] == fx["expected_decision"]["responsibilities"]
    assert decision["verification_level"] == fx["expected_decision"]["verification_level"]
    assert decision["mode"] != "direct", (
        "explicit plan-only request must not be downgraded to direct"
    )


def test_scenario_1_create_plan_only_selects_planned_mode_with_no_implement_stage():
    request = (
        "Create a plan only -- do not implement yet. Use the lazy-ulw-plan "
        "workflow and stop after planning."
    )
    context = {
        "signals": {"explicit_user_workflow": True},
        "named_workflow": "lazy-ulw-plan",
        "authoritative_instruction": True,
        "verification_scope": "targeted",
    }
    decision = classify_adaptive_decision(request, context)

    assert decision["mode"] == "planned"
    assert "plan" in decision["stages"]
    assert "implement" not in decision["stages"]
    assert decision["mode"] != "direct"


def test_scenario_2_do_this_directly_selects_direct_mode_with_no_plan_stage():
    request = "Do this directly; do not create a plan"
    decision = classify_adaptive_decision(request, {})

    assert decision["mode"] == "direct"
    assert "plan" not in decision["stages"]


def test_scenario_3_run_independent_review_produces_orchestrated_with_review_responsibility():
    request = (
        "Run an independent review of the security-critical authorization changes"
    )
    context = {
        "risk_signals": ["security-sensitive", "authorization-change"],
        "scope_signals": ["touches authorization middleware"],
    }
    decision = classify_adaptive_decision(request, context)

    assert decision["mode"] == "orchestrated"
    has_review = any(r in REVIEW_RESPONSIBILITIES for r in decision["responsibilities"])
    assert has_review, (
        f"orchestrated review must include a review responsibility; "
        f"got {decision['responsibilities']}"
    )


def test_scenario_4_use_lazy_ulw_loop_selects_long_horizon_mode():
    request = "Use lazy-ulw-loop for this multi-session migration"
    context = {
        "session_scope": "multi-session",
        "checkpoint_requirement": "durable",
    }
    decision = classify_adaptive_decision(request, context)

    assert decision["mode"] == "long-horizon"
    assert "continue" in decision["stages"]


def test_negative_1_explicit_lazy_ulw_plan_not_downgraded_to_direct():
    """Classifier must NOT silently downgrade an explicit lazy-ulw-plan request."""
    request = "Use lazy-ulw-plan for this small one-file typo fix"
    # Even with a context that would normally select direct mode (small, clear,
    # low-risk), the explicit lazy-ulw-plan pattern must remain authoritative.
    decision = classify_adaptive_decision(request, {"scope": "bounded", "file_count": 1})

    assert decision["mode"] == "planned"
    assert decision["mode"] != "direct"
    assert "plan" in decision["stages"]
    assert "implement" not in decision["stages"]


def test_negative_2_explicit_lazy_review_work_not_silently_replaced():
    """Classifier must NOT silently replace an explicit lazy-review-work request."""
    request = "Run lazy-review-work on the recent authorization changes"
    # With security risk context, the classifier must produce a review-responsibility
    # decision rather than silently defaulting to direct mode (which would drop the review).
    decision = classify_adaptive_decision(
        request,
        {"risk_signals": ["security-sensitive", "authorization-change"]},
    )

    assert decision["mode"] != "direct", (
        "review request must not be silently replaced with direct mode"
    )
    has_review = any(r in REVIEW_RESPONSIBILITIES for r in decision["responsibilities"])
    assert has_review, "review request must include a review responsibility"


def test_authority_classifier_preserves_explicit_selection_when_boundaries_present():
    """Classifier may add boundaries but must not remove the explicit selection."""
    request = "Create a plan only -- do not implement. Use lazy-ulw-plan."
    # The classifier may add approval boundaries when risk signals are present,
    # but the explicit mode selection must remain (not removed, not replaced).
    decision = classify_adaptive_decision(
        request,
        {
            "risk_signals": ["security-sensitive"],
            "scope_signals": ["touches authorization middleware"],
        },
    )

    assert decision["mode"] == "planned", (
        "explicit lazy-ulw-plan mode must be preserved even with risk context"
    )
    assert "plan" in decision["stages"], (
        "plan stage must remain when explicit lazy-ulw-plan is set"
    )
    assert isinstance(decision["approval_required"], bool), (
        "approval_required must be a boolean (boundary indicator)"
    )
