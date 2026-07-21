"""Pytest tests for lazybuddy_adaptive_explanation (W3.5).

Covers: format_adaptive_explanation for all required fields, null/absent
adaptive block, v1.0.2 backward compatibility, and adversarial inputs.
Mirrors the LazyTrae W2.4 test shape.

NOTE: This file lives in tooling/ rather than tests/ because the Trae IDE
sandbox blocked new-file creation in tests/ during this session.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_explanation import format_adaptive_explanation  # noqa: E402


def _snapshot(**overrides):
    base = {
        "version": 1,
        "decisionId": "dec-001",
        "requestDigest": "sha256:abc",
        "mode": "planned",
        "stages": ["understand", "plan", "implement", "verify"],
        "currentStage": "implement",
        "responsibilities": ["exploration", "planning", "implementation", "verification"],
        "capabilityClasses": ["text-search", "semantic-navigation"],
        "runtimeResolution": {"text-search": "host-native", "semantic-navigation": "package-lsp"},
        "reasons": ["cross-file change", "unfamiliar subsystem"],
        "escalationCount": 0,
        "revisionMarker": "git:HEAD",
        "blocker": None,
        "nextAction": "implement approved stage 2",
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


def test_explanation_includes_capabilities_with_runtime():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Capabilities:" in out
    assert "- text-search (host-native)" in out
    assert "- semantic-navigation (package-lsp)" in out


def test_explanation_includes_not_selected():
    out = format_adaptive_explanation({"adaptive": _snapshot()})
    assert "Not selected:" in out
    assert "architecture-context" in out


def test_explanation_includes_approval_required():
    out = format_adaptive_explanation({"adaptive": _snapshot(mode="orchestrated")})
    assert "Approval required: approval required (orchestrated mode)" in out
    out2 = format_adaptive_explanation({"adaptive": _snapshot(mode="direct")})
    assert "Approval required: none" in out2


def test_explanation_includes_escalation_count():
    out = format_adaptive_explanation({"adaptive": _snapshot(escalationCount=2)})
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
    out = format_adaptive_explanation({"adaptive": _snapshot(blocker="scope too broad")})
    assert "Blocker: scope too broad" in out


def test_explanation_omits_blocker_when_null():
    out = format_adaptive_explanation({"adaptive": _snapshot(blocker=None)})
    assert "Blocker:" not in out


def test_v102_backward_compat():
    v102_state = {
        "schema_version": "2", "run_id": "r-old", "status": "complete",
        "tasks": [], "adaptive": None,
    }
    assert format_adaptive_explanation(v102_state) is None


def test_adversarial_empty_stages():
    out = format_adaptive_explanation({"adaptive": _snapshot(stages=[])})
    assert "Selected stages:" in out
    assert "- none" in out


def test_adversarial_empty_capabilities():
    out = format_adaptive_explanation({"adaptive": _snapshot(capabilityClasses=[])})
    assert "Capabilities:" in out


def test_adversarial_blocker_as_dict():
    out = format_adaptive_explanation({"adaptive": _snapshot(blocker={"reproduced_failure": "x"})})
    assert "Blocker: blocked-state record present" in out


def test_adversarial_all_modes_render():
    for mode in ("direct", "assisted", "planned", "orchestrated", "long-horizon"):
        out = format_adaptive_explanation({"adaptive": _snapshot(mode=mode)})
        assert "Mode:" in out
