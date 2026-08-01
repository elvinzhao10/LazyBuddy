from __future__ import annotations

from typing import Final

from lazybuddy_adaptive_snapshot import validate_adaptive_snapshot


ALL_STAGES: Final = {
    "understand",
    "plan",
    "implement",
    "debug",
    "verify",
    "review",
    "continue",
}
ALL_RESPONSIBILITIES: Final = {
    "exploration",
    "planning",
    "implementation",
    "debugging",
    "verification",
    "quality-review",
    "security-review",
    "release-review",
    "continuity",
}
ALL_CAPABILITIES: Final = {
    "text-search",
    "structural-search",
    "semantic-navigation",
    "architecture-context",
    "documentation",
    "execution",
    "task-state",
    "outcome-verification",
}


def adaptive_explanation_fields(snapshot: dict) -> dict:
    if not validate_adaptive_snapshot(snapshot):
        return {
            "reclassificationRequired": True,
            "status": "invalid-state",
        }
    stages = list(snapshot.get("stages", []))
    capabilities = list(snapshot.get("capabilityClasses", []))
    responsibilities = list(snapshot.get("responsibilities", []))
    substitutions = list(snapshot.get("capabilitySubstitutions", []))
    return {
        "approval": dict(snapshot.get("approval", {})),
        "capabilityClasses": capabilities,
        "evidenceImpact": {
            "substitutions": substitutions,
            "verificationLevel": snapshot.get("verificationLevel", ""),
        },
        "mode": snapshot.get("mode", ""),
        "notSelected": {
            "capabilityClasses": sorted(ALL_CAPABILITIES - set(capabilities)),
            "responsibilities": sorted(
                ALL_RESPONSIBILITIES - set(responsibilities)
            ),
            "stages": sorted(ALL_STAGES - set(stages)),
        },
        "responsibilities": responsibilities,
        "stages": stages,
    }


def _append_items(lines: list[str], heading: str, items: list[object]) -> None:
    lines.append(heading)
    if not items:
        lines.append("- none")
        return
    lines.extend(f"- {item}" for item in items)


def _substitution_lines(substitutions: list[dict]) -> list[str]:
    lines: list[str] = []
    for substitution in substitutions:
        required = substitution.get("requiredClass", "unknown")
        allowed = substitution.get("allowedSubstitutionClasses", [])
        downgrade = substitution.get("evidenceDowngrade", "unspecified")
        lines.append(
            f"{required} -> {', '.join(allowed)}; evidence: {downgrade}"
        )
    return lines


def format_adaptive_explanation(run_state: dict) -> str | None:
    snapshot = run_state.get("adaptive") if isinstance(run_state, dict) else None
    if not isinstance(snapshot, dict):
        return None
    fields = adaptive_explanation_fields(snapshot)
    if fields.get("status") == "invalid-state":
        return "Adaptive state: invalid-state\nReclassification required: yes"
    approval = fields["approval"]
    required = approval.get("requiredClasses", [])
    evidence = fields["evidenceImpact"]
    not_selected = fields["notSelected"]
    lines = [f"Mode: {str(fields['mode']).replace('-', ' ').title()}"]
    _append_items(lines, "Selected stages:", fields["stages"])
    _append_items(lines, "Responsibilities:", fields["responsibilities"])
    _append_items(lines, "Capabilities:", fields["capabilityClasses"])
    not_selected_lines = [
        f"capabilities: {', '.join(not_selected['capabilityClasses']) or 'none'}",
        f"responsibilities: {', '.join(not_selected['responsibilities']) or 'none'}",
        f"stages: {', '.join(not_selected['stages']) or 'none'}",
    ]
    _append_items(lines, "Not selected:", not_selected_lines)
    _append_items(lines, "Approval required:", list(required))
    lines.append(f"Verification: {evidence['verificationLevel']}")
    substitutions = _substitution_lines(evidence["substitutions"])
    if substitutions:
        _append_items(lines, "Evidence impact:", substitutions)
    lines.append(f"Escalation count: {snapshot.get('escalationCount', 0)}")
    lines.append("Single-writer: orchestrator")
    lines.append(f"Next action: {snapshot.get('nextAction', '')}")
    _append_items(lines, "Reasons:", list(snapshot.get("reasons", [])))
    blocker = snapshot.get("blocker")
    if isinstance(blocker, dict):
        lines.append("Blocker: blocked-state record present")
    elif isinstance(blocker, str) and blocker:
        lines.append(f"Blocker: {blocker}")
    return "\n".join(lines)
