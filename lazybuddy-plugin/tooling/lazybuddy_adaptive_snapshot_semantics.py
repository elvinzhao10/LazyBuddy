from __future__ import annotations

from typing import Final, NamedTuple

from lazybuddy_adaptive_policy import PolicySelection, _risk_signals


NUMBER_WORDS: Final = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
}


class SnapshotSemantics(NamedTuple):
    blocker: dict | None
    context: dict
    policy: PolicySelection
    request: str
    required_approval: list[str]
    stale_material: list[str]
    substitutions: list[dict]


def snapshot_reasons(semantics: SnapshotSemantics) -> list[str]:
    policy = semantics.policy
    signals = semantics.context.get("signals")
    verification_failed = (
        isinstance(signals, dict)
        and signals.get("verification_failure") is True
    )
    if policy.explicit_workflow == "lazy-ulw-plan":
        return [
            "The explicit named workflow is authoritative.",
            "Implementation is excluded by the instruction.",
        ]
    if semantics.stale_material:
        return [
            (
                "The revision fingerprint changed materially."
                if "revisionFingerprint" in semantics.stale_material
                else "Material continuation fingerprints changed."
            ),
            "Prior completion evidence is stale.",
        ]
    if verification_failed:
        reasons = ["Verification failure added debugging."]
        if semantics.context.get("scope_revealed_broader") is True:
            reasons.append("Broader scope justified one mode increase.")
        return reasons
    if semantics.substitutions:
        return [
            "The preferred capability class is unavailable.",
            "A safe substitution preserves assisted mode.",
        ]
    security, release, _ = _risk_signals(
        semantics.request,
        semantics.context,
    )
    if policy.mode == "orchestrated" and security:
        return [
            "Authorization behavior is security-sensitive.",
            "Material risk requires independent verification.",
        ]
    if policy.mode == "orchestrated" and release:
        return [
            "Release preparation is materially risky.",
            "Independent artifact evidence is required.",
        ]
    return {
        "assisted": [
            "The defect crosses several unfamiliar components.",
            "Exploration and debugging are required before implementation.",
        ],
        "direct": [
            "The change is localized and its acceptance criteria are clear.",
            "Targeted verification is sufficient.",
        ],
        "long-horizon": [
            "The request explicitly spans multiple sessions.",
            "Durable checkpoints are required.",
        ],
        "orchestrated": [
            "Material risk or independent workstreams require orchestration.",
            "Independent verification is required.",
        ],
        "planned": [
            "Acceptance criteria remain unresolved.",
            "Several design decisions must precede product edits.",
        ],
    }[policy.mode]


def next_action(semantics: SnapshotSemantics) -> str:
    if semantics.required_approval:
        return "Wait for explicit approval before dispatch."
    if semantics.blocker is not None:
        return semantics.blocker["nextRequiredDecision"]
    policy = semantics.policy
    if policy.explicit_workflow == "lazy-ulw-plan":
        return "Produce the approved plan and stop before implementation."
    if semantics.stale_material:
        return (
            "Preserve the stale diagnostic, reject prior completion, and run "
            "fresh verification."
        )
    signals = semantics.context.get("signals")
    if (
        isinstance(signals, dict)
        and signals.get("verification_failure") is True
    ):
        return (
            "Trace the broader dependency, apply the bounded correction, and "
            "rerun standard verification."
        )
    if semantics.substitutions:
        return (
            "Use the allowed substitution classes and add the compensating "
            "verification."
        )
    decisions = semantics.context.get("decisions_to_resolve")
    decision_count = len(decisions) if isinstance(decisions, list) else 0
    decision_label = NUMBER_WORDS.get(decision_count, str(decision_count))
    planned_action = (
        f"Resolve the {decision_label} design "
        f"{'decision' if decision_count == 1 else 'decisions'} and approve a "
        "bounded implementation plan."
        if decision_count
        else "Resolve the open decisions before bounded implementation."
    )
    _, release, _ = _risk_signals(semantics.request, semantics.context)
    assisted_action = (
        "Trace the stale-data behavior across the bounded components."
        if "stale" in semantics.request.lower()
        else "Trace the bounded behavior across the affected components."
    )
    return {
        "assisted": assisted_action,
        "direct": "Apply the localized correction and run the focused check.",
        "long-horizon": (
            "Establish the first checkpoint and begin the bounded migration plan."
        ),
        "orchestrated": (
            "Prepare release artifacts and capture independent verification "
            "without publishing."
            if release
            else "Assign implementation and independent review to distinct owners."
        ),
        "planned": planned_action,
    }[policy.mode]
