#!/usr/bin/env python3
"""T4 — Reconcile human plan edits with execution authority (LazyBuddy v1.3.0).

Implements the reconciliation semantics from the shared contract
``lazyseries-shared-semantics.v1.json`` and the scenario fixture
``canonical_formats.reconciliation_semantics``:

- Re-read boundaries: before dispatch, after results, before completion,
  on resume. This module is the pure classification core those boundaries call.
- Cosmetic changes (whitespace, wording that does not change meaning, section
  reordering, a human check/uncheck assertion) preserve all valid evidence.
- Semantic changes (acceptance criteria, dependencies, verification commands,
  decisions, added/removed tasks) invalidate ONLY the affected task and its
  transitive dependents.
- A human checked box is a completion assertion, never a verified result.
  A human uncheck of a completed task reopens it for reconciliation.
- Stale results (dispatched under an older plan revision) can never overwrite
  a newer plan's state.
"""
from __future__ import annotations

import re
from typing import Final

# Task identity: canonical "T1:"/"T1." and legacy "A1." prefixes (same grammar
# as scripts/state/sync-plan-state.sh).
TASK_TITLE_RE: Final = re.compile(r"^([A-Za-z]*\d+)\s*[:.]\s*(.+)$")
CHECKBOX_RE: Final = re.compile(r"^-\s+\[([ xX])\]\s+(.+)$")

# Lines under a task that carry authoritative scope meaning. Changes to these
# are semantic (invalidate authority); changes elsewhere are cosmetic.
SCOPE_KEYS: Final = ("acceptance", "qa", "verify", "commit", "depends_on", "decision")

COSMETIC = "cosmetic"
SEMANTIC = "semantic"
UNCHANGED = "unchanged"


def parse_tasks(text: str) -> dict[str, dict]:
    """Parse a plan into {task_id: {checked, title, scope_lines}}} records.

    Mirrors the checkbox grammar of sync-plan-state.sh (## TODOs / ## Todos /
    ## Final Verification Wave sections; fenced code blocks skipped).
    """
    tasks: dict[str, dict] = {}
    fence = None
    section = None
    in_task_section = False
    current_id = None
    for line in text.splitlines():
        s = line.strip()
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and s == token:
                fence = None
            continue
        if fence is not None:
            continue
        if s.startswith("## "):
            section = s[3:].strip()
            in_task_section = section in {"TODOs", "Todos", "Final Verification Wave"}
            current_id = None
            continue
        if not in_task_section:
            continue
        m = CHECKBOX_RE.match(line.rstrip())
        if m:
            checked = m.group(1).lower() == "x"
            title = m.group(2).strip()
            tid = TASK_TITLE_RE.match(title)
            current_id = tid.group(1) if tid else None
            if current_id:
                tasks[current_id] = {
                    "checked": checked,
                    "title": title,
                    "scope_lines": [],
                    "section": section,
                }
            continue
        # sub-lines under the current task
        if current_id and s.startswith("- "):
            key = s[2:].split(":", 1)[0].strip().lower()
            if key in SCOPE_KEYS:
                tasks[current_id]["scope_lines"].append(s)
        elif current_id and s and not s.startswith("#"):
            tasks[current_id]["scope_lines"].append(s)
    return tasks


def _dependents_closure(task_id: str, deps: dict[str, list[str]]) -> set[str]:
    """Transitive dependents of task_id given a {task: [depends_on]} map."""
    result: set[str] = set()
    frontier = [task_id]
    while frontier:
        current = frontier.pop()
        for candidate, links in deps.items():
            if candidate in result:
                continue
            if current in links:
                result.add(candidate)
                frontier.append(candidate)
    return result


def classify_plan_edits(old_text: str, new_text: str) -> dict:
    """Classify the delta between two plan revisions.

    Returns:
      {
        classification: "unchanged" | "cosmetic" | "semantic",
        invalidations:  [{task, reason}]  — affected + transitive dependents,
        reopen:         [task ids]        — human-unchecked completed tasks,
        added:          [task ids],
        removed:        [task ids],
        summary:        [human readable change lines],
      }
    """
    old_tasks = parse_tasks(old_text)
    new_tasks = parse_tasks(new_text)

    added = [tid for tid in new_tasks if tid not in old_tasks]
    removed = [tid for tid in old_tasks if tid not in new_tasks]

    deps_new = _extract_deps(new_tasks)

    invalidations: list[dict] = []
    reopen: list[str] = []
    summary: list[str] = []
    semantic = False

    for tid in removed:
        semantic = True
        invalidations.append({"task": tid, "reason": "task removed; running work stops receiving dispatch and results cannot be accepted as current"})
        summary.append(f"removed task {tid}")
    for tid in added:
        semantic = True
        summary.append(f"added task {tid} (requires eligibility checks before dispatch)")
        # added tasks need eligibility, they do not invalidate existing authority

    for tid in sorted(set(old_tasks) & set(new_tasks)):
        old, new = old_tasks[tid], new_tasks[tid]
        # Human check/uncheck assertions are COSMETIC for evidence purposes but
        # an uncheck of a completed task REOPENS it (assertion, not verified result).
        if old["checked"] and not new["checked"]:
            reopen.append(tid)
            summary.append(f"human unchecked {tid}: reopened for reconciliation (a check is an assertion, never a verified result)")
        if not old["checked"] and new["checked"]:
            summary.append(f"human checked {tid}: assertion only — never counts as a verified result")
        # Title wording that keeps the same scope meaning is cosmetic; a title
        # change that alters the requested deliverable is semantic.
        if _strip_flags(old["title"]) != _strip_flags(new["title"]):
            semantic = True
            reason = "task title/deliverable changed"
            invalidations.append({"task": tid, "reason": reason})
            summary.append(f"{tid}: {reason}")
            continue
        old_scope = sorted(old["scope_lines"])
        new_scope = sorted(new["scope_lines"])
        if old_scope != new_scope:
            semantic = True
            changed_keys = sorted(
                {l.split(":", 1)[0].strip().lower() for l in old_scope + new_scope
                 if l.split(":", 1)[0].strip().lower() in SCOPE_KEYS}
            )
            reason = "scope changed (%s)" % ", ".join(changed_keys) if changed_keys else "scope changed"
            invalidations.append({"task": tid, "reason": reason})
            summary.append(f"{tid}: {reason}")

    # Expand invalidations to transitive dependents (scoped invalidation only).
    if invalidations:
        direct = {i["task"] for i in invalidations}
        closure: set[str] = set()
        for tid in direct:
            closure |= _dependents_closure(tid, deps_new)
        for tid in sorted(closure - direct):
            invalidations.append({"task": tid, "reason": "transitive dependent of a scope-changed task"})
            summary.append(f"{tid}: invalidated as transitive dependent")

    classification = UNCHANGED
    if semantic or invalidations:
        classification = SEMANTIC
    elif old_text.strip() != new_text.strip():
        classification = COSMETIC
        summary.append("cosmetic edit (whitespace/wording/reorder/check assertion) — evidence preserved")

    return {
        "classification": classification,
        "invalidations": invalidations,
        "reopen": sorted(reopen),
        "added": sorted(added),
        "removed": sorted(removed),
        "summary": summary,
    }


def _strip_flags(title: str) -> str:
    """Drop milestone-flag parens so flag-only tweaks are not semantic."""
    return re.sub(r"\((?:provisional|depends_on|parent_plan_id)\s*:.*?\)", "", title).strip()


def _extract_deps(tasks: dict[str, dict]) -> dict[str, list[str]]:
    """Extract depends_on links from task titles (flag syntax) or scope lines."""
    deps: dict[str, list[str]] = {}
    for tid, record in tasks.items():
        links: list[str] = []
        m = re.search(r"depends_on\s*:\s*([^\),]+)", record["title"])
        if m:
            links += [t.strip().strip("[]") for t in m.group(1).split(",") if t.strip().strip("[]")]
        for line in record["scope_lines"]:
            lm = re.match(r"-?\s*depends_on\s*:\s*(.+)", line, re.I)
            if lm:
                links += [t.strip().strip("[]") for t in lm.group(1).split(",") if t.strip().strip("[]")]
        deps[tid] = links
    return deps


def accept_result(result: dict, current_plan_sha: str) -> tuple[bool, str]:
    """Stale-result guard: a result dispatched under an older plan revision
    can never update a newer plan's state.

    result: {"plan_sha256": <sha the result was dispatched under>, ...}
    """
    result_sha = result.get("plan_sha256")
    if result_sha is None:
        return False, "result carries no plan_sha256; refusing to apply"
    if result_sha != current_plan_sha:
        return False, "stale result: dispatched under plan %s but current approved revision is %s" % (
            str(result_sha)[:12], str(current_plan_sha)[:12])
    return True, "ok"
