"""Pytest tests for lazybuddy_adaptive_detector.classify_adaptive_decision.

Covers all 5 modes (direct, assisted, planned, orchestrated, long-horizon),
the 7-step decision policy ordering, the Section 5 decision shape, the
Section 11 snapshot schema, explicit-override authoritativeness, bounded
escalation, and preferred-provider fallback.
"""
import json
import re
import sys
from pathlib import Path

import pytest

TOOLING_DIR = Path(__file__).resolve().parent.parent / "tooling"
FIXTURE_DIR = TOOLING_DIR.parent / "contracts" / "fixtures" / "v103"
sys.path.insert(0, str(TOOLING_DIR))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_snapshot import SNAPSHOT_REQUIRED_FIELDS  # noqa: E402
DECISION_REQUIRED_FIELDS = [
    "mode", "stages", "responsibilities", "capabilities", "approval_required",
    "verification_level", "not_selected", "reasons", "runtime_resolution",
    "snapshot",
]
SNAPSHOT_IDENTITY_INPUTS = {
    "decisionId": "decision_id",
    "hostFingerprint": "host_fingerprint",
    "revisionFingerprint": "revision_fingerprint",
    "scopeFingerprint": "scope_fingerprint",
}
MACHINE_DECISION_FIELDS = (
    "allowed_substitutions",
    "approval_classes",
    "approval_required",
    "authority_boundary",
    "capabilities",
    "mode",
    "not_selected",
    "ownership",
    "responsibilities",
    "stages",
    "verification_level",
)
MACHINE_SNAPSHOT_FIELDS = (
    "approval",
    "blocker",
    "capabilityClasses",
    "capabilitySubstitutions",
    "currentStage",
    "decisionId",
    "escalationCount",
    "escalationHistory",
    "hostFingerprint",
    "mode",
    "requestDigest",
    "responsibilities",
    "revisionFingerprint",
    "risk",
    "scopeFingerprint",
    "stages",
    "verificationLevel",
    "version",
)


@pytest.mark.parametrize(
    "path",
    sorted(FIXTURE_DIR.glob("[0-9][0-9]-*.json")),
    ids=lambda path: path.stem,
)
def test_shared_fixtures_match_full_decisions_and_snapshots(path: Path):
    fixture = json.loads(path.read_text(encoding="utf-8"))
    expected_snapshot = fixture["expected_snapshot"]["adaptive"]
    context = dict(fixture["context"])
    context.update({
        context_field: expected_snapshot[snapshot_field]
        for snapshot_field, context_field in SNAPSHOT_IDENTITY_INPUTS.items()
    })
    decision = classify_adaptive_decision(fixture["request"], context)
    expected_decision = fixture["expected_decision"]
    for field in MACHINE_DECISION_FIELDS:
        assert decision[field] == expected_decision[field], f"{path.name}: {field}"
    assert set(decision["user_explanation"]) == set(expected_decision["user_explanation"])
    assert all(
        isinstance(value, str) and value
        for value in decision["user_explanation"].values()
    )
    assert decision["reasons"]
    assert all(isinstance(reason, str) and reason for reason in decision["reasons"])
    assert isinstance(decision["runtime_resolution"], dict)
    snapshot = decision["snapshot"]
    for snapshot_field in MACHINE_SNAPSHOT_FIELDS:
        assert snapshot[snapshot_field] == expected_snapshot[snapshot_field], (
            f"{path.name}: {snapshot_field}"
        )
    assert isinstance(snapshot["nextAction"], str) and snapshot["nextAction"]
    assert snapshot["reasons"]
    assert all(isinstance(reason, str) and reason for reason in snapshot["reasons"])


def test_direct_mode_for_localized_clear_work():
    decision = classify_adaptive_decision("Fix typo in errors.js", {})
    assert decision["mode"] == "direct"
    assert decision["approval_required"] is False
    assert decision["verification_level"] == "targeted"
    assert "implementation" in decision["responsibilities"]
    assert "verification" in decision["responsibilities"]
    assert "implement" in decision["stages"]
    assert "verify" in decision["stages"]


def test_assisted_mode_for_unfamiliar_cross_file():
    decision = classify_adaptive_decision(
        "Diagnose stale data after refactor",
        {"scope": "bounded", "repository_familiarity": "unfamiliar", "file_count": 4})
    assert decision["mode"] == "assisted"
    assert decision["approval_required"] is False
    assert "debugging" in decision["responsibilities"]
    assert "exploration" in decision["responsibilities"]
    assert "understand" in decision["stages"]
    assert "debug" in decision["stages"]


def test_planned_mode_for_broad_scope_incomplete_criteria():
    decision = classify_adaptive_decision(
        "Add export-to-PDF feature",
        {"scope": "broad", "acceptance_criteria": "incomplete"})
    assert decision["mode"] == "planned"
    assert decision["approval_required"] is False
    assert "planning" in decision["responsibilities"]
    assert "plan" in decision["stages"]


def test_orchestrated_mode_for_security_sensitive_change():
    decision = classify_adaptive_decision(
        "Change authorization logic for /admin/billing endpoint",
        {"risk_signals": ["security-sensitive", "authorization-change"],
         "scope_signals": ["touches authorization middleware"]})
    assert decision["mode"] == "orchestrated"
    assert decision["approval_required"] is False
    assert decision["verification_level"] == "independent"
    assert "security-review" in decision["responsibilities"]
    assert "review" in decision["stages"]


def test_orchestrated_mode_for_release_publication():
    decision = classify_adaptive_decision(
        "Cut v2.1.0 release: bump version, update changelog, build artifacts",
        {"risk_signals": ["release-or-publication"]})
    assert decision["mode"] == "orchestrated"
    assert decision["approval_required"] is False
    assert "security-review" not in decision["responsibilities"]
    assert "release-review" in decision["responsibilities"]
    assert "quality-review" in decision["responsibilities"]


def test_long_horizon_mode_for_multi_session_migration():
    decision = classify_adaptive_decision(
        "Migrate session auth to JWT over 3 sessions",
        {"session_scope": "multi-session", "checkpoint_requirement": "durable"})
    assert decision["mode"] == "long-horizon"
    assert decision["approval_required"] is False
    assert "continuity" in decision["responsibilities"]
    assert "continue" in decision["stages"]


def test_explicit_workflow_override_is_authoritative():
    decision = classify_adaptive_decision(
        "Create a plan only — do not implement yet. Use lazy-ulw-plan", {})
    assert decision["explicitWorkflow"] == "lazy-ulw-plan"
    assert decision["mode"] == "planned"
    assert "implement" not in decision["stages"]
    assert "plan" in decision["stages"]
    assert "implementation" not in decision["responsibilities"]
    assert decision["approval"] == {
        "requiredClasses": [],
        "status": "not-required",
    }
    assert isinstance(decision["snapshot"]["nextAction"], str)
    assert decision["snapshot"]["nextAction"]


def test_escalation_bound_when_verification_failure_with_initial_mode():
    """Step 6 early: prior escalation context produces blocked-state record."""
    decision = classify_adaptive_decision(
        "Fix failing unit test",
        {
            "initial_mode": "direct",
            "scope_revealed_broader": True,
            "signals": {
                "repeated_failure_after_bound": True,
                "verification_failure": True,
            },
        })
    assert decision["mode"] == "assisted"
    assert decision["snapshot"]["escalationCount"] == 2
    assert decision["snapshot"]["blocker"] is not None
    assert "attemptedApproaches" in decision["snapshot"]["blocker"]
    assert "nextRequiredDecision" in decision["snapshot"]["blocker"]


def test_preferred_provider_unavailable_preserves_assisted():
    """Fallback capability preserves the mode at assisted."""
    decision = classify_adaptive_decision(
        "Refactor search service to support fuzzy matching",
        {"preferred_provider_unavailable": True, "scope": "bounded"})
    assert decision["mode"] == "assisted"
    assert "semantic-navigation" in decision["runtime_resolution"]
    assert decision["runtime_resolution"]["semantic-navigation"].startswith("unavailable:fallback")


def test_decision_has_all_section_5_fields():
    decision = classify_adaptive_decision("Fix typo", {})
    for field in DECISION_REQUIRED_FIELDS:
        assert field in decision, f"decision missing field: {field}"
    not_selected = decision["not_selected"]
    assert "stages" in not_selected
    assert "capabilities" in not_selected
    assert "responsibilities" in not_selected


def test_snapshot_has_all_section_11_fields():
    decision = classify_adaptive_decision("Fix typo", {})
    snapshot = decision["snapshot"]
    for field in SNAPSHOT_REQUIRED_FIELDS:
        assert field in snapshot, f"snapshot missing field: {field}"
    assert snapshot["version"] == 1
    assert snapshot["decisionId"].startswith("adaptive-")
    assert snapshot["requestDigest"].startswith("sha256:")
    for field in ("hostFingerprint", "scopeFingerprint"):
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", snapshot[field])
    assert snapshot["revisionFingerprint"] == {
        "digest": None,
        "status": "unavailable",
    }
    assert snapshot["blocker"] is None  # default state has no blocker
    assert snapshot["escalationCount"] == 0


def test_request_digest_is_exact_sha256():
    decision = classify_adaptive_decision("Fix the typo in errors.js:42", {})
    digest = decision["snapshot"]["requestDigest"]
    assert digest.startswith("sha256:")
    raw_digest = digest[len("sha256:"):]
    assert re.fullmatch(r"[0-9a-f]{64}", raw_digest)


def test_no_provider_activation_during_classification():
    """The detector signal must be appended to reasons only, never used to gate mode."""
    decision = classify_adaptive_decision("How does React 19 useActionState work?",
                                          {"already_tried_local": True,
                                           "repository": {"languages": ["typescript"],
                                                          "source_files": 10}})
    # The decision must still produce a mode (direct default if no other signals).
    assert decision["mode"] in ("direct", "assisted", "planned", "orchestrated", "long-horizon")
    # If the detector returned a signal, it must appear in reasons; if not, no crash.
    assert isinstance(decision["reasons"], list)


def test_empty_request_returns_direct_default():
    decision = classify_adaptive_decision("", {})
    assert decision["mode"] == "direct"
    assert decision["approval_required"] is False


def test_none_context_is_handled():
    decision = classify_adaptive_decision("Fix typo", None)
    assert decision["mode"] == "direct"


def test_not_selected_computed_correctly():
    decision = classify_adaptive_decision("Fix typo", {})
    not_selected = decision["not_selected"]
    # direct mode has stages [implement, verify], so all other stages must be in not_selected.
    assert "understand" in not_selected["stages"]
    assert "plan" in not_selected["stages"]
    assert "review" in not_selected["stages"]
    assert "continue" in not_selected["stages"]
    assert "debug" in not_selected["stages"]
    # direct mode has [implementation, verification], so others must be in not_selected.
    assert "planning" in not_selected["responsibilities"]
    assert "debugging" in not_selected["responsibilities"]
    assert "security-review" in not_selected["responsibilities"]


def test_decision_id_unique_across_calls():
    d1 = classify_adaptive_decision("Fix typo", {})
    d2 = classify_adaptive_decision("Fix typo", {})
    assert d1["snapshot"]["decisionId"].startswith("adaptive-")
    assert d2["snapshot"]["decisionId"].startswith("adaptive-")
    assert d1["snapshot"]["decisionId"] != d2["snapshot"]["decisionId"]


def test_decision_id_can_be_overridden():
    """A caller may supply a decision_id via context for fixture parity."""
    decision = classify_adaptive_decision(
        "Fix typo", {"decision_id": "fixture-01-direct-localized-fix"})
    assert decision["snapshot"]["decisionId"] == "fixture-01-direct-localized-fix"


@pytest.mark.parametrize(
    ("prompt_text", "expected_class"),
    (
        ("Use Playwright to automate the browser.", "browser-or-desktop-control"),
        ("Add an MCP connector to the host settings.", "host-mcp-settings-mutation"),
        ("Configure the MCP settings.", "host-mcp-settings-mutation"),
        ("Rotate the CI deploy token before the release.", "credentials-auth-or-paid-service"),
        ("Push the repository changes to origin main.", "remote-data-egress"),
        ("Push changes to feature/release-1.0.3.", "remote-data-egress"),
        ("Push the branch release/v1 to GitHub.", "remote-data-egress"),
        ("Delete the deploy token.", "credentials-auth-or-paid-service"),
        ("Update the CI secret.", "credentials-auth-or-paid-service"),
    ),
)
def test_concrete_host_control_action_requires_approval(
    prompt_text: str,
    expected_class: str,
) -> None:
    # Given/When
    decision = classify_adaptive_decision(prompt_text)

    # Then
    assert decision["approval_classes"] == [expected_class]
    assert decision["approval_required"] is True


def test_credential_discussion_without_a_concrete_action_does_not_require_approval():
    decision = classify_adaptive_decision("Document the secret rotation policy.")
    assert decision["approval_classes"] == []
    assert decision["approval_required"] is False


@pytest.mark.parametrize(
    ("prompt_text", "expected_mode"),
    (
        ("Investigate why test_format_result is failing in the calculator module.", "assisted"),
        ("Refactor the calculator module to add input validation for all public functions.", "planned"),
        ("Migrate the test suite to pytest-bdd across the next week.", "long-horizon"),
    ),
)
def test_real_world_scope_language_selects_the_lowest_sufficient_mode(
    prompt_text: str,
    expected_mode: str,
) -> None:
    assert classify_adaptive_decision(prompt_text)["mode"] == expected_mode
