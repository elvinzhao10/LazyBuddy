from __future__ import annotations

from lazybuddy_adaptive_policy import ALL_CAPABILITIES, ALL_RESPONSIBILITIES
from lazybuddy_adaptive_policy import ALL_STAGES, PolicySelection, _risk_signals


def decision_reasons(
    text: str,
    context: dict,
    policy: PolicySelection,
    substitutions: list[dict],
    stale_material: list[str],
    required_approval: list[str],
) -> list[str]:
    signals = context.get("signals")
    verification_failed = (
        isinstance(signals, dict)
        and signals.get("verification_failure") is True
    )
    if stale_material:
        changed_revision = "revisionFingerprint" in stale_material
        reasons = [
            (
                "The revision fingerprint changed materially."
                if changed_revision
                else "Material continuation fingerprints changed."
            ),
            "The stale snapshot is diagnostic only and prior completion is rejected.",
            "Current risk and approval were re-evaluated before reclassification.",
        ]
    elif policy.explicit_workflow is not None:
        reasons = [
            "The user explicitly selected a named plan-only workflow." if policy.explicit_workflow == "lazy-ulw-plan" else "The user explicitly selected a named execution workflow.",
            "The classifier must not replace or deepen the explicit request.",
            "Implementation is excluded by the instruction." if policy.explicit_workflow == "lazy-ulw-plan" else "The named workflow retains its execution and verification stages.",
        ]
    elif substitutions:
        reasons = [
            "The preferred capability class is unavailable.",
            "A safe substitution preserves assisted mode.",
            "Additional verification compensates for weaker navigation evidence.",
        ]
    elif verification_failed:
        reasons = ["The first verification failure adds a debugging stage."]
        if context.get("scope_revealed_broader") is True:
            reasons.extend(
                [
                    "The failure reveals broader scope and permits one mode increase.",
                    "Two adjacent transitions consume the automatic escalation bound.",
                ]
            )
    elif policy.mode == "direct":
        reasons = [
            "The change is localized and its acceptance criteria are clear.",
            "Targeted verification is sufficient.",
            "The lowest sufficient mode is direct.",
        ]
    elif policy.mode == "assisted":
        reasons = [
            "The defect crosses several unfamiliar components.",
            "Exploration and debugging are required before a bounded implementation.",
            "The scope does not justify orchestration.",
        ]
    elif policy.mode == "planned":
        reasons = [
            "Acceptance criteria remain unresolved.",
            "Several design decisions must precede product edits.",
            "The scope is broad but does not require independent workstreams.",
        ]
    elif policy.mode == "orchestrated":
        security, release, _ = _risk_signals(text, context)
        if security:
            reasons = [
                "Authorization behavior is security-sensitive.",
                "Material risk requires independent verification and security review.",
                "Review responsibility is automatic and selects no approval action class.",
            ]
        elif release:
            reasons = [
                "Release preparation is materially risky and needs independent evidence.",
                "Release review is a responsibility rather than an approval action class.",
                "Publication mutation remains outside the selected actions.",
            ]
        else:
            reasons = [
                "Independent workstreams require orchestration.",
                "Implementation and review have distinct owners.",
            ]
    else:
        reasons = [
            "The request explicitly spans multiple sessions.",
            "Durable checkpoints and repeated cycles are required.",
            "Existing package-owned continuation state is sufficient.",
        ]
    if required_approval:
        reasons.append("A requested action crosses an approval-required authority boundary.")
    return reasons


def not_selected(
    text: str,
    context: dict,
    policy: PolicySelection,
    substitutions: list[dict],
    stale_material: list[str],
) -> dict:
    signals = context.get("signals")
    verification_failed = (
        isinstance(signals, dict)
        and signals.get("verification_failure") is True
    )
    security, release, _ = _risk_signals(text, context)
    if stale_material:
        reasons = [
            "The changed revision requires fresh understanding but not a full new plan.",
            "Prior completion evidence cannot satisfy current verification.",
        ]
    elif policy.explicit_workflow is not None:
        reasons = [
            "The explicit instruction stops before execution." if policy.explicit_workflow == "lazy-ulw-plan" else "Only stages outside the named workflow are omitted.",
            "No durable continuation is required for a plan-only result." if policy.explicit_workflow == "lazy-ulw-plan" else "The named workflow is not replaced by a deeper adaptive workflow.",
        ]
    elif substitutions:
        reasons = [
            "A bounded class-level substitution avoids deeper workflow selection.",
            "No durable continuation is required.",
        ]
    elif verification_failed:
        reasons = [
            "The revealed scope remains bounded after one mode increase.",
            "Durable continuation and independent review are unnecessary.",
        ]
    elif policy.mode == "direct":
        reasons = [
            "The request is already localized and does not need broader context.",
            "The task does not need resumable state or independent review.",
        ]
    elif policy.mode == "assisted":
        reasons = [
            "The cross-file trace is bounded and does not require broad architecture context.",
            "The work is expected to finish without durable continuation.",
        ]
    elif policy.mode == "planned":
        reasons = [
            "The feature is bounded to one session and needs no durable continuation.",
            "Independent review is not justified by the current risk.",
        ]
    elif security:
        reasons = [
            "No documentation change is required by this authorization correction.",
            "Release review is outside the selected responsibility set.",
        ]
    elif release:
        reasons = [
            "No separate documentation capability is necessary for the bounded release metadata edits.",
            "Publication mutation is explicitly excluded from the request.",
        ]
    else:
        reasons = [
            "The multi-session migration requires the complete portable capability class set.",
            "Independent review is not selected solely because work spans sessions.",
        ]
    return {
        "capabilities": sorted(set(ALL_CAPABILITIES) - set(policy.capabilities)),
        "reasons": reasons,
        "responsibilities": sorted(
            set(ALL_RESPONSIBILITIES) - set(policy.responsibilities)
        ),
        "stages": sorted(set(ALL_STAGES) - set(policy.stages)),
    }


def user_explanation(
    text: str,
    context: dict,
    policy: PolicySelection,
    substitutions: list[dict],
    stale_material: list[str],
    required_approval: list[str],
) -> dict[str, str]:
    signals = context.get("signals")
    verification_failed = (
        isinstance(signals, dict)
        and signals.get("verification_failure") is True
    )
    security, release, _ = _risk_signals(text, context)
    if stale_material:
        values = (
            "Current approval classes were re-evaluated and none are selected.",
            "Prior completion is rejected and fresh standard verification is required.",
            "A full restart and reuse of stale completion are both unnecessary.",
            "Assisted reclassification begins from fresh understanding after the revision change.",
        )
    elif policy.explicit_workflow is not None:
        values = (
            "No approval action class is selected.",
            "The plan artifact receives a targeted structural check." if policy.explicit_workflow == "lazy-ulw-plan" else f"{policy.verification_level.title()} verification follows the named workflow.",
            "Implementation and continuation are excluded by the user." if policy.explicit_workflow == "lazy-ulw-plan" else "Only stages outside the named workflow are excluded.",
            "The named plan-only workflow is authoritative." if policy.explicit_workflow == "lazy-ulw-plan" else "The named execution workflow is authoritative.",
        )
    elif substitutions:
        values = (
            "No install or activation approval is requested because existing classes provide the fallback.",
            "Additional verification compensates for the weaker substitution.",
            "A deeper mode and new capability activation are unnecessary.",
            "Assisted mode uses structural and text search as allowed substitution classes.",
        )
    elif verification_failed:
        values = (
            "No approval action class is selected.",
            "Standard verification reruns after bounded debugging.",
            "Planning and orchestration remain unnecessary after one mode increase.",
            "Debugging was added first; assisted mode followed only after broader scope was proven.",
        )
    elif policy.mode == "direct":
        values = (
            "No approval action class is selected.",
            "A focused check is sufficient evidence.",
            "Planning, continuation, and independent review are unnecessary.",
            "Direct implementation and targeted verification are selected.",
        )
    elif policy.mode == "assisted":
        values = (
            "No approval action class is selected.",
            "Standard verification follows the diagnostic correction.",
            "Planning and durable continuation are unnecessary for this bounded trace.",
            "Assisted exploration and debugging precede implementation.",
        )
    elif policy.mode == "planned":
        values = (
            "No approval action class is selected.",
            "Standard verification follows the approved design.",
            "Durable continuation and independent review are unnecessary.",
            "Planning resolves the open design choices before implementation.",
        )
    elif security:
        values = (
            "No approval action class is selected by security review itself.",
            "Independent verification and security review are required.",
            "Release and continuation responsibilities are outside this bounded change.",
            "Orchestration separates implementation from independent review.",
        )
    elif release:
        values = (
            "No approval is required until an excluded publish mutation is requested.",
            "Independent release review and artifact verification are required.",
            "Publishing and account mutation are not selected.",
            "Release preparation is orchestrated with independent evidence.",
        )
    else:
        values = (
            "Package-owned local checkpoints are automatic for this task.",
            "Each checkpoint retains standard verification evidence.",
            "A replacement state system and independent review are unnecessary.",
            "Long-horizon continuation preserves progress across multiple sessions.",
        )
    explanation = dict(
        zip(("approval", "evidence", "not_selected", "selected"), values)
    )
    if required_approval:
        explanation["approval"] = (
            "Approval is pending for: "
            + ", ".join(required_approval)
            + "."
        )
    return explanation
