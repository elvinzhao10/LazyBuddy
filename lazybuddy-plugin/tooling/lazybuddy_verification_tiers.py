#!/usr/bin/env python3
"""T6 — Verification tiers (v1.3.0).

Reduces ceremony by selecting the LOWEST SUFFICIENT verification tier from the
changed behavior and observed risk, then reusing a green receipt while its
declared inputs and covered behavior stay unchanged.

The V0-V3 tier definitions are the LazySeries shared contract (plan behavior 9,
contract `lazyseries-v1.3.0`). This module consumes them from the shared
fixture ``contracts/fixtures/lazyseries-v130-scenarios.v1.json`` (read-only;
byte-identity is enforced across Buddy/Trae/Qoder) and falls back to the
embedded mirror only when the fixture does not yet carry an explicit
``verification_tiers`` block. The fixture is the source of truth for
``contract_version`` and boundary vocabulary; the module never forks it.

Selection rules (plan behavior 9 / T6):

- Default to the lowest sufficient tier.
- Test count, file count, plan size, agent count, or a request being called
  "complex" CANNOT by themselves promote verification. Promote only for the
  changed boundary or observed risk.
- A failing focused check triggers diagnosis; it does NOT automatically trigger
  every suite. Rerun only the failed check after a fix, then any directly
  affected integration check.
- Run a comprehensive gate once after the final relevant change, preferably in
  protected CI. Security checks are mandatory only when the diff reaches a
  security/trust boundary or repository policy requires them.

Receipt shape (compact, dedup-friendly):
    {tier, surface (argv), covered_behavior, tree (revision),
     environment_fingerprint, result, artifact_ref}

Before running a check, reuse a matching GREEN receipt when its declared inputs
and covered behavior are unchanged. Do not copy command output into multiple
ledgers; one execution state supplies checkbox/status projections and retains
detailed evidence by reference.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Mapping

TIER_V0: Final = "V0"
TIER_V1: Final = "V1"
TIER_V2: Final = "V2"
TIER_V3: Final = "V3"
TIERS: Final = (TIER_V0, TIER_V1, TIER_V2, TIER_V3)
TIER_ORDER: Final = {TIER_V0: 0, TIER_V1: 1, TIER_V2: 2, TIER_V3: 3}

REQUIRED_CONTRACT_VERSION: Final = "1.3.0"

# Boundary vocabulary -> tier. Mutually exclusive classes; the changed boundary
# decides. Counts / naming signals are deliberately absent here so they can
# never promote a tier.
V0_BOUNDARIES: Final = frozenset({
    "doc", "docs", "documentation", "readme", "metadata", "formatting",
    "fixture", "fixture-inert", "fixtures", "comment", "comments", "spelling",
    "i18n", "lint", "style", "typo-doc",
})
V2_BOUNDARIES: Final = frozenset({
    "cross-module", "cross_module", "state", "parser", "migration", "lifecycle",
    "host-routing", "host_routing", "integration", "integration-change",
})
V3_BOUNDARIES: Final = frozenset({
    "security", "trust", "release-packaging", "release", "release_package",
    "shared-contract", "shared_contract", "schema", "broad-infra",
    "broad_infra", "infrastructure", "contract",
})

# Risk flags that MAY promote (genuine boundaries/observed risk only):
#   reaches_security_trust : diff touches a security/trust boundary
#   unexplained_focused_failure : a focused check failed without an obvious cause
# Every other risk key (counts, sizes, agent counts, "complex" naming) is a
# NON-PROMOTING signal and is ignored by select_tier.
NON_PROMOTING_RISK_KEYS: Final = (
    "test_count", "file_count", "plan_size", "agent_count", "called_complex",
    "naming", "word_count",
)


@dataclass(frozen=True)
class VerificationReceipt:
    """A compact, dedup-friendly verification receipt.

    Green receipts are reused across implementation, review, QA, completion,
    CI handoff, and release so identical commands never run twice on unchanged
    inputs. Detailed command output is NOT stored here; ``artifact_ref`` points
    to the evidence by reference.
    """

    tier: str
    surface: str
    covered_behavior: str
    tree: str
    environment_fingerprint: str
    result: str  # "pass" | "fail"
    artifact_ref: str = ""

    def as_dict(self) -> dict:
        return {
            "tier": self.tier,
            "surface": self.surface,
            "covered_behavior": self.covered_behavior,
            "tree": self.tree,
            "environment_fingerprint": self.environment_fingerprint,
            "result": self.result,
            "artifact_ref": self.artifact_ref,
        }


def load_scenarios_fixture(path: str | Path | None = None) -> dict:
    """Load the shared LazySeries scenario fixture (read-only source of truth).

    Raises ``FileNotFoundError`` if the fixture is missing and ``ValueError`` if
    its ``contract_version`` is not the v1.3.0 shared contract this module
    consumes. The fixture is never modified here.
    """
    if path is None:
        path = (
            Path(__file__).resolve().parent.parent
            / "contracts"
            / "fixtures"
            / "lazyseries-v130-scenarios.v1.json"
        )
    else:
        path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"shared fixture not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    version = str(data.get("contract_version", ""))
    if version != REQUIRED_CONTRACT_VERSION:
        raise ValueError(
            f"fixture contract_version is {version!r}, expected "
            f"{REQUIRED_CONTRACT_VERSION!r}"
        )
    return data


def verification_tier_definitions(fixture: Mapping | None = None) -> dict:
    """Return the V0-V3 tier definitions.

    Consumes ``fixture['verification_tiers']`` when present, otherwise the
    embedded mirror of plan behavior 9. Either way the definitions are the same
    shared contract; this function exists so adapters read one place.
    """
    if isinstance(fixture, Mapping) and isinstance(fixture.get("verification_tiers"), dict):
        return dict(fixture["verification_tiers"])
    return {
        TIER_V0: {
            "name": "inspect",
            "scope": "documentation, metadata, formatting, or inert fixture changes",
            "default_action": "syntax/schema/static checks only when applicable; no new test required by default",
        },
        TIER_V1: {
            "name": "focused",
            "scope": "localized reversible behavior",
            "default_action": "smallest existing test or direct user-surface scenario covering the changed boundary",
        },
        TIER_V2: {
            "name": "integrated",
            "scope": "cross-module, state, parser, migration, lifecycle, or host-routing behavior",
            "default_action": "focused checks plus one real consumer/integration scenario",
        },
        TIER_V3: {
            "name": "comprehensive",
            "scope": "security/trust boundaries, release packaging, shared contract/schema changes, broad infrastructure, or an unexplained focused failure",
            "default_action": "repository comprehensive gate once, normally in protected CI",
        },
    }


def _normalize_boundary(changed_boundary: str | None) -> str:
    return (changed_boundary or "").strip().lower()


def _normalize_risk(risk: Mapping | None) -> dict:
    if risk is None:
        return {}
    if not isinstance(risk, Mapping):
        raise TypeError("risk must be a mapping or None")
    return {str(k): v for k, v in risk.items()}


# Public re-export alias so adapters can read the canonical vocabulary.
BOUNDARY_VOCABULARY: Final = {
    "V0": sorted(V0_BOUNDARIES),
    "V2": sorted(V2_BOUNDARIES),
    "V3": sorted(V3_BOUNDARIES),
}


def select_tier(changed_boundary: str | None, risk: Mapping | None = None) -> str:
    """Select the LOWEST SUFFICIENT verification tier from the changed boundary
    and observed risk.

    Non-promoting signals — ``test_count``, ``file_count``, ``plan_size``,
    ``agent_count``, ``called_complex`` / ``naming`` — are explicitly ignored:
    they can never raise the tier. Promotion happens only for the changed
    boundary class or a genuine risk flag (security/trust reach, unexplained
    focused failure).
    """
    boundary = _normalize_boundary(changed_boundary)
    risk = _normalize_risk(risk)

    # Defensive: acknowledge the non-promoting keys are present but unused.
    # They are intentionally NOT consulted below.
    _ = {k: risk.get(k) for k in NON_PROMOTING_RISK_KEYS if k in risk}

    if boundary in V3_BOUNDARIES or risk.get("reaches_security_trust") \
            or risk.get("unexplained_focused_failure"):
        return TIER_V3
    if boundary in V2_BOUNDARIES:
        return TIER_V2
    if boundary in V0_BOUNDARIES:
        return TIER_V0
    # Lowest sufficient default: localized reversible behavior.
    return TIER_V1


def build_receipt(
    tier: str,
    surface: str,
    covered_behavior: str,
    tree: str,
    environment_fingerprint: str,
    result: str,
    artifact_ref: str = "",
) -> VerificationReceipt:
    """Construct a verification receipt."""
    if tier not in TIERS:
        raise ValueError(f"unknown tier: {tier!r}")
    if result not in ("pass", "fail"):
        raise ValueError(f"result must be 'pass' or 'fail', got {result!r}")
    return VerificationReceipt(
        tier=tier,
        surface=surface,
        covered_behavior=covered_behavior,
        tree=tree,
        environment_fingerprint=environment_fingerprint,
        result=result,
        artifact_ref=artifact_ref,
    )


def _inputs_match(receipt: VerificationReceipt, current_inputs: Mapping) -> bool:
    return (
        current_inputs.get("surface") == receipt.surface
        and current_inputs.get("covered_behavior") == receipt.covered_behavior
        and current_inputs.get("tree") == receipt.tree
        and current_inputs.get("environment_fingerprint") == receipt.environment_fingerprint
    )


def reuse_receipt(
    existing_receipt: VerificationReceipt | None,
    current_inputs: Mapping,
) -> bool:
    """Return True when a GREEN receipt can be reused for ``current_inputs``.

    A green receipt is reusable only when its declared inputs (surface, tree,
    environment_fingerprint) and covered behavior are unchanged. A failing
    receipt is never reusable — it must be rerun. A changed acceptance (covered
    behavior) or changed inputs invalidates the receipt.
    """
    if not isinstance(current_inputs, Mapping):
        raise TypeError("current_inputs must be a mapping")
    if existing_receipt is None:
        return False
    if existing_receipt.result != "pass":
        return False
    return _inputs_match(existing_receipt, current_inputs)


def rerun_scope(
    failed_receipt: VerificationReceipt | None,
    *,
    directly_affected_integration: list[str] | None = None,
) -> list[str]:
    """Minimal rerun set after a fix.

    A failing focused check reruns ONLY itself; any directly affected
    integration check reruns too. This is what stops one failure from
    triggering every suite. A green receipt needs no rerun (empty scope).
    """
    if failed_receipt is None:
        raise ValueError("failed_receipt is required")
    if failed_receipt.result == "pass":
        return []
    scope: list[str] = [failed_receipt.surface]
    for affected in directly_affected_integration or []:
        if affected not in scope:
            scope.append(affected)
    return scope


def material_verification_status(receipts: list[VerificationReceipt] | None) -> dict:
    """Default status projection: outcome, highest tier, and ONLY material
    verification state — failures plus an aggregate green count. Per-command
    green noise is suppressed so status stays readable.

    This is the single source the status surface projects; detailed evidence
    stays by reference in each receipt's ``artifact_ref``.
    """
    receipts = list(receipts or [])
    if not receipts:
        return {
            "outcome": "none",
            "highest_tier": None,
            "material_checks": [],
            "green_count": 0,
            "total": 0,
        }
    highest = max((r.tier for r in receipts), key=lambda t: TIER_ORDER.get(t, -1))
    failures = [r for r in receipts if r.result != "pass"]
    material = [
        {
            "tier": r.tier,
            "surface": r.surface,
            "covered_behavior": r.covered_behavior,
            "result": r.result,
        }
        for r in failures
    ]
    return {
        "outcome": "fail" if failures else "pass",
        "highest_tier": highest,
        "material_checks": material,
        "green_count": len(receipts) - len(failures),
        "total": len(receipts),
    }
