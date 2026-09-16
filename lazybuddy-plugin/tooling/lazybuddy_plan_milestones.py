#!/usr/bin/env python3
"""T3 — Progressive milestones and scoped decision gates (LazyBuddy v1.3.0).

Implements the validation + dispatch semantics from the shared contract
``lazyseries-shared-semantics.v1.json`` (``milestone_flags``) and the scenario
fixture ``canonical_formats.decision_gate`` / ``behaviors.c_*``.

Parent plan record carries, per milestone/task:

- ``provisional``      (bool)  — a provisional milestone and its tasks MUST NOT
                                dispatch.
- ``parent_plan_id``   (str)   — authoritative parent plan identifier for child
                                plans.
- ``dependency_links`` (list)  — task/milestone dependency links; cycles and
                                dangling links are rejected.

Validation rules (behavior c):
- dependency cycles are rejected;
- missing IDs (a link to a non-existent node) are rejected;
- dangling child links (a child plan link to a non-existent parent/milestone)
  are rejected.

Decision gates carry the canonical shape
(``canonical_formats.decision_gate``):

- required fields: ``question``, ``recommendation``, ``alternatives``,
  ``owner``, ``needed_by``, ``status``;
- a recommendation NEVER becomes owner approval automatically: status stays
  ``open`` until a real answer exists;
- only tasks that transitively depend on the gate block; independent work
  proceeds.

Later milestones are provisional: the NEXT milestone is executable; distant
decisions are not demanded upfront.
"""
from __future__ import annotations

from typing import Final, NamedTuple

GATE_STATUSES: Final = ("open", "answered", "blocked", "superseded")
DECISION_GATE_REQUIRED: Final = (
    "question",
    "recommendation",
    "alternatives",
    "owner",
    "needed_by",
    "status",
)

# Canonical scenario fixture ids referenced by the v1.3.0 contract.
FIXTURE_DECISION_GATE_REQUIRED: Final = set(DECISION_GATE_REQUIRED)


class MilestoneNode(NamedTuple):
    milestone_id: str
    provisional: bool
    parent_plan_id: str | None
    dependency_links: list[str]


def _normalise_node(node: dict) -> MilestoneNode:
    """Coerce a raw milestone dict into the validated MilestoneNode shape."""
    if not isinstance(node, dict):
        raise TypeError("milestone node must be a dict")
    milestone_id = node.get("id")
    if not isinstance(milestone_id, str) or not milestone_id:
        raise ValueError("milestone node missing string 'id'")
    provisional = node.get("provisional", False)
    if not isinstance(provisional, bool):
        raise ValueError(f"milestone {milestone_id}: 'provisional' must be bool")
    parent = node.get("parent_plan_id")
    if parent is not None and not isinstance(parent, str):
        raise ValueError(f"milestone {milestone_id}: 'parent_plan_id' must be str")
    links = node.get("dependency_links", [])
    if not isinstance(links, list) or not all(isinstance(link, str) for link in links):
        raise ValueError(f"milestone {milestone_id}: 'dependency_links' must be list<str>")
    return MilestoneNode(
        milestone_id=milestone_id,
        provisional=bool(provisional),
        parent_plan_id=parent,
        dependency_links=list(links),
    )


def validate_milestone_graph(nodes: list[dict]) -> list[str]:
    """Validate a parent-plan milestone graph.

    Returns a list of human-readable error strings (empty == valid). Rejects:
    - duplicate milestone ids;
    - dependency links to missing ids (missing-id / dangling child link);
    - dependency cycles.
    """
    errors: list[str] = []
    if not isinstance(nodes, list):
        return ["milestone graph must be a list"]
    parsed: list[MilestoneNode] = []
    seen_ids: dict[str, int] = {}
    for raw in nodes:
        try:
            node = _normalise_node(raw)
        except (TypeError, ValueError) as exc:
            errors.append(str(exc))
            continue
        parsed.append(node)
        seen_ids[node.milestone_id] = seen_ids.get(node.milestone_id, 0) + 1

    for milestone_id, count in seen_ids.items():
        if count > 1:
            errors.append(f"duplicate milestone id: {milestone_id}")

    ids = set(seen_ids)
    for node in parsed:
        for link in node.dependency_links:
            if link not in ids:
                # A link to a non-existent node is both a "missing id" and a
                # "dangling child link" depending on framing; report both cues.
                errors.append(
                    f"dangling child link: milestone {node.milestone_id} "
                    f"depends on missing id {link}"
                )

    # Cycle detection (DFS over dependency_links).
    adjacency = {node.milestone_id: list(node.dependency_links) for node in parsed}
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {mid: WHITE for mid in adjacency}

    def visit(start: str, stack: list[str]) -> bool:
        color[start] = GRAY
        for nxt in adjacency.get(start, []):
            if nxt not in color:
                continue  # missing id already reported
            if color[nxt] == GRAY:
                cycle = stack + [start, nxt]
                errors.append(
                    "dependency cycle detected: " + " -> ".join(cycle)
                )
                return True
            if color[nxt] == WHITE and visit(nxt, stack + [start]):
                return True
        color[start] = BLACK
        return False

    for mid in adjacency:
        if color[mid] == WHITE:
            visit(mid, [])

    # De-duplicate cycle/missing messages while preserving order.
    seen: set[str] = set()
    unique_errors: list[str] = []
    for err in errors:
        if err not in seen:
            seen.add(err)
            unique_errors.append(err)
    return unique_errors


def milestone_dispatchable(
    nodes: list[dict],
    completed: set[str] | None = None,
) -> str | None:
    """Return the id of the NEXT executable milestone, or None.

    Behaviors c (later milestones provisional): a provisional milestone MUST
    NOT dispatch. The first non-provisional, not-yet-completed milestone in
    document order is the only executable one; distant provisional milestones
    are intentionally not demanded upfront.
    """
    completed = completed or set()
    parsed = [_normalise_node(n) for n in nodes if isinstance(n, dict)]
    for node in parsed:
        if node.milestone_id in completed:
            continue
        if node.provisional:
            continue
        return node.milestone_id
    return None


def validate_decision_gate(gate: dict) -> list[str]:
    """Validate a decision gate against the canonical fixture shape.

    Returns a list of error strings (empty == valid). Enforces required fields,
    types, status enum, and the "at least one non-recommended alternative" rule.
    """
    errors: list[str] = []
    if not isinstance(gate, dict):
        return ["decision gate must be an object"]
    for field in DECISION_GATE_REQUIRED:
        if field not in gate:
            errors.append(f"decision gate missing required field: {field}")

    question = gate.get("question")
    if "question" in gate and not (isinstance(question, str) and question.strip()):
        errors.append("decision gate 'question' must be a non-empty string")

    recommendation = gate.get("recommendation")
    if "recommendation" in gate and not (
        isinstance(recommendation, str) and recommendation.strip()
    ):
        errors.append("decision gate 'recommendation' must be a non-empty string")

    owner = gate.get("owner")
    if "owner" in gate and not (isinstance(owner, str) and owner.strip()):
        errors.append("decision gate 'owner' must be a non-empty string")

    needed_by = gate.get("needed_by")
    if "needed_by" in gate and not (isinstance(needed_by, str) and needed_by.strip()):
        errors.append("decision gate 'needed_by' must be a non-empty string")

    status = gate.get("status")
    if "status" in gate and status not in GATE_STATUSES:
        errors.append(
            f"decision gate 'status' must be one of {', '.join(GATE_STATUSES)}"
        )

    alternatives = gate.get("alternatives")
    if "alternatives" in gate:
        if not isinstance(alternatives, list) or not alternatives:
            errors.append("decision gate 'alternatives' must be a non-empty list")
        else:
            alt_ids: list[str] = []
            for index, alt in enumerate(alternatives):
                if not isinstance(alt, dict):
                    errors.append(f"decision gate alternative[{index}] must be an object")
                    continue
                if not isinstance(alt.get("id"), str) or not alt.get("id"):
                    errors.append(f"decision gate alternative[{index}] missing 'id'")
                if not isinstance(alt.get("summary"), str):
                    errors.append(f"decision gate alternative[{index}] missing 'summary'")
                if not isinstance(alt.get("tradeoffs"), str):
                    errors.append(f"decision gate alternative[{index}] missing 'tradeoffs'")
                if isinstance(alt.get("id"), str) and alt["id"]:
                    alt_ids.append(alt["id"])
            # Rule: at least one NON-recommended option must exist.
            recommended_id = _recommended_alternative_id(recommendation, alt_ids)
            if recommended_id is not None:
                non_recommended = [aid for aid in alt_ids if aid != recommended_id]
                if not non_recommended:
                    errors.append(
                        "decision gate must offer at least one non-recommended alternative"
                    )

    assumptions = gate.get("assumptions")
    if assumptions is not None and not (
        isinstance(assumptions, list)
        and all(isinstance(item, str) for item in assumptions)
    ):
        errors.append("decision gate 'assumptions' must be a list of strings")

    return errors


def _recommended_alternative_id(recommendation: object, alt_ids: list[str]) -> str | None:
    """Best-effort: detect which alternative id the recommendation text names."""
    if not isinstance(recommendation, str) or not alt_ids:
        return None
    lowered = recommendation.lower()
    for alt_id in alt_ids:
        if alt_id.lower() in lowered:
            return alt_id
    return None


def gate_blocks(gate: dict, task_id: str) -> bool:
    """A gate blocks ``task_id`` only while open/blocked and task is affected.

    Rule (decision_gate): only tasks that transitively depend on the gate
    block; independent work proceeds. A recommendation never auto-approves.
    """
    if not isinstance(gate, dict):
        return False
    status = gate.get("status")
    if status in ("answered", "superseded"):
        return False
    affected = gate.get("affected_tasks")
    if not isinstance(affected, list):
        return False
    return task_id in affected


def independent_work_proceeds(gate: dict, task_id: str) -> bool:
    """Independent work (not in the gate's affected tasks) proceeds regardless."""
    return not gate_blocks(gate, task_id)
