#!/usr/bin/env python3
"""T4 tests — reconcile human plan edits with execution authority (v1.3.0).

One table-driven suite covering the reconciliation scenarios from the plan's
T4 acceptance: cosmetic preservation, scoped semantic invalidation,
add/remove, check/uncheck semantics, restart dedup, stale-result rejection.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_plan_reconcile import (  # noqa: E402
    accept_result,
    classify_plan_edits,
)

BASE = """# Plan

## TODOs

- [ ] T1: Scaffold (depends_on: [])
  - Acceptance: files exist
  - QA: run tests
- [ ] T2: Billing (depends_on: T1)
  - Acceptance: billing works
  - QA: billing tests
- [ ] T3: Navigation (depends_on: [])
  - Acceptance: nav works
  - QA: nav tests
"""

BASE_CHECKED_T1 = BASE.replace("- [ ] T1:", "- [x] T1:")


def plan_with(t2_acceptance=None, t2_qa=None, checked=()):
    text = BASE
    if t2_acceptance:
        text = text.replace("  - Acceptance: billing works", f"  - Acceptance: {t2_acceptance}")
    if t2_qa:
        text = text.replace("  - QA: billing tests", f"  - QA: {t2_qa}")
    for tid in checked:
        text = text.replace(f"- [ ] {tid}:", f"- [x] {tid}:")
    return text


# (label, old, new, expect_class, expect_invalidated, expect_reopen)
ROWS = [
    ("whitespace-only-unchanged",
     BASE, BASE + "\n\n", "unchanged", [], []),
    ("human-check-assertion-is-cosmetic",
     BASE, plan_with(checked=("T1",)), "cosmetic", [], []),
    ("human-uncheck-reopens",
     BASE_CHECKED_T1, BASE, "cosmetic", [], ["T1"]),
    ("acceptance-change-is-semantic",
     BASE, plan_with(t2_acceptance="billing works differently"), "semantic", ["T2"], []),
    ("verification-command-change-is-semantic",
     BASE, plan_with(t2_qa="run billing and payment tests"), "semantic", ["T2"], []),
]


@pytest.mark.parametrize("label,old,new,expect_class,expect_invalidated,expect_reopen", ROWS,
                         ids=[r[0] for r in ROWS])
def test_reconciliation_rows(label, old, new, expect_class, expect_invalidated, expect_reopen):
    result = classify_plan_edits(old, new)
    assert result["classification"] == expect_class, f"{label}: {result}"
    invalidated = sorted(i["task"] for i in result["invalidations"])
    assert invalidated == sorted(expect_invalidated), f"{label}: {invalidated}"
    assert sorted(result["reopen"]) == sorted(expect_reopen), f"{label}: {result['reopen']}"


def test_scoped_invalidation_includes_transitive_dependents_only():
    """T3 (navigation) is independent; it must NOT be invalidated when T2 changes."""
    result = classify_plan_edits(BASE, plan_with(t2_acceptance="changed"))
    invalidated = {i["task"] for i in result["invalidations"]}
    assert "T2" in invalidated
    assert "T3" not in invalidated


def test_added_task_requires_eligibility():
    new = BASE + "- [ ] T4: Reporting (depends_on: T2)\n  - Acceptance: reports\n"
    result = classify_plan_edits(BASE, new)
    assert result["classification"] == "semantic"
    assert result["added"] == ["T4"]
    # adding a task does not invalidate existing authority
    assert all(i["task"] != "T1" for i in result["invalidations"])


def test_removed_task_stops_dispatch():
    result = classify_plan_edits(BASE, BASE.replace(
        "- [ ] T2: Billing (depends_on: T1)\n  - Acceptance: billing works\n  - QA: billing tests\n", ""))
    assert result["removed"] == ["T2"]
    invalidated = {i["task"] for i in result["invalidations"]}
    assert "T2" in invalidated


def test_reorder_is_cosmetic():
    """Section reordering preserves all evidence."""
    lines = BASE.strip().splitlines()
    # swap T2 and T3 blocks
    t2_start = next(i for i, l in enumerate(lines) if "T2:" in l)
    t3_start = next(i for i, l in enumerate(lines) if "T3:" in l)
    t2_block = lines[t2_start:t2_start + 3]
    t3_block = lines[t3_start:t3_start + 3]
    reordered = (lines[:t2_start] + t3_block + t2_block + lines[t3_start + 3:])
    result = classify_plan_edits(BASE, "\n".join(reordered) + "\n")
    assert result["classification"] == "cosmetic", result["summary"]
    assert result["invalidations"] == []


def test_idempotent_restart_no_duplicates():
    """Classifying the same revision twice yields identical results (no dup tasks)."""
    r1 = classify_plan_edits(BASE, plan_with(t2_qa="changed"))
    r2 = classify_plan_edits(BASE, plan_with(t2_qa="changed"))
    assert r1 == r2


def test_stale_result_rejected():
    ok, _ = accept_result({"plan_sha256": "aaa"}, "aaa")
    assert ok is True
    ok, reason = accept_result({"plan_sha256": "aaa"}, "bbb")
    assert ok is False
    assert "stale" in reason.lower()
    ok, reason = accept_result({}, "bbb")
    assert ok is False
    assert "no plan_sha256" in reason
