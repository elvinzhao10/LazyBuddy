#!/usr/bin/env python3
from __future__ import annotations

import re
import uuid

from lazybuddy_adaptive_decision_fields import (
    authority_boundary,
    bounded_blocker,
    capability_substitutions,
    responsibility_ownership,
    risk_level,
    runtime_resolution,
)
from lazybuddy_adaptive_fingerprint import canonical_fingerprint, request_digest
from lazybuddy_adaptive_policy import (
    PolicySelection,
    approval_classes,
    escalation_history,
    select_policy,
)
from lazybuddy_adaptive_snapshot import validate_adaptive_snapshot
from lazybuddy_adaptive_snapshot_semantics import (
    SnapshotSemantics,
    next_action,
    snapshot_reasons,
)
from lazybuddy_adaptive_selection_explanation import (
    decision_reasons,
    not_selected,
    user_explanation,
)


SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def _digest_or_default(value: object, material: dict) -> str:
    if isinstance(value, str) and SHA256_PATTERN.fullmatch(value):
        return value
    return canonical_fingerprint(material)


def _revision_or_default(value: object) -> dict:
    if isinstance(value, dict):
        status = value.get("status")
        digest = value.get("digest")
        if status == "available" and isinstance(digest, str) and SHA256_PATTERN.fullmatch(digest):
            return {"digest": digest, "status": status}
        if status == "unavailable" and digest is None:
            return {"digest": None, "status": status}
    return {"digest": None, "status": "unavailable"}


def _fingerprints(request: str, context: dict) -> dict:
    return {
        "hostFingerprint": _digest_or_default(
            context.get("host_fingerprint"),
            {"authorityBoundary": "unconfirmed-host"},
        ),
        "requestDigest": request_digest(request),
        "revisionFingerprint": _revision_or_default(
            context.get("revision_fingerprint")
        ),
        "scopeFingerprint": _digest_or_default(
            context.get("scope_fingerprint"),
            {
                "acceptanceCriteria": context.get("acceptance_criteria"),
                "checkpointRequirement": context.get("checkpoint_requirement"),
                "fileCount": context.get("file_count"),
                "repositoryFamiliarity": context.get("repository_familiarity"),
                "scope": context.get("scope", "unspecified"),
                "sessionScope": context.get("session_scope"),
            },
        ),
    }


def _stale_material(context: dict, prior: object, fingerprints: dict) -> list[str]:
    supplied = context.get("stale_material", context.get("material_change", []))
    changed = list(supplied) if isinstance(supplied, list) else []
    if isinstance(prior, dict):
        for field, current in fingerprints.items():
            if prior.get(field) != current:
                changed.append(field)
    return list(dict.fromkeys(str(field) for field in changed))


def _snapshot_policy(prior: dict, current: PolicySelection) -> PolicySelection | None:
    if not validate_adaptive_snapshot(prior):
        return None
    if (
        prior.get("mode") != current.mode
        or prior.get("stages") != current.stages
        or prior.get("responsibilities") != current.responsibilities
        or prior.get("capabilityClasses") != current.capabilities
        or prior.get("verificationLevel") != current.verification_level
    ):
        return None
    return current


def _snapshot_semantics_match(
    prior: dict,
    approval: dict,
    substitutions: list[dict],
    blocker: dict | None,
    selected_next_action: str,
    risk: str,
) -> bool:
    return (
        prior.get("approval") == approval
        and prior.get("blocker") == blocker
        and prior.get("capabilitySubstitutions") == substitutions
        and prior.get("nextAction") == selected_next_action
        and prior.get("risk") == risk
    )


def _decision_id(context: dict, prior: object, compatible: bool) -> str:
    if compatible and isinstance(prior, dict) and isinstance(prior.get("decisionId"), str):
        return prior["decisionId"]
    supplied = context.get("decision_id")
    return supplied if isinstance(supplied, str) else f"adaptive-{uuid.uuid4().hex}"


def _continued_history(prior: object, compatible: bool, context: dict) -> list[dict]:
    if compatible and isinstance(prior, dict):
        history = prior.get("escalationHistory")
        count = prior.get("escalationCount")
        if isinstance(history, list) and count == len(history) and len(history) <= 2:
            return list(history)
    return escalation_history(context)


def classify_adaptive_decision(request: str, context: dict | None = None) -> dict:
    context_values = dict(context) if isinstance(context, dict) else {}
    fingerprints = _fingerprints(request, context_values)
    prior = context_values.get("snapshot")
    stale_material = _stale_material(context_values, prior, fingerprints)
    policy_context = dict(context_values)
    policy_context["stale_material"] = stale_material
    current_policy = select_policy(request, policy_context)
    prior_policy = (
        _snapshot_policy(prior, current_policy)
        if isinstance(prior, dict) and not stale_material
        else None
    )
    required_approval = approval_classes(request)
    approval = {
        "requiredClasses": required_approval,
        "status": "pending" if required_approval else "not-required",
    }
    substitutions = capability_substitutions(context_values)
    compatible = prior_policy is not None
    if compatible and isinstance(prior, dict):
        continued_history = _continued_history(prior, True, context_values)
        continued_blocker = bounded_blocker(context_values, len(continued_history))
        compatible = _snapshot_semantics_match(
            prior,
            approval,
            substitutions,
            continued_blocker,
            next_action(SnapshotSemantics(
                blocker=continued_blocker, context=context_values,
                policy=current_policy, request=request,
                required_approval=required_approval, stale_material=[],
                substitutions=substitutions,
            )),
            risk_level(request, context_values, current_policy.mode),
        )
        if not compatible:
            prior_policy = None
    if isinstance(prior, dict) and not stale_material and not compatible:
        stale_material = ["decisionSemantics"]
        policy_context["stale_material"] = stale_material
        current_policy = select_policy(request, policy_context)
    policy = prior_policy or current_policy
    reasons = decision_reasons(
        request,
        context_values,
        policy,
        substitutions,
        stale_material,
        required_approval,
    )
    history = _continued_history(prior, compatible, context_values)
    blocker = bounded_blocker(context_values, len(history))
    decision_id = _decision_id(context_values, prior, compatible)
    current_stage = policy.stages[0]
    if compatible and isinstance(prior, dict) and prior.get("currentStage") in policy.stages:
        current_stage = prior["currentStage"]
    semantics = SnapshotSemantics(
        blocker=blocker, context=context_values,
        policy=policy, request=request,
        required_approval=required_approval, stale_material=stale_material,
        substitutions=substitutions,
    )
    selected_next_action = next_action(semantics)
    if (
        blocker is None
        and compatible
        and isinstance(prior, dict)
        and isinstance(prior.get("nextAction"), str)
    ):
        selected_next_action = prior["nextAction"]
    snapshot = {
        "approval": approval,
        "blocker": blocker,
        "capabilityClasses": policy.capabilities,
        "capabilitySubstitutions": substitutions,
        "currentStage": current_stage,
        "decisionId": decision_id,
        "escalationCount": len(history),
        "escalationHistory": history,
        "hostFingerprint": fingerprints["hostFingerprint"],
        "mode": policy.mode,
        "nextAction": selected_next_action,
        "reasons": snapshot_reasons(semantics),
        "requestDigest": fingerprints["requestDigest"],
        "responsibilities": policy.responsibilities,
        "revisionFingerprint": fingerprints["revisionFingerprint"],
        "risk": risk_level(request, context_values, policy.mode),
        "scopeFingerprint": fingerprints["scopeFingerprint"],
        "stages": policy.stages,
        "verificationLevel": policy.verification_level,
        "version": 1,
    }
    return {
        "allowed_substitutions": substitutions,
        "approval": approval,
        "approval_classes": required_approval,
        "approval_required": bool(required_approval),
        "authority_boundary": authority_boundary(
            required_approval,
            policy,
            context_values,
            request,
        ),
        "capabilities": policy.capabilities,
        "contractVersion": 1,
        "escalation_triggers": [item["trigger"] for item in history],
        "explicitWorkflow": policy.explicit_workflow,
        "fallback_policy": substitutions,
        "mode": policy.mode,
        "not_selected": not_selected(
            request,
            context_values,
            policy,
            substitutions,
            stale_material,
        ),
        "ownership": responsibility_ownership(policy),
        "reasons": reasons,
        "responsibilities": policy.responsibilities,
        "runtime_resolution": runtime_resolution(policy.capabilities, substitutions),
        "snapshot": snapshot,
        "stages": policy.stages,
        "user_explanation": user_explanation(
            request,
            context_values,
            policy,
            substitutions,
            stale_material,
            required_approval,
        ),
        "verification_level": policy.verification_level,
    }
