"""Adaptive explanation formatter for v1.0.3 LazyBuddy (W3.5).

Reads the ``adaptive`` snapshot block from a run state and produces a terse,
telegraphic, multi-line explanation per plan Section 13. Mirrors the LazyTrae
W2.4 ``adaptive-explanation.js`` shape. No external dependencies.
"""
from __future__ import annotations

from typing import Optional

ALL_STAGES = ("understand", "plan", "implement", "debug", "verify", "review", "continue")
ALL_CAPS = (
    "text-search", "structural-search", "semantic-navigation",
    "architecture-context", "documentation", "execution",
    "task-state", "outcome-verification",
)
DEFAULT_RUNTIME = "host-native"
BLOCKED_LABEL = "blocked-state record present"


def _title(word: str) -> str:
    return str(word or "").replace("-", " ").title()


def _bullets(items) -> str:
    joiner = chr(10)
    return joiner.join(f"- {item}" for item in items) if items else "- none"


def format_adaptive_explanation(run_state: dict) -> Optional[str]:
    """Return the Section 13 explanation string, or None if no adaptive block is present."""
    if not isinstance(run_state, dict):
        return None
    snap = run_state.get("adaptive")
    if not isinstance(snap, dict):
        return None
    mode = snap.get("mode", "")
    stages = snap.get("stages", []) or []
    responsibilities = snap.get("responsibilities", []) or []
    caps = snap.get("capabilityClasses", []) or []
    runtime = snap.get("runtimeResolution", {}) or {}
    reasons = snap.get("reasons", []) or []
    escalation = snap.get("escalationCount", 0)
    blocker = snap.get("blocker")
    next_action = snap.get("nextAction", "")
    not_selected_caps = sorted(c for c in ALL_CAPS if c not in caps)
    not_selected_stages = sorted(s for s in ALL_STAGES if s not in stages)
    cap_lines = [f"- {c} ({runtime.get(c, DEFAULT_RUNTIME)})" for c in caps] or ["- none"]
    not_sel_lines = [f"- {c}: not required for current scope" for c in not_selected_caps] or ["- none"]
    if not_selected_stages:
        not_sel_lines += [f"- {s} stage: skipped" for s in not_selected_stages]
    approval = "approval required (orchestrated mode)" if mode == "orchestrated" else "none"
    lines = [
        f"Mode: {_title(mode)}",
        "Selected stages:",
        _bullets(stages),
        "Responsibilities:",
        _bullets(responsibilities),
        "Capabilities:",
        *cap_lines,
        "Not selected:",
        *not_sel_lines,
        f"Approval required: {approval}",
        f"Escalation count: {escalation}",
        "Single-writer: orchestrator",
    ]
    if blocker:
        blocker_label = blocker if isinstance(blocker, str) else BLOCKED_LABEL
        lines.append(f"Blocker: {blocker_label}")
    if next_action:
        lines.append(f"Next action: {next_action}")
    if reasons:
        lines.append("Reasons:")
        lines += [f"- {r}" for r in reasons]
    return chr(10).join(lines)
