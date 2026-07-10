---
name: lazy-remove-ai-slops
description: "Behavior-preserving cleanup of AI-generated code smells. Locks behavior with regression tests first, then runs targeted cleanup passes."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# remove-ai-slops

> **LazyCodex source:** [dev/reference/lazycodex/plugins/omo/skills/remove-ai-slops/SKILL.md](../../../dev/reference/lazycodex/plugins/omo/skills/remove-ai-slops/SKILL.md)

## Purpose

Clean AI-generated slop from a bounded set of changed files while strictly preserving behavior. The core safety invariant: **behavior is locked by green tests before a single line is removed**. A checklist alone is not safety; a passing regression test is.

## Trigger Conditions

- User says "remove slop", "clean AI code", "deslop", "clean up AI-generated code"
- User says "remove AI slop", "strip slop", "ai-slop cleanup"
- A branch contains AI-authored patterns needing systematic cleanup
- The programming skill's post-write loop detects code smells requiring cleanup

## Required Context

- **Default scope**: branch diff vs `merge-base main` (collected via `git diff`)
- **Optional scope**: explicit file list passed by caller
- The project's test runner and CI pipeline
- Per-language toolchain (same as programming skill references)

## Tool Access

- Full access governed by the behavior-preserving invariant
- Subagents for parallel per-file cleanup via WorkBuddy Agent tool
- Read, Write, Edit, Bash (git, test runner, linter, type checker)

## Step-by-Step Procedure

### Phase 0: Plan with WorkBuddy TaskCreate

Create tasks for all phases below. Mark `in_progress` one at a time.

### Phase 1: Determine Scope

If file paths were passed as arguments, use them. Otherwise:
```bash
git diff $(git merge-base main HEAD)..HEAD --name-only
```
Filter out: deleted files, binary files, generated/vendored (`node_modules/`, `dist/`, `target/`, lockfiles).

### Phase 2: Lock Behavior with Regression Tests (non-negotiable)

For each in-scope source file:
1. Identify the public/observable behavior (exported functions, HTTP handlers, CLI commands, classes used elsewhere)
2. Check whether existing tests cover that behavior (use Grep + project test conventions)
3. **If behavior is uncovered or weakly covered, write the narrowest regression test that pins current behavior BEFORE editing the file**
4. Run the test suite. It must be **green** before any cleanup begins.

If you cannot establish a green baseline (test runner broken), STOP and report. Do not proceed on unverified ground.

### Phase 3: Cleanup Plan — The Deletion Ladder First

Before categorizing smells, run the 7-rung deletion ladder on each changed unit:
- **Delete entirely** — behavior is not needed (YAGNI, speculative, dead on arrival)
- **Reuse** — an existing helper/pattern in this repo already does it
- **Platform/stdlib/native/dependency** — the language stdlib, runtime, or installed dependency already does it
- **Simplify in place** — it must exist; make it smaller

Only code landing on "Simplify in place" proceeds to smell categories. Produce an explicit plan before spawning agents:

```
File: src/foo.py
  Ladder: 2 units simplify-in-place; 1 unit delete (native <input> replaces custom picker)
  Categories: dead code, excessive complexity, performance
  Order: dead code → complexity → performance
  Risk: medium (touches caching layer)
```

Order rule (safest → riskiest): comments → dead code → defensive → duplication → complexity → abstraction/boundary → performance → tests → oversized-modules.

### Phase 4: Categorized Parallel Cleanup (10 Categories)

Files processed by WorkBuddy Agent subagents, batched 5 at a time in parallel.

**Batching protocol:**
1. Slice in-scope files into chunks of up to 5 files
2. Launch all subagents for the current batch in a single turn with `run_in_background=true`
3. Wait for batch completion via TaskOutput polling
4. Launch next batch; repeat until all files processed

**The 10 categories (KEEP rules are critical):**

| # | Category | Slop (REMOVE) | Preserve (KEEP) |
|---|----------|---------------|-----------------|
| 1 | **Obvious comments** | Comments restating code, trivial docstrings, section dividers, commented-out code, vague TODOs | Comments explaining WHY (business logic, edge cases, workarounds), ticket links, regex/algo explanations, BDD markers (`# given`, `# when`, `# then`) |
| 2 | **Over-defensive code** | Null checks for guaranteed values, try/except around code that cannot raise, isinstance on statically typed params, backward-compat shims, broad `except Exception`/`except BaseException` | Validation at system boundaries (user input, external APIs), I/O error handling, nullable DB fields. Refactor: `except Exception` → catch specific exception. |
| 3 | **Excessive complexity** | Deep nesting (>3), nested ternaries, complex booleans (4+ predicates), god functions (>50 lines), `if/elif/else` for variant discrimination | Established complexity patterns in the codebase, performance-critical hot paths. Refactor: nested if → guard clauses; `if/elif` for variants → `match/case` + `assert_never`. |
| 4 | **Needless abstraction** | Pass-through wrappers, single-use helpers, speculative indirection, interfaces with one implementer, factory functions that just call a constructor | Abstractions providing a real seam (testability, multiple implementers, framework-required) |
| 5 | **Boundary violations** | Wrong-layer imports (UI importing DB driver), leaky responsibilities, hidden coupling, side effects in pure-named functions | Pragmatic short-circuits already established in the codebase |
| 6 | **Dead code** | Unused imports, unused private functions, unreachable branches, stale feature flags, debug leftovers (`console.log`, `print`, `dbg!`) | Code referenced via reflection/dynamic dispatch/string lookup; feature flag rollback paths |
| 7 | **Duplication** | Copy-pasted branches with trivial differences, redundant helpers in two places, repeated magic-number sequences | Incidental duplication (similar code serving different intents that could diverge) |
| 8 | **Performance equivalences** | O(n²)→O(n) when correctness preserved, repeated computation → hoist outside loop, string concat in loop → `join`, redundant DB/API calls → batch | Only apply when behavior equivalence is obvious. Do NOT change algorithms with subtle correctness implications. Skip if in doubt. |
| 9 | **Missing tests** | Behavior present in changed files not locked by any regression test | Fix is to ADD the narrowest test that pins the behavior — not to remove the code |
| 10 | **Oversized modules** | Any file exceeding **250 pure LOC** (non-blank, non-comment lines) | Genuinely self-contained single-responsibility scripts. Refactor: identify responsibilities, name new files after concepts (never `utils.py`/`helpers.py`), extract with explicit `__init__.py` re-exports, verify ≤250 LOC per file. |

**Key safety rule (Category 2 — Over-defensive code):** PROOF REQUIRED before removing any guard. The Phase 2 test suite must include an **adversarial** regression test (malformed or hostile input) that fails if the guard is removed. No adversarial test → the guard stays. Redundant defense to remove is a duplicate of a check already running *inside* the boundary.

### Phase 5: Verify with Quality Gates + Critical Review

| Gate | Tool | Pass condition |
|------|------|---------------|
| Regression tests | project's test runner | all green |
| Lint | project's linter | zero errors (warnings OK if pre-existing) |
| Typecheck | project's type checker | zero new errors on changed files |
| Unit/integration tests | project's test runner | all green (pre-existing failures noted, not introduced) |
| Static/security scan | project's scanner | zero new findings, or `N/A` if not configured |

**Critical review checklist (walk every item):**
- Safety: no functional logic removed; error handling preserved; type hints intact; imports valid; no breaking API changes
- Behavior: return values unchanged (verified by regression tests); side effects unchanged; exception behavior unchanged
- Quality: removed changes are genuinely slop; remaining code follows project conventions; no orphaned/dead references; no new abstractions introduced

### Phase 6: Fix Issues

If any gate fails or checklist item flips:
1. Identify the specific change that caused the failure
2. Explain why it broke
3. `git checkout` the affected file (or revert just the problematic hunk via Edit)
4. Re-apply only the changes you can prove safe
5. Re-run failing gate and re-walk checklist
6. If three failures on same file: STOP, escalate to user with file, what was tried, what failed, hypothesis

## Expected Output Artifacts

1. Regression test baseline (green before cleanup)
2. Per-file cleanup report: ladder results, categorized removals with before/after, skipped items with reasons
3. Quality gate results (all green)
4. Critical review checklist (all items clean)
5. Final status: CLEAN / ISSUES FIXED / REQUIRES ATTENTION

## Verification Gates

1. Phase 2 regression tests green before any edits
2. All cleanup changes are behavior-preserving (verified by re-running regression tests)
3. All 5 quality gates pass (or explicitly N/A with reason)
4. Critical review checklist fully clean
5. Net impact reported (LOC change, dependencies removed, files deleted)

## Failure Behavior

- If Phase 2 baseline not green: STOP and report; do not edit
- If any gate fails after cleanup: revert the offending change; re-verify; escalate after 3 failures on same file
- If equivalence of a change is uncertain: SKIP; do not guess
- If a batch subagent times out without deliverable: retry once with smaller scope; if still failing, escalate that file under "Issues Found & Fixed"
- Never touch files outside scope — report found slop under "Remaining Risks"

## Handoff Format

```
AI SLOP REMOVAL REPORT — Scope: [branch diff / explicit files] — Files: [N]
Behavior Lock: [N covered], [M new regression tests], GREEN
Cleanup Plan: [per-file: ladder → categories → risk]
Per-File: [file]: [ladder results] → [before/after] → [skipped with reasons]
Quality Gates: [5 gates: PASS/N/A] — Critical Review: PASS
Net Impact: LOC +/-N, Deps +/-N, Files deleted N
Remaining Risks: [none / specific items]
Final Status: CLEAN | ISSUES FIXED | REQUIRES ATTENTION
```

## WorkBuddy-Native Features

- **Agent tool:** Per-file cleanup subagents in batches of 5, `run_in_background=true`, self-contained messages with file path + categories + KEEP rules. Batch completion via TaskOutput. Replaces `task(category="deep", load_skills=...)`.
- **TaskCreate/TaskUpdate:** Phase and per-file tasks tracked via native task management. Replaces LazyCodex `TodoWrite`.
- **Glob/Grep:** File scope discovery and test search. Replaces `codegraph_search`.
- **TaskOutput:** Subagent completion polling. Replaces `multi_agent_v1.wait_agent` / `background_output`.
- **Companion skills:** The 7-rung deletion ladder from `programming` skill (axiom 0) is the Phase 3 pre-filter; `refactor` skill invoked for oversized module splitting when needed.

---
_Adapted from LazyCodex remove-ai-slops/SKILL.md. Preserved verbatim: the behavior-lock-first invariant (Phase 2 regression tests mandatory), the 10 slop categories with KEEP rules, the deletion ladder pre-filter, the adversarial-test proof requirement for guard removal, the quality gates, the critical review checklist, the output format, the anti-patterns, and the 3-failure escalation rule. Adapted: `task(category="deep", load_skills=...)` → WorkBuddy Agent tool subagents with self-contained messages; `TodoWrite` → TaskCreate/TaskUpdate; `multi_agent_v1.wait_agent` / `background_output` → TaskOutput; `codegraph_search` → Glob/Grep; `lsp_diagnostics` → WorkBuddy LSP; `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`; `.omo/` → `.lazyworkbuddy/`._
