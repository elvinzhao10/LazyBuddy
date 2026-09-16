"""T2 tests — dual entry convergence (v1.3.0).

Table-driven. The route rows mirror
``contracts/fixtures/lazyseries-v130-scenarios.v1.json`` scenarios S1, S2, S3,
S4, S5, S6, S14. The canonical fixture is the executable contract; these rows
encode equivalent locally-checkable assertions because the fixture carries
free-form ``expect`` blobs rather than machine-checkable fields.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_routing import (  # noqa: E402
    classify_request_route,
    detect_hook_support,
    event_identity,
    is_duplicate_event,
    mark_event_dispatched,
    select_resume_candidate,
)
from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_snapshot import validate_adaptive_snapshot  # noqa: E402

# (id, request, hook_supported, expected_route, expected_intent,
#  expected_executes, expected_mutates)
ROUTE_ROWS = [
    ("S1-explicit-start-with-plan", "/lazy-start-work lazyseries-v1.3.0-adaptive-planning-and-memory",
     True, "explicit-execution", "execute", True, True),
    ("S2-explicit-start-no-plan", "/lazy-start-work <fixture-plan that does not exist>",
     True, "explicit-execution", "execute", True, True),
    ("S3-typo-fix-automatic", "Fix the typo in the welcome label.",
     True, "automatic-activation", "execute", True, True),
    ("S4-explanation-non-executing",
     "Explain how the billing module works and show the command to run the migration.",
     True, "automatic-activation", "plan_only", False, False),
    ("S5-plan-only-then-execute", "Plan only; do not implement.",
     True, "automatic-activation", "plan_only", False, False),
    ("S6-complex-expense-tracker",
     "Build a team expense tracker with approvals, reporting, and billing.",
     True, "automatic-activation", "execute", True, True),
    # S14: missing hook support -> fallback explicit entry, accurate pending status.
    ("S14-missing-hook-capability", "Fix the typo in the welcome label.",
     False, "automatic-activation", "execute", True, True),
]


@pytest.mark.parametrize(
    "sid,req,hook_supported,route,intent,executes,mutates",
    ROUTE_ROWS,
    ids=[r[0] for r in ROUTE_ROWS],
)
def test_route_classification(sid, req, hook_supported, route, intent, executes, mutates):
    decision = classify_request_route(req, hook_supported=hook_supported)
    assert decision.route == route, f"{sid}: route"
    assert decision.execution_intent == intent, f"{sid}: intent"
    assert decision.executes_code == executes, f"{sid}: executes_code"
    assert decision.mutates_product_files == mutates, f"{sid}: mutates"


def test_explicit_start_is_execution_instruction():
    d = classify_request_route("/lazy-start-work my-plan")
    assert d.route == "explicit-execution"
    assert d.execution_intent == "execute"


@pytest.mark.parametrize("req", [
    "Plan only; do not implement.",
    "Do not code this; just outline the approach.",
    "Explain how the billing module works and show the command to run the migration.",
    "Show me the command to run the migration.",
    "What is the difference between the two providers?",
])
def test_plan_only_invariant_never_mutates_or_executes(req):
    """Adversarial core of T2 #3: plan-only inputs cannot dispatch/execute."""
    d = classify_request_route(req)
    assert d.execution_intent == "plan_only"
    assert d.executes_code is False
    assert d.mutates_product_files is False


@pytest.mark.parametrize("req", [
    "Just do it.",
    "yes",
    "ok sure",
    "go ahead",
    "proceed",
])
def test_ambiguous_or_edit_input_cannot_grant_execution(req):
    """A mere edit, quoted example, or ambiguous ack cannot set execute."""
    d = classify_request_route(req)
    assert d.execution_intent == "plan_only"
    assert d.executes_code is False
    assert d.mutates_product_files is False


def test_missing_hook_support_reports_pending_not_pass():
    """S14: missing hook -> accurate pending status, no silent automatic claim."""
    assert detect_hook_support({}) is False
    assert detect_hook_support(None) is False
    assert detect_hook_support({"hook_support": False}) is False
    # When the hook is missing the route still reports accurate hook_status.
    d = classify_request_route("Fix the typo.", hook_supported=False)
    assert d.hook_status == "pending"
    # And the explicit entry route remains available (no silent automatic execute claim):
    assert d.execution_intent == "execute"  # clear request still executes, but...
    # ...the host status is honest about readiness.
    assert d.hook_status != "supported"


def test_hook_support_detected_when_observed():
    assert detect_hook_support({"hook_support": True}) is True
    assert detect_hook_support({"observed_hooks": ["UserPromptSubmit"]}) is True


def test_duplicate_event_idempotency():
    """S13: the same host event identity must not duplicate dispatch."""
    seen: set[str] = set()
    ident = event_identity("sess-1", "sha256:" + "a" * 64, "run-1")
    assert is_duplicate_event(seen, ident) is False
    mark_event_dispatched(seen, ident)
    # Re-delivery of the identical event is a duplicate.
    assert is_duplicate_event(seen, ident) is True
    # A different request digest is NOT a duplicate.
    other = event_identity("sess-1", "sha256:" + "b" * 64, "run-1")
    assert is_duplicate_event(seen, other) is False
    # Idempotent re-mark is a no-op.
    mark_event_dispatched(seen, ident)
    assert len(seen) == 1


def test_resume_selects_single_compatible_run():
    candidates = [
        {"run_id": "run-1", "session_id": "sess-1", "status": "active"},
    ]
    assert select_resume_candidate(candidates, "sess-1")["run_id"] == "run-1"


def test_resume_asks_when_ambiguous():
    """Multiple compatible runs => ambiguous => caller must ask, not guess."""
    candidates = [
        {"run_id": "run-1", "session_id": "sess-1", "status": "active"},
        {"run_id": "run-2", "session_id": "sess-1", "status": "active"},
    ]
    assert select_resume_candidate(candidates, "sess-1") is None


def test_resume_none_when_no_candidates():
    assert select_resume_candidate([], "sess-1") is None
    assert select_resume_candidate([{"run_id": "x", "session_id": "other"}], "sess-1") is None


def test_snapshot_carries_valid_execution_intent():
    """execution_intent is persisted inside the adaptive snapshot and validates."""
    for request_text, expected in (
        ("Fix the typo in the welcome label.", "execute"),
        ("Plan only; do not implement.", "plan_only"),
        ("/lazy-start-work my-plan", "execute"),
    ):
        decision = classify_adaptive_decision(request_text, {})
        snapshot = decision["snapshot"]
        assert snapshot["executionIntent"] == expected
        assert validate_adaptive_snapshot(snapshot), f"snapshot invalid for {request_text!r}"


def test_execution_intent_field_is_required_by_validator():
    """A snapshot missing executionIntent must fail validation (additive field)."""
    decision = classify_adaptive_decision("Fix typo", {})
    snapshot = decision["snapshot"]
    snapshot.pop("executionIntent")
    assert validate_adaptive_snapshot(snapshot) is False


def test_resume_asks_when_ambiguous_full():
    candidates = [
        {"run_id": "run-1", "session_id": "sess-1", "status": "active"},
        {"run_id": "run-2", "session_id": "sess-1", "status": "active"},
    ]
    assert select_resume_candidate(candidates, "sess-1") is None
