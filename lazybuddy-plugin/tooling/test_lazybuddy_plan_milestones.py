"""T3 tests — progressive milestones and scoped decision gates (v1.3.0).

Table-driven where possible. Milestone graph cases mirror behavior c rejects
(cycles, missing IDs, dangling child links) and the S6/S7 scenario expectations.
Decision gate cases mirror canonical_formats.decision_gate (S6).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_plan_milestones import (  # noqa: E402
    gate_blocks,
    independent_work_proceeds,
    milestone_dispatchable,
    validate_decision_gate,
    validate_milestone_graph,
)

# (label, nodes, expect_valid)
MILESTONE_ROWS = [
    ("valid-linear", [
        {"id": "T1", "provisional": False, "dependency_links": []},
        {"id": "T2", "provisional": False, "dependency_links": ["T1"]},
        {"id": "T3", "provisional": True, "dependency_links": ["T2"]},
    ], True),
    ("missing-id", [
        {"id": "T1", "provisional": False, "dependency_links": ["T9"]},
    ], False),
    ("dangling-child-link", [
        {"id": "T1", "provisional": False, "dependency_links": []},
        {"id": "T2", "provisional": False, "dependency_links": ["T_MISSING"]},
    ], False),
    ("cycle", [
        {"id": "T1", "provisional": False, "dependency_links": ["T2"]},
        {"id": "T2", "provisional": False, "dependency_links": ["T1"]},
    ], False),
    ("self-cycle", [
        {"id": "T1", "provisional": False, "dependency_links": ["T1"]},
    ], False),
    ("duplicate-id", [
        {"id": "T1", "provisional": False, "dependency_links": []},
        {"id": "T1", "provisional": True, "dependency_links": []},
    ], False),
    ("provisional-only-valid", [
        {"id": "T1", "provisional": True, "dependency_links": []},
        {"id": "T2", "provisional": True, "dependency_links": ["T1"]},
    ], True),
]


@pytest.mark.parametrize("label,nodes,expect_valid", MILESTONE_ROWS,
                         ids=[r[0] for r in MILESTONE_ROWS])
def test_milestone_graph_validation(label, nodes, expect_valid):
    errors = validate_milestone_graph(nodes)
    assert (not errors) == expect_valid, f"{label}: errors={errors}"


def test_cycle_message_is_explicit():
    errors = validate_milestone_graph([
        {"id": "T1", "provisional": False, "dependency_links": ["T2"]},
        {"id": "T2", "provisional": False, "dependency_links": ["T1"]},
    ])
    assert any("cycle" in e.lower() for e in errors)


def test_missing_id_message_is_explicit():
    errors = validate_milestone_graph([
        {"id": "T1", "provisional": False, "dependency_links": ["T9"]},
    ])
    assert any("missing id" in e.lower() or "dangling" in e.lower() for e in errors)


def test_next_milestone_dispatchable_skips_provisional():
    """Behavior c: the next non-provisional milestone is executable; distant
    provisional milestones must NOT dispatch."""
    nodes = [
        {"id": "T1", "provisional": False, "dependency_links": []},
        {"id": "T2", "provisional": True, "dependency_links": ["T1"]},
        {"id": "T3", "provisional": True, "dependency_links": ["T2"]},
    ]
    assert milestone_dispatchable(nodes) == "T1"
    # After T1 completes, T2 is still provisional -> nothing executable yet.
    assert milestone_dispatchable(nodes, completed={"T1"}) is None


def test_provisional_milestone_never_dispatches():
    nodes = [
        {"id": "T1", "provisional": True, "dependency_links": []},
    ]
    assert milestone_dispatchable(nodes) is None


# (label, gate, expect_valid)
GATE_ROWS = [
    ("S6-canonical", {
        "question": "Which billing provider should the billing milestone integrate?",
        "recommendation": "Provider X (existing contract, lowest integration cost).",
        "alternatives": [
            {"id": "provider-x", "summary": "Existing contract provider",
             "tradeoffs": "Lower cost, fewer features."},
            {"id": "provider-y", "summary": "New provider",
             "tradeoffs": "More features, new procurement."},
        ],
        "owner": "product-owner",
        "affected_tasks": ["billing-integration"],
        "needed_by": "milestone-billing",
        "status": "open",
        "assumptions": ["Billing is the only consequential product decision surfaced now."],
    }, True),
    ("missing-question", {"recommendation": "x", "alternatives": [],
                          "owner": "o", "needed_by": "m", "status": "open"}, False),
    ("bad-status", {
        "question": "q", "recommendation": "x", "alternatives": [
            {"id": "a", "summary": "s", "tradeoffs": "t"}],
        "owner": "o", "needed_by": "m", "status": "approved"}, False),
    ("only-recommended-alternative", {
        "question": "q", "recommendation": "Use provider-x",
        "alternatives": [{"id": "provider-x", "summary": "s", "tradeoffs": "t"}],
        "owner": "o", "needed_by": "m", "status": "open"}, False),
]


@pytest.mark.parametrize("label,gate,expect_valid", GATE_ROWS,
                         ids=[r[0] for r in GATE_ROWS])
def test_decision_gate_validation(label, gate, expect_valid):
    errors = validate_decision_gate(gate)
    assert (not errors) == expect_valid, f"{label}: errors={errors}"


def test_recommendation_never_auto_approves():
    """A gate with a recommendation but status 'open' still blocks the affected
    task; it does NOT auto-approve. Independent work proceeds."""
    gate = {
        "question": "Which billing provider?",
        "recommendation": "Provider X.",
        "alternatives": [
            {"id": "provider-x", "summary": "Existing", "tradeoffs": "Cheap."},
            {"id": "provider-y", "summary": "New", "tradeoffs": "Featureful."},
        ],
        "owner": "product-owner",
        "affected_tasks": ["billing-integration"],
        "needed_by": "milestone-billing",
        "status": "open",
    }
    # The recommended billing task is blocked while the gate is open.
    assert gate_blocks(gate, "billing-integration") is True
    # An independent navigation task proceeds.
    assert independent_work_proceeds(gate, "navigation") is True
    assert gate_blocks(gate, "navigation") is False


def test_gate_unblocks_when_answered():
    gate = {
        "question": "q", "recommendation": "x", "alternatives": [
            {"id": "a", "summary": "s", "tradeoffs": "t"},
            {"id": "b", "summary": "s2", "tradeoffs": "t2"}],
        "owner": "o", "affected_tasks": ["task-1"], "needed_by": "m",
        "status": "answered",
    }
    assert gate_blocks(gate, "task-1") is False
