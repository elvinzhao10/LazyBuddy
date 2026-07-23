from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Final


SNAPSHOT_REQUIRED_FIELDS: Final = (
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
    "nextAction",
    "reasons",
    "requestDigest",
    "responsibilities",
    "revisionFingerprint",
    "risk",
    "scopeFingerprint",
    "stages",
    "verificationLevel",
    "version",
)
SINGLE_WRITER: Final = "orchestrator"
MODES: Final = {"direct", "assisted", "planned", "orchestrated", "long-horizon"}
RISKS: Final = {"low", "standard", "material", "high"}
VERIFICATION_LEVELS: Final = {"targeted", "standard", "independent", "live-surface"}
CAPABILITY_CLASSES: Final = {
    "architecture-context",
    "documentation",
    "execution",
    "outcome-verification",
    "semantic-navigation",
    "structural-search",
    "task-state",
    "text-search",
}
RESPONSIBILITIES: Final = {
    "continuity",
    "debugging",
    "exploration",
    "implementation",
    "planning",
    "quality-review",
    "release-review",
    "security-review",
    "verification",
}
STAGES: Final = {"continue", "debug", "implement", "plan", "review", "understand", "verify"}
APPROVAL_CLASSES: Final = {
    "account-marketplace-or-publish-mutation",
    "browser-or-desktop-control",
    "credentials-auth-or-paid-service",
    "host-mcp-settings-mutation",
    "install-or-download",
    "persistent-capability",
    "remote-data-egress",
}
BLOCKER_FIELDS: Final = {
    "attemptedApproaches",
    "currentEvidence",
    "nextRequiredDecision",
    "reproducedFailure",
    "unresolvedDecision",
}
APPROVAL_FIELDS: Final = {"requiredClasses", "status"}
REVISION_FIELDS: Final = {"digest", "status"}
SUBSTITUTION_FIELDS: Final = {
    "allowedSubstitutionClasses",
    "evidenceDowngrade",
    "explanation",
    "requiredClass",
}
TRANSITION_FIELDS: Final = {"fromMode", "sequence", "stageAdded", "toMode", "trigger"}
EVIDENCE_DOWNGRADES: Final = {"additional-verification-required", "none", "reduced-confidence"}
ESCALATION_TRIGGERS: Final = {
    "broader-scope-revealed",
    "capability-unavailable",
    "new-risk-finding",
    "user-goal-changed",
    "verification-failure",
}
SHA256_PATTERN: Final = re.compile(r"^sha256:[0-9a-f]{64}$")
DECISION_ID_PATTERN: Final = re.compile(r"^[a-z0-9-]+$")
NONPORTABLE_TEXT_PATTERN: Final = re.compile(
    r"runtimeResolution|host-native|package-lsp|package-cli|package-loop-store|"
    r"lsp-bridge|/Users/|\\Users\\|\.worktrees/|\.trae/|\.lazytrae/|"
    r"(^|\s)(src|lib|packages|tests?)/|provider[=:]|host[=:]"
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _is_digest(value: object) -> bool:
    return isinstance(value, str) and SHA256_PATTERN.fullmatch(value) is not None


def _has_exact_fields(value: object, fields: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == fields


def _is_portable_text(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and NONPORTABLE_TEXT_PATTERN.search(value) is None
    )


def _valid_enum_list(value: object, allowed: set[str], nonempty: bool = True) -> bool:
    return (
        isinstance(value, list)
        and (bool(value) or not nonempty)
        and all(isinstance(item, str) and item in allowed for item in value)
        and len(value) == len(set(value))
    )


def _valid_text_list(value: object, nonempty: bool = True) -> bool:
    return (
        isinstance(value, list)
        and (bool(value) or not nonempty)
        and all(_is_portable_text(item) for item in value)
    )


def _valid_revision(value: object) -> bool:
    if not _has_exact_fields(value, REVISION_FIELDS):
        return False
    status = value.get("status")
    digest = value.get("digest")
    return (status == "available" and _is_digest(digest)) or (
        status == "unavailable" and digest is None
    )


def _valid_approval(value: object) -> bool:
    if not _has_exact_fields(value, APPROVAL_FIELDS):
        return False
    classes = value.get("requiredClasses")
    status = value.get("status")
    if not _valid_enum_list(classes, APPROVAL_CLASSES, False) or status not in {
        "denied",
        "granted",
        "not-required",
        "pending",
    }:
        return False
    return bool(classes) if status != "not-required" else not classes


def _valid_substitutions(value: list) -> bool:
    for substitution in value:
        if not _has_exact_fields(substitution, SUBSTITUTION_FIELDS):
            return False
        allowed = substitution.get("allowedSubstitutionClasses")
        if not _valid_enum_list(allowed, CAPABILITY_CLASSES):
            return False
        if substitution.get("evidenceDowngrade") not in EVIDENCE_DOWNGRADES:
            return False
        if not _is_portable_text(substitution.get("explanation")):
            return False
        if substitution.get("requiredClass") not in CAPABILITY_CLASSES:
            return False
    return True


def _valid_history(value: list) -> bool:
    for index, transition in enumerate(value, start=1):
        if not _has_exact_fields(transition, TRANSITION_FIELDS):
            return False
        if type(transition.get("sequence")) is not int or transition["sequence"] != index:
            return False
        if transition.get("fromMode") not in MODES or transition.get("toMode") not in MODES:
            return False
        if transition.get("stageAdded") is not None and transition["stageAdded"] not in STAGES:
            return False
        if transition.get("trigger") not in ESCALATION_TRIGGERS:
            return False
    return True


def _valid_blocker(value: object) -> bool:
    if value is None:
        return True
    if not _has_exact_fields(value, BLOCKER_FIELDS):
        return False
    if not _valid_text_list(value.get("attemptedApproaches")):
        return False
    return all(
        _is_portable_text(value.get(field))
        for field in BLOCKER_FIELDS - {"attemptedApproaches"}
    )


def validate_adaptive_snapshot(snapshot: object) -> bool:
    if not isinstance(snapshot, dict):
        return False
    if set(snapshot) != set(SNAPSHOT_REQUIRED_FIELDS):
        return False
    if type(snapshot.get("version")) is not int or snapshot["version"] != 1:
        return False
    if snapshot.get("mode") not in MODES:
        return False
    if snapshot.get("risk") not in RISKS:
        return False
    if snapshot.get("verificationLevel") not in VERIFICATION_LEVELS:
        return False
    if not _valid_enum_list(snapshot.get("capabilityClasses"), CAPABILITY_CLASSES):
        return False
    if not _valid_enum_list(snapshot.get("responsibilities"), RESPONSIBILITIES):
        return False
    if not _valid_enum_list(snapshot.get("stages"), STAGES):
        return False
    if not _valid_text_list(snapshot.get("reasons")):
        return False
    escalation_count = snapshot.get("escalationCount")
    if type(escalation_count) is not int or not 0 <= escalation_count <= 2:
        return False
    if not isinstance(snapshot.get("escalationHistory"), list):
        return False
    if len(snapshot["escalationHistory"]) != escalation_count:
        return False
    if not _valid_history(snapshot["escalationHistory"]):
        return False
    if not _valid_approval(snapshot.get("approval")):
        return False
    if not _valid_revision(snapshot.get("revisionFingerprint")):
        return False
    if not isinstance(snapshot.get("capabilitySubstitutions"), list):
        return False
    if not _valid_substitutions(snapshot["capabilitySubstitutions"]):
        return False
    decision_id = snapshot.get("decisionId")
    if not isinstance(decision_id, str) or DECISION_ID_PATTERN.fullmatch(decision_id) is None:
        return False
    if snapshot.get("currentStage") not in snapshot["stages"]:
        return False
    if not _is_portable_text(snapshot.get("nextAction")):
        return False
    if not _valid_blocker(snapshot.get("blocker")):
        return False
    return all(
        _is_digest(snapshot.get(field))
        for field in ("hostFingerprint", "requestDigest", "scopeFingerprint")
    )


def read_adaptive_snapshot(run_state: dict) -> dict | None:
    block = run_state.get("adaptive") if isinstance(run_state, dict) else None
    return block if isinstance(block, dict) else None


def write_adaptive_snapshot(run_state: dict, snapshot: dict) -> None:
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    if not validate_adaptive_snapshot(snapshot):
        raise ValueError("invalid adaptive snapshot")
    run_state["adaptive"] = json.loads(json.dumps(snapshot))
    run_state["updated_at"] = _iso_now()


def clear_adaptive_snapshot(run_state: dict) -> None:
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    run_state["adaptive"] = None
    run_state["updated_at"] = _iso_now()


def write_state_file_atomic(state_path: str, run_state: dict) -> None:
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    target = Path(state_path)
    if target.is_symlink() or target.parent.is_symlink() or not target.parent.is_dir():
        raise OSError("unsafe state path")
    descriptor, temporary = tempfile.mkstemp(
        prefix=".state.json.",
        suffix=".tmp",
        dir=str(target.parent),
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(run_state, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except (OSError, TypeError, ValueError):
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def load_state_file(state_path: str) -> dict:
    target = Path(state_path)
    if target.is_symlink() or not target.is_file():
        raise OSError("unsafe state path")
    with target.open(encoding="utf-8") as handle:
        state = json.load(handle)
    if not isinstance(state, dict):
        raise ValueError("state file must contain an object")
    return state
