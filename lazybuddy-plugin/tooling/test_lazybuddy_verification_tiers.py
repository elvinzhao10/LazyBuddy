"""T6 tests — verification tiers (v1.3.0).

Table-driven coverage for plan task T6 and ``behaviors.f_execution_tiers`` /
behavior 9 (V0-V3). One suite reuses the shared fixture path and a repo-local
tmp dir (brokered-host-safe) rather than inventing a second source of truth.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_verification_tiers import (  # noqa: E402
    REQUIRED_CONTRACT_VERSION,
    TIER_V0,
    TIER_V1,
    TIER_V2,
    TIER_V3,
    VerificationReceipt,
    build_receipt,
    load_scenarios_fixture,
    material_verification_status,
    reuse_receipt,
    rerun_scope,
    select_tier,
    verification_tier_definitions,
)


@pytest.fixture()
def tmp_path(tmp_path_factory=None):
    """Repo-local tmp dir (brokered host denies pytest's default /private basetemp).

    Mirrors tooling/test_lazybuddy_decision_ledger.py exactly.
    """
    import shutil
    import tempfile

    base = Path(__file__).resolve().parent / ".pytest-tmp"
    if not base.exists():
        base.mkdir()
    directory = Path(tempfile.mkdtemp(dir=str(base)))
    yield directory
    shutil.rmtree(directory, ignore_errors=True)


# --- 1. Tier selection: lowest sufficient from the changed boundary ---------

SELECTION_CASES = [
    # (changed_boundary, risk, expected_tier, note)
    ("doc", None, TIER_V0, "doc-only -> V0 inspect"),
    ("documentation", None, TIER_V0, "documentation -> V0"),
    ("metadata", None, TIER_V0, "metadata -> V0"),
    ("formatting", None, TIER_V0, "formatting -> V0"),
    ("fixture-inert", None, TIER_V0, "inert fixture -> V0"),
    ("localized", None, TIER_V1, "localized reversible -> V1 focused (small default)"),
    ("behavior-local", None, TIER_V1, "behavior-local -> V1"),
    ("cross-module", None, TIER_V2, "cross-module -> V2 integrated"),
    ("migration", None, TIER_V2, "migration -> V2"),
    ("lifecycle", None, TIER_V2, "lifecycle -> V2"),
    ("host-routing", None, TIER_V2, "host-routing -> V2"),
    ("security", None, TIER_V3, "security boundary -> V3 comprehensive"),
    ("trust", None, TIER_V3, "trust boundary -> V3"),
    ("release-packaging", None, TIER_V3, "release packaging -> V3"),
    ("shared-contract", None, TIER_V3, "shared contract change -> V3"),
    ("schema", None, TIER_V3, "schema change -> V3"),
    ("broad-infra", None, TIER_V3, "broad infra -> V3"),
    (None, None, TIER_V1, "unknown boundary defaults to V1 (lowest sufficient)"),
]


@pytest.mark.parametrize("boundary,risk,expected,note", SELECTION_CASES)
def test_select_tier_lowest_sufficient(boundary, risk, expected, note):
    assert select_tier(boundary, risk) == expected, note


# --- 2. No-promotion-on-counts rule ----------------------------------------

NON_PROMOTING_RISK = {
    "test_count": 500,
    "file_count": 120,
    "plan_size": 9000,
    "agent_count": 25,
    "called_complex": True,
    "naming": "complex",
}


@pytest.mark.parametrize("boundary,expected", [
    ("localized", TIER_V1),
    ("doc", TIER_V0),
    ("cross-module", TIER_V2),
    ("security", TIER_V3),
])
def test_no_promotion_on_counts(boundary, expected):
    # Heavy counts + a "complex" label must NOT move the tier off the boundary.
    assert select_tier(boundary, NON_PROMOTING_RISK) == expected


def test_security_reach_promotes_even_when_counts_present():
    # A genuine risk flag (security/trust reach) DOES promote a V1 boundary,
    # but only because the boundary is a real security reach — not the counts.
    assert select_tier("localized", {"reaches_security_trust": True}) == TIER_V3
    # Same boundary with only non-promoting noise stays V1.
    assert select_tier("localized", NON_PROMOTING_RISK) == TIER_V1


def test_unexplained_focused_failure_promotes_to_v3():
    assert select_tier("localized", {"unexplained_focused_failure": True}) == TIER_V3


# --- 3. Receipt reuse -------------------------------------------------------

BASE_INPUTS = {
    "surface": "pytest tooling/test_x.py::t",
    "covered_behavior": "welcome label renders",
    "tree": "abc123",
    "environment_fingerprint": "py3.12",
}


def _green_receipt(**overrides):
    data = dict(BASE_INPUTS, result="pass", tier=TIER_V1, artifact_ref="r1.json")
    data.update(overrides)
    return VerificationReceipt(**data)


def test_reuse_green_receipt_on_unchanged_inputs():
    receipt = _green_receipt()
    assert reuse_receipt(receipt, BASE_INPUTS) is True


def test_no_reuse_when_covered_behavior_changed():
    # Changed acceptance (covered behavior) invalidates the receipt.
    receipt = _green_receipt()
    changed = dict(BASE_INPUTS, covered_behavior="welcome label localizes")
    assert reuse_receipt(receipt, changed) is False


def test_no_reuse_when_tree_changed():
    receipt = _green_receipt()
    assert reuse_receipt(receipt, dict(BASE_INPUTS, tree="def456")) is False


def test_no_reuse_when_environment_changed():
    receipt = _green_receipt()
    assert reuse_receipt(receipt, dict(BASE_INPUTS, environment_fingerprint="py3.13")) is False


def test_failed_receipt_never_reused():
    failed = _green_receipt(result="fail")
    assert reuse_receipt(failed, BASE_INPUTS) is False


def test_rerun_scope_failed_check_only_itself():
    failed = build_receipt(
        tier=TIER_V1, surface="pytest test_x.py::t", covered_behavior="b",
        tree="abc", environment_fingerprint="e", result="fail",
    )
    # A focused failure reruns ONLY itself unless integration is affected.
    assert rerun_scope(failed) == ["pytest test_x.py::t"]


def test_rerun_scope_includes_directly_affected_integration():
    failed = build_receipt(
        tier=TIER_V1, surface="pytest test_x.py::t", covered_behavior="b",
        tree="abc", environment_fingerprint="e", result="fail",
    )
    scope = rerun_scope(failed, directly_affected_integration=["pytest test_integration.py::i"])
    assert scope == ["pytest test_x.py::t", "pytest test_integration.py::i"]


def test_rerun_scope_green_is_empty():
    green = build_receipt(
        tier=TIER_V2, surface="pytest test_i.py::i", covered_behavior="b",
        tree="abc", environment_fingerprint="e", result="pass",
    )
    assert rerun_scope(green) == []


# --- 4. Status materiality -------------------------------------------------

def test_material_status_suppresses_green_noise():
    receipts = [
        build_receipt(TIER_V1, "pytest a", "b1", "t", "e", "pass", "r1"),
        build_receipt(TIER_V1, "pytest b", "b2", "t", "e", "pass", "r2"),
        build_receipt(TIER_V1, "pytest c", "b3", "t", "e", "pass", "r3"),
        build_receipt(TIER_V2, "pytest d", "b4", "t", "e", "fail", "r4"),
    ]
    status = material_verification_status(receipts)
    # Only the single failing check is material; the three green ones are aggregated.
    assert status["outcome"] == "fail"
    assert status["green_count"] == 3
    assert status["total"] == 4
    assert len(status["material_checks"]) == 1
    assert status["material_checks"][0]["surface"] == "pytest d"
    assert status["highest_tier"] == TIER_V2


def test_material_status_all_green_is_clean():
    receipts = [
        build_receipt(TIER_V0, "static-check", "b", "t", "e", "pass"),
        build_receipt(TIER_V1, "pytest a", "b", "t", "e", "pass"),
    ]
    status = material_verification_status(receipts)
    assert status["outcome"] == "pass"
    assert status["material_checks"] == []
    assert status["highest_tier"] == TIER_V1


def test_material_status_empty():
    assert material_verification_status([])["outcome"] == "none"


# --- 5. Fixture consumption (shared source of truth) -----------------------

def test_loads_shared_fixture_contract_version():
    fixture = load_scenarios_fixture()
    assert fixture["contract_version"] == REQUIRED_CONTRACT_VERSION


def test_tier_definitions_consumed_from_fixture_shape():
    fixture = load_scenarios_fixture()
    definitions = verification_tier_definitions(fixture)
    for tier in (TIER_V0, TIER_V1, TIER_V2, TIER_V3):
        assert tier in definitions
        assert "scope" in definitions[tier]
        assert "default_action" in definitions[tier]


def test_routing_touchpoint_delegates(tmp_path):
    # local import to avoid cycle at collection time.
    from lazybuddy_adaptive_routing import select_verification_tier  # noqa: E402

    assert select_verification_tier("doc") == TIER_V0
    assert select_verification_tier("security") == TIER_V3
    assert select_verification_tier("localized", NON_PROMOTING_RISK) == TIER_V1
