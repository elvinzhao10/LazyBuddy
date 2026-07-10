---
name: lazy-ulw-loop
description: "Verified completion loop for open-ended tasks. Creates goals with binding success criteria, decomposes into evidence-bound steps, runs until all criteria have proof."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# ulw-loop

> **LazyCodex source:** [dev/reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md](../../../dev/reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md)

## Purpose

Run a goal-driven verified completion loop: define binding success criteria with real-surface evidence requirements, decompose into bounded work cycles, verify each cycle with observable proof, and run until all criteria are met or the iteration cap is reached. This skill is designed for open-ended tasks where "done" must be proven, not claimed.

## Trigger Conditions

- User invokes `/lazy-ulw-loop "task" [--completion-promise=TEXT]`
- User says "ulw", "loop this", "keep working until verified"
- Any task where quality requires evidence-backed completion

## Required Context

- Read `.lazybuddy/ulw-loop/<session-id>/goals.json` if resuming
- Read `workbuddy.md` for project conventions
- Read `.workbuddy/rules/lazybuddy-verification.md` for evidence standards

## Tool Access

- Allowed: Read, Grep, Glob, Bash (verification), Agent (spawn workers)
- Write: ONLY to `.lazybuddy/ulw-loop/` and evidence paths
- **Never:** Write product code directly; always delegate to subagents

## Step-by-Step Procedure

### Bootstrap

1. **Survey loaded skills.** Read descriptions; decide which skills apply; name them with one-line reasons.
2. **Tier triage.** Classify as LIGHT (narrow change) or HEAVY (new module, auth, external integration, DB schema, cross-domain refactor). Default is LIGHT; upgrade on HEAVY facts.
3. **Create goals.** Define binding success criteria with:
   - The user-visible deliverable and tier justification
   - Success criteria (LIGHT: 1-2, HEAVY: 3+) covering happy path, edges, boundaries, error paths
   - Each criterion names its exact scenario: literal command, page action, payload, and binary observable
   - Record goals to `.lazybuddy/ulw-loop/<session-id>/goals.json`

### Execution Loop

```
LOOP:
  1. Read goals.json → find first unverified criterion
  2. If no unverified: exit loop → completion
  3. Decompose criterion into bounded work cycles
  4. Delegate implementation to subagents (NEVER implement directly)
  5. Wait for all subagents to complete
  6. For each completed subagent:
     a. Collect DoneClaim
     b. Run AdversarialVerify (independent verifier subagent)
     c. If confirmed → record FullyDone → update criterion status
     d. If not confirmed → re-dispatch with feedback
  7. Record evidence via evidence channels (see below)
  8. Increment iteration count
  9. If same-criterion failures >= 3: escalate to user, record `failure_escalation` event
  10. If current-goal cycles >= 5: mark goal paused, move to next goal
  11. If iteration >= cap (500 ultrawork / 100 normal): exit → incomplete
  12. After every N criteria: create checkpoint
  13. GOTO 1
```

### Evidence Channels

Run real-surface proof through the correct channel:
1. **HTTP call:** `curl -i` against live endpoint; capture status + headers + body
2. **tmux:** `tmux new-session`, drive with `send-keys`, dump via `capture-pane`
3. **Browser:** Use WorkBuddy's built-in browser automation; capture screenshot + action log
4. **CLI/data:** stdout, DB state diff, parsed config dump — first-class for CLI-shaped criteria

**Auxiliary surfaces** (CLI stdout, DB diff, config dump) are first-class evidence for CLI/data-shaped criteria. `--dry-run` and "should respond" are NEVER evidence.

### Non-Negotiables

- Every success criterion needs observable evidence from a real surface
- Tests alone NEVER prove done — need at least one real-surface proof
- Record evidence only after cleanup receipts are available
- Delegate code edits/tests/fixes/QA to subagents — root never implements
- After compaction/context loss: re-read goals + ledger FIRST, then resume
- Use `git-master` skill for git-tracked edits

## Expected Output Artifacts

- `.lazybuddy/ulw-loop/<session-id>/goals.json` — goal definitions with criteria
- `.lazybuddy/ulw-loop/<session-id>/evidence/` — per-goal evidence artifacts
- Iteration tracking: per-goal cycles (max 5), per-criterion failures (max 3 before escalation), overall iterations (cap 500 ultrawork / 100 normal)

## Verification Gates

1. Every criterion has real-surface evidence (not claims)
2. AdversarialVerify confirms every DoneClaim before FullyDone
3. Cleanup receipts recorded for all QA resources
4. Iteration caps respected (5 per-goal, 3 same-failure, 500/100 overall)
5. Same-criterion failures escalated at 3; goals paused at 5 cycles

## Failure Behavior

- Stall detection: 10+ iterations without progress → warn; 20 → abort
- Iteration cap reached (per-goal, per-failure, or overall): pause; record `run_paused` event; ask user whether to continue
- State corruption: restore from checkpoint
- Criterion unreachable: mark as incomplete; move to next

## Handoff Format

```
ULW-LOOP: {complete | incomplete}
  Criteria: N/N verified
  Iterations: {count}
  Evidence: {artifact paths}
  Adversarial checks: {summary}
```

## State Ledger Integration (v0.7)

The ulw-loop now integrates with the state/ and loop/ scripts for durable iteration management and failure recovery.

- **Loop iteration:** Each cycle begins by calling `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/run-cycle.sh <run_id>`. This script increments `state.json`'s `iteration.count`, checks per-goal `iteration.per_goal_max` (5) and per-criterion `iteration.per_failure_max` (3), and checks the `iteration.max` cap (500 for ultrawork, 100 for normal). It writes a `cycle_start` event to `events.jsonl`. When any cap is exceeded, the script exits with code 2, causing the loop to stop with an `incomplete` status. Per-criterion same-failure counts trigger escalation via `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/escalate.sh <run_id> <criterion>` when the threshold is reached.
- **Failure classification:** When a cycle fails, the loop calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/classify-failure.sh <run_id> <error_output>` to analyze the failure. The script classifies it into one of: `stall`, `flaky`, `unreachable`, or `corruption`, and writes a `failure_classified` event to `events.jsonl` with the classification and confidence. Based on the classification, `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/create-repair-task.sh <run_id> <classification>` creates a repair task in `state.json`'s `tasks[]` array.
- **Iteration tracking:** The loop reads `state.json`'s `iteration.count` and `iteration.max` fields at the start of every cycle. If `count >= max`, no new cycles are started and the run is finalized via `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/finalize-run.sh <run_id>`.

## Dynamic Steering (v0.9 hardening)

Seven steering types govern how the loop handles results. Trigger conditions are checked after each cycle:

1. **continue** — criterion passed AdversarialVerify with `confirmed` verdict; move to next criterion
2. **skip_criterion** — criterion is unreachable or blocked; record reason, move to next
3. **escalate** — 3 same-criterion failures or 5 goal cycles; pause and ask user
4. **pause_for_review** — unexpected test suite breakage or a change touching >3 modules; spawn reviewer before continuing
5. **split_criterion** — criterion scope grew beyond original (e.g., impl touched extra modules); decompose into smaller criteria, restart current
6. **merge_criteria** — two criteria are verified by the same evidence; merge and mark both complete
7. **revert_last_cycle** — cycle produced regressions or corrupted state; revert changes and re-dispatch

See LazyCodex source: full-workflow.md lines 206-220

## Final Quality Gate (v0.9 hardening)

Before declaring completion, run the final quality gate:

1. **Re-run all verification** — every criterion's scenario, the full test suite, LSP diagnostics
2. **Gate-reviewer approval** — spawn an independent reviewer subagent with `isolation: true`; it reviews the full goals.json, all evidence artifacts, the events.jsonl ledger, and the iteration trace
3. **Evidence audit** — confirm every criterion has real-surface evidence (not `--dry-run`, not assertion-only); confirm all cleanup receipts are recorded
4. Gate-reviewer must return UNCONDITIONAL approval before completion is declared

See LazyCodex source: full-workflow.md lines 183-204

## Delegation Model (v0.9)

ATLAS-style task sizing for subagent delegation:

- **XS** (1-2 tool calls) — inline by the root; single grep/read/edit
- **S** (3-8 tool calls, 1 file) — spawned worker with `isolation: true`
- **M** (8-20 tool calls, 2-5 files) — spawned worker; requires `SCOPE` with explicit file list
- **L** (20-50 tool calls, >5 files, cross-module) — HEAVY triage; spawn with `effort: high`, explicit `DELIVERABLE` per module
- **XL** (>50 tool calls, multi-service) — decomposes into plan agent → L/M waves; spawned workers per wave

**Wave-based parallelism:** When criteria are independent (no shared files, no state coupling), dispatch them as parallel waves. All workers in a wave share the same `SCOPE` but operate on disjoint files. Wait for the full wave to complete before starting the next wave.

See LazyCodex source: full-workflow.md lines 35-61

## WorkBuddy-Native Features

- **Subagent spawning:** Implementation and QA delegated to WorkBuddy Agent tool
- **State persistence:** Goals and evidence stored in `.lazybuddy/ulw-loop/`
- **Hooks (v0.6+):** Stop/SubagentStop hooks re-inject the loop on continuation
- **Checkpoints:** Periodic state snapshots in `.lazybuddy/runs/<run_id>/checkpoints/`

---

_Adapted from LazyCodex ulw-loop. Preserved: goal creation with binding criteria, evidence-backed completion, iteration caps, real-surface proof requirement, "tests alone never prove done" axiom. Adapted: `omo ulw-loop` CLI → inline skill logic + future MCP tools; `.omo/ulw-loop` → `.lazybuddy/ulw-loop/`; Codex subagent tools → WorkBuddy Agent tool._
