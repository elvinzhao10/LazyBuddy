"""W4.3 Capability Fallback integration tests for v1.0.3 Adaptive Harness (LazyBuddy).

Proves authority-safe capability fallback behavior per plan Section 9 (Fallback
behavior). Mirrors the LazyTrae W4.3 test file. Uses fixture
``08-preferred-provider-unavailable.json``.

Scenarios:
  1. preferred provider unavailable -> safe fallback (not the unavailable provider)
  2. fallback does NOT escalate mode (assisted stays assisted)
  3. all capability classes covered (resolved OR explicitly not-selected)
  4. no approval-required authority silently activated
  5. no remote provider silently enabled
  6. decision reasons report substitution and weaker evidence
  7. mapping surfaces stay non-empty for assisted mode
  8. snapshot round-trip preserves fallback resolution
  9. explanation mentions substitution (LazyBuddy explanation surfaces reasons)
  10. explanation fields preserve the weaker-evidence downgrade

Task description referenced "07-preferred-provider-unavailable.json" — that is a
typo; the canonical filename in both repos is "08-preferred-provider-unavailable.json".
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402
from lazybuddy_adaptive_explanation import (  # noqa: E402
    adaptive_explanation_fields,
    format_adaptive_explanation,
)
from lazybuddy_adaptive_mapping import map_adaptive_decision_to_surfaces  # noqa: E402
from lazybuddy_adaptive_snapshot import (  # noqa: E402
    read_adaptive_snapshot,
    write_adaptive_snapshot,
)

FIXTURE_PATH = (Path(__file__).resolve().parent.parent / "contracts" / "fixtures"
                / "v103" / "08-preferred-provider-unavailable.json")
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

ALL_CAPS = ("text-search", "structural-search", "semantic-navigation",
            "architecture-context", "documentation", "execution",
            "task-state", "outcome-verification")

AUTOMATIC_AUTHORITIES = ("host-native", "package-verification", "package-lsp",
                         "package-codegraph", "package-docs", "package-cli",
                         "package-loop-store")

APPROVAL_REQUIRED_TOKENS = ("install", "credential", "paid", "remote-provider",
                            "marketplace", "browser", "desktop-control",
                            "account-mutation", "data-egress")

REMOTE_PROVIDER_TOKENS = ("remote", "cloud-api", "external-api", "paid-service")


def _classify():
    return classify_adaptive_decision(FIXTURE["request"], FIXTURE["context"])


def _base_run_state():
    return {
        "schema_version": "2", "run_id": "test-w43", "status": "in_progress",
        "objective": "W4.3 fallback", "tasks": [], "tasks_done": 0,
        "tasks_total": 0, "verification_gates": [], "review_status": "pending",
        "iteration_count": 0, "last_checkpoint": "",
        "created_at": "2026-07-20T00:00:00Z", "updated_at": "2026-07-20T00:00:00Z",
        "mode": "adaptive", "plan_path": "", "current_task_id": "",
    }


def test_preferred_provider_unavailable_resolves_to_safe_fallback():
    """semantic-navigation must not resolve to the unavailable provider (lsp-bridge)."""
    decision = _classify()
    assert decision["mode"] == "assisted"
    sem_nav = decision["runtime_resolution"].get("semantic-navigation", "")
    assert sem_nav, "semantic-navigation must have a non-empty resolution"
    assert not re.search(r"lsp-bridge", sem_nav, re.I), \
        f"must not resolve to unavailable provider; got: {sem_nav}"
    assert re.search(r"fallback|unavailable|host-native|package-", sem_nav, re.I), \
        f"must be a safe fallback; got: {sem_nav}"


def test_fallback_does_not_escalate_mode():
    """Fallback must preserve assisted mode; no escalation, no approval required."""
    decision = _classify()
    assert decision["mode"] == "assisted"
    assert decision["approval_required"] is False
    assert decision["snapshot"]["escalationCount"] == 0


def test_all_capability_classes_covered():
    """Every contract capability class is resolved or explicitly not-selected."""
    decision = _classify()
    resolved = set(decision["runtime_resolution"].keys())
    not_selected = set(decision["not_selected"]["capabilities"])
    for cap in ALL_CAPS:
        is_resolved = cap in resolved and isinstance(
            decision["runtime_resolution"][cap], str
        ) and decision["runtime_resolution"][cap]
        is_not_selected = cap in not_selected
        assert is_resolved or is_not_selected, \
            f"capability {cap} must be resolved or explicitly not-selected"


def test_no_approval_required_authority_silently_activated():
    """Fallback values must be automatic-authority or fallback marker only."""
    decision = _classify()
    assert decision["approval_required"] is False
    for cap, value in decision["runtime_resolution"].items():
        is_automatic = value in AUTOMATIC_AUTHORITIES
        is_fallback_marker = bool(re.match(r"^unavailable:fallback-", value, re.I))
        assert is_automatic or is_fallback_marker, \
            f"{cap}={value} must be automatic-authority or fallback marker"
        for tok in APPROVAL_REQUIRED_TOKENS:
            assert not re.search(tok, value, re.I), \
                f"{cap}={value} must not reference approval-required token {tok}"


def test_no_remote_provider_silently_enabled():
    """runtime_resolution must not reference remote providers."""
    decision = _classify()
    for cap, value in decision["runtime_resolution"].items():
        for tok in REMOTE_PROVIDER_TOKENS:
            assert not re.search(tok, value, re.I), \
                f"{cap}={value} must not reference remote provider token {tok}"


def test_decision_reasons_report_substitution_and_weaker_evidence():
    """Decision reasons must report substitution and acknowledge weaker evidence."""
    decision = _classify()
    joined = "\n".join(decision["reasons"])
    assert re.search(r"semantic.navigation.*unavailable|substitut", joined, re.I), \
        "decision reasons must report substitution"
    assert re.search(
        r"verification expectations adjusted|weaker|no equivalent-evidence",
        joined, re.I,
    ), "decision reasons must acknowledge weaker evidence"


def test_mapping_surfaces_stay_non_empty_for_assisted_mode():
    """Assisted mode maps to lazy-start-work; no escalation to plan/orchestrate."""
    decision = _classify()
    mapping = map_adaptive_decision_to_surfaces(decision)
    assert mapping["workflow_surfaces"] == ["lazy-start-work"]
    assert mapping["verification_surface"] == "lazy-verifier"


def test_snapshot_round_trip_preserves_fallback_resolution():
    decision = _classify()
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    read = read_adaptive_snapshot(run_state)
    assert read["mode"] == "assisted"
    substitution = read["capabilitySubstitutions"][0]
    assert substitution["requiredClass"] == "semantic-navigation"
    assert substitution["allowedSubstitutionClasses"] == [
        "structural-search",
        "text-search",
    ]


def test_explanation_mentions_substitution():
    """LazyBuddy explanation surfaces reasons; substitution is visible."""
    decision = _classify()
    run_state = _base_run_state()
    write_adaptive_snapshot(run_state, decision["snapshot"])
    explanation = format_adaptive_explanation(run_state)
    assert explanation is not None
    assert re.search(r"semantic.navigation.*unavailable|substitut", explanation, re.I), \
        f"explanation must mention substitution; got: {explanation}"


def test_explanation_fields_preserve_weaker_evidence_downgrade():
    decision = _classify()
    fields = adaptive_explanation_fields(decision["snapshot"])
    evidence = fields["evidenceImpact"]
    substitution = evidence["substitutions"][0]
    assert substitution["evidenceDowngrade"] == (
        "additional-verification-required"
    )
    assert evidence["verificationLevel"] == "standard"
