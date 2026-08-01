from __future__ import annotations

from typing import Final

from lazybuddy_adaptive_policy import (
    PolicySelection,
    _risk_signals,
    contract_policy,
)


RUNTIME_PROVIDERS: Final = {
    "architecture-context": "package-codegraph",
    "documentation": "package-docs",
    "execution": "package-cli",
    "outcome-verification": "package-verification",
    "semantic-navigation": "package-code-intel",
    "structural-search": "host-native",
    "task-state": "package-loop-store",
    "text-search": "host-native",
}
STAGE_RESPONSIBILITY: Final = {
    "continue": "continuity",
    "debug": "debugging",
    "implement": "implementation",
    "plan": "planning",
    "understand": "exploration",
    "verify": "verification",
}
REVIEW_RESPONSIBILITIES: Final = (
    "quality-review",
    "security-review",
    "release-review",
)


def capability_substitutions(context: dict) -> list[dict]:
    signals = context.get("signals")
    unavailable = (
        context.get("preferred_provider_unavailable") is True
        or context.get("preferred_capability_available") is False
        or isinstance(signals, dict)
        and signals.get("capability_unavailable") is True
    )
    if not unavailable:
        return []
    return [
        {
            "allowedSubstitutionClasses": ["structural-search", "text-search"],
            "evidenceDowngrade": "additional-verification-required",
            "explanation": (
                "Structural and text search preserve discovery coverage but "
                "require additional verification."
            ),
            "requiredClass": "semantic-navigation",
        }
    ]


def runtime_resolution(
    capabilities: list[str],
    substitutions: list[dict],
) -> dict[str, str]:
    resolved = {
        capability: RUNTIME_PROVIDERS[capability]
        for capability in capabilities
        if capability in RUNTIME_PROVIDERS
    }
    if substitutions:
        resolved["semantic-navigation"] = (
            "unavailable:fallback-to-structural-search+text-search"
        )
    return resolved


def responsibility_ownership(policy: PolicySelection) -> list[dict]:
    ownership: list[dict] = []
    for stage in policy.stages:
        if stage == "review":
            responsibilities = [
                item
                for item in REVIEW_RESPONSIBILITIES
                if item in policy.responsibilities
            ]
        else:
            responsibility = STAGE_RESPONSIBILITY.get(stage)
            responsibilities = [responsibility] if responsibility else []
        for responsibility in responsibilities:
            if stage == "continue":
                owner_class = "continuity-owner"
            elif stage in {"understand", "plan"} and policy.mode in {
                "planned",
                "orchestrated",
                "long-horizon",
            }:
                owner_class = "adaptive-orchestrator"
            elif stage in {"verify", "review"} and policy.mode == "orchestrated":
                owner_class = "independent-reviewer"
            else:
                owner_class = "implementation-owner"
            ownership.append(
                {
                    "ownerClass": owner_class,
                    "responsibility": responsibility,
                    "stage": stage,
                }
            )
    return ownership


def authority_boundary(
    required_approval: list[str],
    policy: PolicySelection,
    context: dict,
    text: str,
) -> dict:
    allowed = contract_policy()["approval_policy"]["automatic_action_classes"]
    selected = {"existing-capability-use", "read-only-local-inspection"}
    if "implementation" in policy.responsibilities:
        selected.update({"repository-edit", "targeted-local-execution"})
    if (
        "continuity" in policy.responsibilities
        or context.get("continuation_requested") is True
        or context.get("material_change")
    ):
        selected.add("package-owned-local-state")
    boundary_approval = list(required_approval)
    _, release, _ = _risk_signals(text, context)
    if release and "account-marketplace-or-publish-mutation" not in boundary_approval:
        boundary_approval.append("account-marketplace-or-publish-mutation")
    return {
        "approval_required": boundary_approval,
        "automatic": [item for item in allowed if item in selected],
    }


def risk_level(text: str, context: dict, mode: str) -> str:
    current = context.get("current_risk")
    if current in {"low", "standard", "material", "high"}:
        return current
    if context.get("named_workflow_class") == "plan-only":
        return "low"
    security, release, multiple = _risk_signals(text, context)
    if security:
        return "high"
    if release or multiple or mode in {"orchestrated", "long-horizon"}:
        return "material"
    return "standard" if mode in {"assisted", "planned"} else "low"


def bounded_blocker(context: dict, escalation_count: int) -> dict | None:
    signals = context.get("signals")
    repeated = context.get("repeated_failure_after_bound") is True or (
        isinstance(signals, dict)
        and signals.get("repeated_failure_after_bound") is True
    )
    if escalation_count < 2 or not repeated:
        return None
    return {
        "attemptedApproaches": [
            "Added a debugging stage after verification failed.",
            "Increased workflow depth after broader scope was proven.",
        ],
        "currentEvidence": "Verification still fails after two automatic transitions.",
        "nextRequiredDecision": "Provide the missing external requirement or choose a new approach.",
        "reproducedFailure": "The verification failure remains reproducible.",
        "unresolvedDecision": "No further automatic workflow increase is permitted.",
    }
