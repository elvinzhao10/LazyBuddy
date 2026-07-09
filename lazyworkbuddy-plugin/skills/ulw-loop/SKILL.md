---
name: ulw-loop
description: "Goal-like verified completion loop that decomposes work into systematic, evidence-bound steps. Creates goals with binding success criteria, records evidence through real-surface channels, runs until all criteria are verified. Caps at 500 iterations (ultrawork) / 100 (normal). Stop/SubagentStop hooks drive continuation. Triggers: ulw-loop, ulw, durable goal execution, evidence-led work, checkpointed long-running delivery, loop this task."
---

# ulw-loop

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md](../../reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md)

## Purpose

Run a goal-driven verified completion loop: define binding success criteria with real-surface evidence requirements, decompose into bounded work cycles, verify each cycle with observable proof, and run until all criteria are met or the iteration cap is reached. This skill is designed for open-ended tasks where "done" must be proven, not claimed.

## Trigger Conditions

- User invokes `/ulw-loop "task" [--completion-promise=TEXT]`
- User says "ulw", "loop this", "keep working until verified"
- Any task where quality requires evidence-backed completion

## Required Context

- Read `.lazyworkbuddy/ulw-loop/<session-id>/goals.json` if resuming
- Read `workbuddy.md` for project conventions
- Read `.workbuddy/rules/lazyworkbuddy-verification.md` for evidence standards

## Tool Access

- Allowed: Read, Grep, Glob, Bash (verification), Agent (spawn workers)
- Write: ONLY to `.lazyworkbuddy/ulw-loop/` and evidence paths
- **Never:** Write product code directly; always delegate to subagents

## Step-by-Step Procedure

### Bootstrap

1. **Survey loaded skills.** Read descriptions; decide which skills apply; name them with one-line reasons.
2. **Tier triage.** Classify as LIGHT (narrow change) or HEAVY (new module, auth, external integration, DB schema, cross-domain refactor). Default is LIGHT; upgrade on HEAVY facts.
3. **Create goals.** Define binding success criteria with:
   - The user-visible deliverable and tier justification
   - Success criteria (LIGHT: 1-2, HEAVY: 3+) covering happy path, edges, boundaries, error paths
   - Each criterion names its exact scenario: literal command, page action, payload, and binary observable
   - Record goals to `.lazyworkbuddy/ulw-loop/<session-id>/goals.json`

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
  9. If iteration >= cap (500 ultrawork / 100 normal): exit → incomplete
  10. After every N criteria: create checkpoint
  11. GOTO 1
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

- `.lazyworkbuddy/ulw-loop/<session-id>/goals.json` — goal definitions with criteria
- `.lazyworkbuddy/ulw-loop/<session-id>/evidence/` — per-goal evidence artifacts
- Iteration tracking up to cap (500 ultrawork / 100 normal)

## Verification Gates

1. Every criterion has real-surface evidence (not claims)
2. AdversarialVerify confirms every DoneClaim before FullyDone
3. Cleanup receipts recorded for all QA resources
4. Iteration cap respected (500/100)

## Failure Behavior

- Stall detection: 10+ iterations without progress → warn; 20 → abort
- Iteration cap reached: pause; ask user whether to continue
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

- **Loop iteration:** Each cycle begins by calling `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/run-cycle.sh <run_id>`. This script increments `state.json`'s `iteration.count`, checks the `iteration.max` cap (500 for ultrawork, 100 for normal), and writes a `cycle_start` event to `events.jsonl`. When the cap is exceeded, the script exits with code 2, causing the loop to stop with an `incomplete` status.
- **Failure classification:** When a cycle fails, the loop calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/classify-failure.sh <run_id> <error_output>` to analyze the failure. The script classifies it into one of: `stall`, `flaky`, `unreachable`, or `corruption`, and writes a `failure_classified` event to `events.jsonl` with the classification and confidence. Based on the classification, `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/create-repair-task.sh <run_id> <classification>` creates a repair task in `state.json`'s `tasks[]` array.
- **Iteration tracking:** The loop reads `state.json`'s `iteration.count` and `iteration.max` fields at the start of every cycle. If `count >= max`, no new cycles are started and the run is finalized via `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/finalize-run.sh <run_id>`.

## WorkBuddy-Native Features

- **Subagent spawning:** Implementation and QA delegated to WorkBuddy Agent tool
- **State persistence:** Goals and evidence stored in `.lazyworkbuddy/ulw-loop/`
- **Hooks (v0.6+):** Stop/SubagentStop hooks re-inject the loop on continuation
- **Checkpoints:** Periodic state snapshots in `.lazyworkbuddy/runs/<run_id>/checkpoints/`

---

_Adapted from LazyCodex ulw-loop. Preserved: goal creation with binding criteria, evidence-backed completion, iteration caps, real-surface proof requirement, "tests alone never prove done" axiom. Adapted: `omo ulw-loop` CLI → inline skill logic + future MCP tools; `.omo/ulw-loop` → `.lazyworkbuddy/ulw-loop/`; Codex subagent tools → WorkBuddy Agent tool._
