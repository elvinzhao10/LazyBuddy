"""Pytest tests for lazybuddy_adaptive_mapping.map_adaptive_decision_to_surfaces.

Covers all 5 modes (direct, assisted, planned, orchestrated, long-horizon),
verification/status surface invariants, authority matrix extraction, and
invalid-decision error handling.
"""
import sys
from pathlib import Path

import pytest

TOOLING_DIR = Path(__file__).resolve().parent.parent / "tooling"
sys.path.insert(0, str(TOOLING_DIR))

from lazybuddy_adaptive_mapping import (  # noqa: E402
    KNOWN_MODES, MODE_SURFACES, STATUS_SURFACE, VERIFICATION_SURFACE,
    load_adaptive_contract, map_adaptive_decision_to_surfaces)
from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402

EXPECTED_WORKFLOWS = {
    "direct": [],
    "assisted": ["lazy-start-work"],
    "planned": ["lazy-ulw-plan", "lazy-start-work"],
    "orchestrated": ["lazy-ulw-plan", "lazy-start-work", "lazy-reviewer"],
    "long-horizon": ["lazy-ulw-plan", "lazy-start-work", "lazy-ulw-loop"],
}
EXPECTED_ORCHESTRATION = {
    "direct": "none", "assisted": "start-work", "planned": "start-work",
    "orchestrated": "start-work", "long-horizon": "loop-runtime",
}


def _decision_for_mode(mode):
    if mode == "direct":
        return classify_adaptive_decision("Fix typo", {})
    if mode == "assisted":
        return classify_adaptive_decision("Diagnose stale data",
                                          {"scope": "bounded", "file_count": 4})
    if mode == "planned":
        return classify_adaptive_decision("Add export feature",
                                          {"scope": "broad",
                                           "acceptance_criteria": "incomplete"})
    if mode == "orchestrated":
        return classify_adaptive_decision("Change auth logic",
                                          {"risk_signals": ["security"]})
    if mode == "long-horizon":
        return classify_adaptive_decision("Multi-session migration",
                                          {"session_scope": "multi-session"})
    raise ValueError(f"unknown mode: {mode}")


def test_known_modes_complete():
    assert set(KNOWN_MODES) == {"direct", "assisted", "planned", "orchestrated",
                                "long-horizon"}


@pytest.mark.parametrize("mode", list(KNOWN_MODES))
def test_each_mode_maps_to_expected_workflows(mode):
    decision = _decision_for_mode(mode)
    surfaces = map_adaptive_decision_to_surfaces(decision)
    assert surfaces["workflow_surfaces"] == EXPECTED_WORKFLOWS[mode]


@pytest.mark.parametrize("mode", list(KNOWN_MODES))
def test_each_mode_maps_to_expected_orchestration(mode):
    decision = _decision_for_mode(mode)
    surfaces = map_adaptive_decision_to_surfaces(decision)
    assert surfaces["orchestration_surface"] == EXPECTED_ORCHESTRATION[mode]


@pytest.mark.parametrize("mode", list(KNOWN_MODES))
def test_verification_surface_always_lazy_verifier(mode):
    decision = _decision_for_mode(mode)
    surfaces = map_adaptive_decision_to_surfaces(decision)
    assert surfaces["verification_surface"] == "lazy-verifier"


@pytest.mark.parametrize("mode", list(KNOWN_MODES))
def test_status_surface_always_lazy_status(mode):
    decision = _decision_for_mode(mode)
    surfaces = map_adaptive_decision_to_surfaces(decision)
    assert surfaces["status_surface"] == "lazy-status"


def test_constants_exposed():
    assert VERIFICATION_SURFACE == "lazy-verifier"
    assert STATUS_SURFACE == "lazy-status"
    assert "direct" in MODE_SURFACES
    assert "long-horizon" in MODE_SURFACES


def test_responsibility_owners_come_from_authority_matrix():
    decision = _decision_for_mode("orchestrated")
    surfaces = map_adaptive_decision_to_surfaces(decision)
    contract = load_adaptive_contract()
    authority_matrix = contract["authority_matrix"]
    assert surfaces["responsibility_owners"] == authority_matrix
    # Spot-check specific authority entries.
    assert surfaces["responsibility_owners"]["continuity"] == "automatic"
    assert surfaces["responsibility_owners"]["security-review"] == "approval-required"
    assert surfaces["responsibility_owners"]["release-review"] == "approval-required"
    assert surfaces["responsibility_owners"]["implementation"] == "automatic"


def test_invalid_decision_unknown_mode_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_surfaces({"mode": "unknown-mode"})
    assert "ADAPTIVE_MAPPING_INVALID_DECISION: unknown-mode" in str(excinfo.value)


def test_invalid_decision_missing_mode_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_surfaces({})
    assert "ADAPTIVE_MAPPING_INVALID_DECISION: missing" in str(excinfo.value)


def test_invalid_decision_null_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_surfaces(None)
    assert "ADAPTIVE_MAPPING_INVALID_DECISION: missing" in str(excinfo.value)


def test_invalid_decision_non_dict_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_surfaces("not a dict")
    assert "ADAPTIVE_MAPPING_INVALID_DECISION: missing" in str(excinfo.value)


def test_invalid_decision_empty_mode_string_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_surfaces({"mode": ""})
    assert "ADAPTIVE_MAPPING_INVALID_DECISION: " in str(excinfo.value)


def test_returned_workflows_are_a_new_list():
    """Mutating the returned workflows must not affect future calls."""
    decision = _decision_for_mode("planned")
    surfaces = map_adaptive_decision_to_surfaces(decision)
    workflows = surfaces["workflow_surfaces"]
    workflows.append("injected")
    surfaces2 = map_adaptive_decision_to_surfaces(decision)
    assert "injected" not in surfaces2["workflow_surfaces"]


def test_returned_responsibility_owners_are_a_new_dict():
    decision = _decision_for_mode("direct")
    surfaces = map_adaptive_decision_to_surfaces(decision)
    owners = surfaces["responsibility_owners"]
    owners["injected"] = "automatic"
    surfaces2 = map_adaptive_decision_to_surfaces(decision)
    assert "injected" not in surfaces2["responsibility_owners"]
