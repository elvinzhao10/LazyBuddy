#!/usr/bin/env python3
"""W4.2 bounded-escalation integration tests for LazyBuddy (v1.0.3 Adaptive Harness).

Proves plan Section 12 (Escalation and repair) behavior:
  - targeted verify failure adds a debug stage
  - broader scope escalates mode by exactly one level
  - max 2 automatic depth escalations per decision (negative test)
  - post-bound blocked state carries all 5 required sub-fields
  - security/release/migration findings require independent review

The classifier encodes the escalation sequence as a single bounded decision
(``_compose_escalation_bound``): initial direct mode -> verification failure
adds debug (escalation 1) -> broader scope escalates mode one level
(escalation 2) -> bound reached -> blocked-state record. The bound case is the
terminal state of the sequence; the harness must not loop indefinitely.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402

MAX_AUTO_ESCALATIONS = 2
MODE_ORDER = ["direct", "assisted", "planned", "orchestrated", "long-horizon"]

# Fixture 09-escalation-bound.json: direct mode -> verification failure
# (adds debug stage) -> broader scope revealed (mode escalates one level)
# -> bound reached -> blocked-state record with all 5 required sub-fields.
ESCALATION_REQUEST = (
    "Fix the failing unit test in src/utils/date.test.js. The test expects "
    "a locale-formatted date but the implementation returns an ISO string."
)
ESCALATION_CONTEXT = {
    "initial_mode": "direct",
    "max_auto_escalations": MAX_AUTO_ESCALATIONS,
    "signals": {"verification_failure": True},
    "scope_revealed_broader": True,
    "verification_scope": "standard",
}


def test_scenario_1_targeted_verify_failure_adds_debug_stage():
    decision = classify_adaptive_decision(ESCALATION_REQUEST, ESCALATION_CONTEXT)
    assert "debug" in decision["stages"], \
        "verification failure must add a debug stage to the workflow"
    assert decision["snapshot"]["escalationCount"] == MAX_AUTO_ESCALATIONS, \
        "escalation count reflects the bound after the sequence completes"


def test_scenario_2_scope_material_increase_escalates_one_level():
    decision = classify_adaptive_decision(ESCALATION_REQUEST, ESCALATION_CONTEXT)
    # Fixture starts at initial_mode 'direct'; broader scope revealed must
    # escalate exactly one level to 'assisted' (direct -> assisted).
    assert decision["mode"] == "assisted", \
        "broader scope revealed must escalate direct -> assisted (one level)"
    initial_idx = MODE_ORDER.index("direct")
    final_idx = MODE_ORDER.index(decision["mode"])
    assert final_idx - initial_idx == 1, \
        "mode escalation must be exactly one level per scope-revealing failure"


def test_scenario_3_max_two_escalations_bound_no_third_escalation():
    # The fixture escalation_sequence encodes three verification failures
    # (initial fail, post-debug fail, post-broader-scope fail). The bound is
    # 2 automatic depth escalations; the third trigger must NOT escalate again.
    decision = classify_adaptive_decision(ESCALATION_REQUEST, ESCALATION_CONTEXT)
    assert decision["snapshot"]["escalationCount"] == MAX_AUTO_ESCALATIONS, \
        f"escalationCount must be {MAX_AUTO_ESCALATIONS} after the bound is reached"
    assert decision["snapshot"]["escalationCount"] <= MAX_AUTO_ESCALATIONS, \
        "classifier must never exceed the max-auto-escalations bound"
    assert decision["snapshot"]["blocker"] is None, \
        "two justified transitions reach the bound without fabricating another failure"


def test_scenario_4_negative_escalation_count_never_exceeds_bound():
    # Across multiple fixture contexts, escalationCount must remain <= 2.
    contexts = [
        {},
        {"scope": "broad", "acceptance_criteria": "incomplete"},
        {"signals": {"verification_failure": True}, "initial_mode": "direct"},
        {"risk_signals": ["security"]},
        {"risk_signals": ["release"]},
        {"session_scope": "multi-session", "checkpoint_requirement": "durable"},
    ]
    for ctx in contexts:
        decision = classify_adaptive_decision("verify escalation bound", ctx)
        assert decision["snapshot"]["escalationCount"] <= MAX_AUTO_ESCALATIONS, \
            f"escalationCount {decision['snapshot']['escalationCount']} exceeds bound for context {ctx!r}"


def test_scenario_5_blocked_state_record_contains_all_required_fields():
    context = dict(ESCALATION_CONTEXT)
    context["signals"] = {
        "repeated_failure_after_bound": True,
        "verification_failure": True,
    }
    decision = classify_adaptive_decision(ESCALATION_REQUEST, context)
    blocker = decision["snapshot"]["blocker"]
    assert isinstance(blocker, dict), "blocker must be an object record"
    assert blocker is not None, "blocker must not be null at the bound"
    # Section 12: blocked state must carry reproduced failure, attempted
    # approaches, current evidence, unresolved decision, exact next user decision.
    required_fields = [
        "reproducedFailure",
        "attemptedApproaches",
        "currentEvidence",
        "unresolvedDecision",
        "nextRequiredDecision",
    ]
    for field in required_fields:
        assert field in blocker, f"blocker must contain '{field}' (Section 12)"
    assert isinstance(blocker["attemptedApproaches"], list) and blocker["attemptedApproaches"], \
        "attemptedApproaches must be a non-empty list"
    for field in ("reproducedFailure", "currentEvidence",
                  "unresolvedDecision", "nextRequiredDecision"):
        assert isinstance(blocker[field], str) and blocker[field], \
            f"{field} must be a non-empty string"


def test_scenario_6a_security_finding_adds_automatic_independent_review():
    decision = classify_adaptive_decision(
        "Change authorization logic for /admin/billing endpoint",
        {"risk_signals": ["security-sensitive", "authorization-change"]},
    )
    assert decision["mode"] == "orchestrated", \
        "security-sensitive finding must escalate to orchestrated mode"
    assert decision["approval_required"] is False, \
        "security review is automatic unless the requested action crosses an approval boundary"
    assert "security-review" in decision["responsibilities"], \
        "orchestrated mode must assign security-review responsibility (no silent skip)"


def test_scenario_6b_release_finding_adds_automatic_release_review():
    decision = classify_adaptive_decision(
        "Cut v2.1.0 release: bump version, update changelog, build artifacts",
        {"risk_signals": ["release-or-publication"]},
    )
    assert decision["mode"] == "orchestrated", \
        "release finding must escalate to orchestrated mode"
    assert decision["approval_required"] is False, \
        "release review alone is not an external publication mutation"
    assert "security-review" not in decision["responsibilities"], \
        "release-only scenarios do not add security review"
    assert "release-review" in decision["responsibilities"], \
        "release preparation assigns release review automatically"


def test_scenario_6c_migration_finding_escalates_to_long_horizon():
    decision = classify_adaptive_decision(
        "Migrate session auth to JWT over 3 sessions",
        {"session_scope": "multi-session", "checkpoint_requirement": "durable"},
    )
    assert decision["mode"] == "long-horizon", \
        "multi-session migration must select long-horizon mode"
    assert "continue" in decision["stages"], \
        "long-horizon mode must include a continue stage for durable checkpoints"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
