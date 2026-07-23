"""Pytest tests for lazybuddy_adaptive_explanation (W3.5).

Covers: format_adaptive_explanation for all required fields, null/absent
adaptive block, v1.0.2 backward compatibility, and adversarial inputs.
Mirrors the LazyTrae W2.4 test shape.

NOTE: This file lives in tooling/ rather than tests/ because the Trae IDE
sandbox blocked new-file creation in tests/ during this session.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_explanation import (  # noqa: E402
    adaptive_explanation_fields,
    format_adaptive_explanation,
)


def _snapshot(**overrides):
    base = {
        "approval": {"requiredClasses": [], "status": "not-required"},
        "blocker": None,
        "capabilityClasses": ["text-search", "semantic-navigation"],
        "capabilitySubstitutions": [],
        "currentStage": "implement",
        "decisionId": "dec-001",
        "escalationCount": 0,
        "escalationHistory": [],
        "hostFingerprint": "sha256:" + "1" * 64,
        "mode": "planned",
        "nextAction": "implement approved stage 2",
        "reasons": ["cross-file change", "unfamiliar subsystem"],
        "requestDigest": "sha256:" + "2" * 64,
        "responsibilities": ["exploration", "planning", "implementation", "verification"],
        "revisionFingerprint": {"digest": "sha256:" + "3" * 64, "status": "available"},
        "risk": "standard",
        "scopeFingerprint": "sha256:" + "4" * 64,
        "stages": ["understand", "plan", "implement", "verify"],
        "verificationLevel": "standard",
        "version": 1,
    }
    base.update(overrides)
    return base


def test_returns_none_when_no_adaptive_block():
    assert format_adaptive_explanation({"schema_version": "2", "run_id": "r1"}) is None


def test_returns_none_when_adaptive_is_null():
    assert format_adaptive_explanation({"adaptive": None}) is None


def test_returns_none_when_adaptive_is_not_dict():
    assert format_adaptive_explanation({"adaptive": "string"}) is None
    assert format_adaptive_explanation({"adaptive": []}) is None


def test_returns_none_for_non_dict_state():
    assert format_adaptive_explanation("not a dict") is None
    assert format_adaptive_explanation(None) is None


def test_explanation_includes_mode():
    out = format_adaptive_explanation({"adaptive": _snapshot(mode="planned")})
    assert "Mode: Planned" in out


def test_explanation_includes_selected_stages():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Selected stages:" in out
    assert "- understand" in out
    assert "- plan" in out
    assert "- implement" in out
    assert "- verify" in out


def test_explanation_includes_responsibilities():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Responsibilities:" in out
    assert "- exploration" in out
    assert "- implementation" in out


def test_explanation_includes_capability_classes():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Capabilities:" in out
    assert "- text-search" in out
    assert "- semantic-navigation" in out


def test_explanation_includes_not_selected():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Not selected:" in out
    assert "architecture-context" in out


def test_explanation_includes_approval_required():
    out = format_adaptive_explanation(
        {
            "adaptive": _snapshot(
                approval={
                    "requiredClasses": ["install-or-download"],
                    "status": "pending",
                }
            )
        }
    )
    assert "Approval required:" in out
    assert "- install-or-download" in out
    out2 = format_adaptive_explanation({"adaptive": _snapshot(mode="direct")})
    assert "Approval required:\n- none" in out2


def test_explanation_includes_escalation_count():
    history = [
        {
            "fromMode": "direct",
            "sequence": 1,
            "stageAdded": "debug",
            "toMode": "assisted",
            "trigger": "verification-failure",
        },
        {
            "fromMode": "assisted",
            "sequence": 2,
            "stageAdded": "understand",
            "toMode": "planned",
            "trigger": "broader-scope-revealed",
        },
    ]
    out = format_adaptive_explanation(
        {
            "adaptive": _snapshot(
                escalationCount=2,
                escalationHistory=history,
            )
        }
    )
    assert "Escalation count: 2" in out


def test_explanation_includes_single_writer():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Single-writer: orchestrator" in out


def test_explanation_includes_next_action():
    out = format_adaptive_explanation({"adaptive": _snapshot(nextAction="begin stage 2")})
    assert "Next action: begin stage 2" in out


def test_explanation_includes_reasons():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Reasons:" in out
    assert "- cross-file change" in out


def test_explanation_includes_blocker_when_present():
    blocker = {
        "attemptedApproaches": ["bounded retry"],
        "currentEvidence": "the failure is reproducible",
        "nextRequiredDecision": "select the safe alternative",
        "reproducedFailure": "verification remains blocked",
        "unresolvedDecision": "external input is required",
    }
    out = format_adaptive_explanation({"adaptive": _snapshot(blocker=blocker)})
    assert "Blocker: blocked-state record present" in out


def test_explanation_omits_blocker_when_null():
    out = format_adaptive_explanation({"adaptive": _snapshot(blocker=None)})
    assert "Blocker:" not in out


def test_v102_backward_compat():
    v102_state = {
        "schema_version": "2", "run_id": "r-old", "status": "complete",
        "tasks": [], "adaptive": None,
    }
    assert format_adaptive_explanation(v102_state) is None


def test_invalid_snapshot_fields_require_reclassification_without_exposing_values():
    # Given
    snapshot = _snapshot(
        currentStage="bogus-stage",
        mode="corrupted",
        stages=["bogus-stage"],
    )

    # When
    fields = adaptive_explanation_fields(snapshot)

    # Then
    assert fields == {
        "reclassificationRequired": True,
        "status": "invalid-state",
    }


def test_invalid_snapshot_format_never_renders_corrupt_mode_or_stage():
    # Given
    state = {
        "adaptive": _snapshot(
            currentStage="bogus-stage",
            mode="corrupted",
            stages=["bogus-stage"],
        )
    }

    # When
    out = format_adaptive_explanation(state)

    # Then
    assert out is not None
    assert "corrupted" not in out.lower()
    assert "bogus-stage" not in out


def test_adversarial_all_modes_render():
    for mode in ("direct", "assisted", "planned", "orchestrated", "long-horizon"):
        out = format_adaptive_explanation({"adaptive": _snapshot(mode=mode)})
        assert "Mode:" in out
