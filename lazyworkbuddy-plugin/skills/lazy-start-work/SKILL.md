---
name: lazy-start-work
description: "Execute a work plan with orchestrated subagent delegation and verified completion evidence. Loads a plan, selects tasks, delegates to implementers, verifies, reviews."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# start-work

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/start-work/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md)

## Purpose

Execute a work plan until every top-level checkbox is complete. This skill is the orchestrator (Sisyphus) — it delegates ALL implementation, test, QA, and review work to spawned subagents. The root agent NEVER writes product code, NEVER edits product files, NEVER runs QA itself. It exclusively manages plan selection, run state, decomposition, dispatch, verdicts, and evidence records.

## Trigger Conditions

- User invokes `/start-work [plan-name]`
- User says "execute plan", "start the plan", "run the plan"
- Stop/SubagentStop hook re-injects after continuation check (v0.6+)

## Required Context

Before executing:
- Read the plan from `.lazyworkbuddy/plans/<slug>.md`
- Read `.lazyworkbuddy/runs/<run_id>/state.json` if resuming
- Read `workbuddy.md` for project conventions
- Read `.workbuddy/rules/lazyworkbuddy-verification.md` for evidence standards

## Tool Access

- Allowed: Read, Grep, Glob, Write, Edit (ONLY to `.lazyworkbuddy/` and plan files), Bash (verification only), Agent (subagent spawning)
- **Disallowed on product paths:** Write, Edit — NEVER modify product code directly
- **Orchestrator-only constraint:** Root NEVER implements, writes tests, or runs QA. Spawn a worker for every implementation unit.

## Step-by-Step Procedure

### Phase 1: Select the plan

1. Read `.lazyworkbuddy/runs/<run_id>/state.json` if it exists (resume)
2. List plans under `.lazyworkbuddy/plans/`
3. If plan-name provided: select matching plan
4. If exactly one active/paused run exists: resume it
5. If exactly one plan exists and no active run: select it
6. If no selectable plan: enter **No-plan bootstrap** — invoke `ulw-plan` to create a plan, then continue

### Phase 2: Create or update run state

Write `.lazyworkbuddy/runs/<run_id>/state.json` with:
- `schema_version: 2`
- `run_id`, `plan_reference`, `plan_name`
- `status: "active"`, `session_ids: ["<session_id>"]`
- `tier: { level: "LIGHT" | "HEAVY", justification: "..." }`
- `checkboxes: []` — one entry per plan todo

### Phase 3: Execute the next checkbox

1. Find the first unchecked checkbox in the plan
2. Classify tier (LIGHT/HEAVY) per ultrawork triage rules
3. Decompose into atomic sub-tasks
4. **DELEGATE EVERYTHING.** Spawn worker subagents for ALL independent sub-tasks in parallel using WorkBuddy Agent tool. Each subagent message must include: TASK, DELIVERABLE, SCOPE, VERIFY.
5. For LIGHT: direct implementation. For HEAVY: failing-first proof then implementation.

**Each subagent task message must include:**
- Goal and exact files/directories in scope
- Baseline characterization test (if touching existing behavior)
- Implementation constraints from plan and project rules
- Automated verification commands
- One Manual-QA channel (exact tool + exact invocation + binary observable)
- The 9 adversarial classes that apply to this sub-task

**The 9 adversarial classes** (from LazyCodex `start-work` source line 118; a class applies when its trigger fact holds — probe each applicable one, record non-applicable with a one-line reason):
1. `malformed_input` — new input parsing
2. `prompt_injection` — untrusted external text
3. `cancel_resume` — resumable or long-running flows
4. `stale_state` — generated or cached artifacts
5. `dirty_worktree` — uncommitted user files in scope
6. `hung_commands` — long external commands
7. `flaky_tests` — new or timing-sensitive tests
8. `misleading_success_output` — log-based success claims
9. `repeated_interruptions` — mid-operation interrupts

### Phase 4: Verify and record evidence

For each checkbox, complete FIVE gates:
1. **Plan reread:** Confirm checkbox and acceptance criteria
2. **Automated verification:** Run tests, typecheck, lint, build
3. **Manual-QA channel:** Capture real artifact (screenshot, curl output)
4. **Adversarial QA:** Probe every applicable ultraqa class
5. **Cleanup:** Tear down QA resources; capture receipts

Append evidence to `.lazyworkbuddy/runs/<run_id>/events.jsonl`.

**Sisyphus completion contract:**
- Worker returns `DoneClaim` → Verifier runs `AdversarialVerify` → `confirmed` → `FullyDone`
- `confirmed` is the ONLY pass verdict
- Verifier MUST be independent from executor

### Phase 5: Mark progress

Only after all 5 gates pass:
1. Edit plan checkbox: `- [ ]` → `- [x]`
2. Append `checkbox-completed` event to ledger
3. Continue to next checkbox. Do NOT ask whether to continue.

### Completion

When all checkboxes + Final Verification Wave are done:
1. Run final verification commands
2. Run the Global Review Gate (`/review-work` — 5-agent review)
3. All review lanes must PASS
4. Print `ORCHESTRATION COMPLETE`

## Expected Output Artifacts

- `.lazyworkbuddy/runs/<run_id>/state.json` — run state with completed checkboxes
- `.lazyworkbuddy/runs/<run_id>/events.jsonl` — evidence ledger with DoneClaim + AdversarialVerify entries
- `.lazyworkbuddy/runs/<run_id>/evidence/` — Manual-QA artifacts
- Plan file with checkboxes marked `[x]`

## Verification Gates

1. All plan checkboxes completed by subagents (not root)
2. Every checkbox has DoneClaim + AdversarialVerify in events.jsonl
3. Manual-QA artifacts exist and are verifiable
4. 5-agent review passes all lanes
5. `ORCHESTRATION COMPLETE` printed with artifacts and cleanup receipts

## Failure Behavior

- If a subagent's DoneClaim fails AdversarialVerify: re-dispatch with exact failure feedback
- If a subagent times out or returns inconclusive: respawn smaller scoped task
- If iteration cap hit: pause; record `run_paused` event
- If state corruption: restore from latest checkpoint

## Handoff Format

```
ORCHESTRATION COMPLETE
  Plan: .lazyworkbuddy/plans/<slug>.md
  Checkboxes: N/N completed
  Verification: [commands + results]
  Review: [5-lane verdict]
  Artifacts: [paths]
  Cleanup: [receipts]
```

## State Ledger Integration (v0.7)

The start-work orchestrator now writes all run state through the state/ and loop/ script layer.

- **Phase 2 (Create state):** Calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/create-run.sh <run_id> "<objective>"` to create the run directory with `state.json`, `events.jsonl`, and all subdirectories (`evidence/`, `checkpoints/`, `verification/`, `review/`, `agent_outputs/`, `artifacts/`, `memory_updates/`). The script also initializes `status: "planning"` and `iteration.count: 0`.
- **Phase 3 (Execute):** Calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/loop/next-task.sh <run_id>` to fetch the next unverified checkbox from `state.json` and mark it `in_progress`. When a task is complete, calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/update-task.sh <run_id> <task_index> done` to record completion, validation status, and evidence paths.
- **Phase 4 (Evidence):** Calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/append-event.sh <run_id> done_claim "<json>"` to write each DoneClaim as a structured event in `events.jsonl`. After adversarial verification, calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/update-task.sh <run_id> <task_index> evidence --field verified_by=<agent> --field confidence=<score>` to attach verification metadata to the task.
- **Phase 5 (Checkpoint):** Calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/checkpoint.sh <run_id>` every N checkboxes (default N=3) to snapshot `state.json` into `checkpoints/checkpoint-<NN>.json` for crash recovery.

## Worktree Discipline (v0.9 hardening)

When work involves branch/PR changes:
- Create a git worktree: `git worktree add ../worktree-<run_id> main`
- Verify with `git worktree list --porcelain`
- Record `worktree_path` in `state.json`
- All implementation happens in the worktree; review artifacts reference the worktree path
- See LazyCodex source: start-work Phase 2 lines 71-92

## Debugging Runtime Audit (v0.9 hardening)

After the 5-agent review gate and before `ORCHESTRATION COMPLETE`:
- Name 3+ failure hypotheses for the implemented work
- Run distinguishing checks for each hypothesis
- Append results to `events.jsonl`
- See LazyCodex source: start-work Completion phase lines 176-184

## DoneClaim/AdversarialVerify JSON Schema (v0.9 hardening)

```json
DoneClaim: {
  "task": "<task id/title>",
  "changed_files": ["absolute paths"],
  "tests": ["exact command + result"],
  "manual_qa": ["artifact paths"],
  "adversarial_classes": {
    "malformed_input": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "prompt_injection": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "cancel_resume": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "stale_state": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "dirty_worktree": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "hung_commands": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "flaky_tests": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "misleading_success_output": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "repeated_interruptions": {"probed": bool, "result": "PASS|FAIL|N-A"}
  },
  "cleanup": ["receipt paths"],
  "risks": ["known risks or empty"]
}
AdversarialVerify: {
  "verdict": "confirmed|false-positive|needs-fix|needs-human-review",
  "evidence": ["command+result per claim"],
  "repro": "exact repro command",
  "confidence": 0.0-1.0,
  "adversarial_classes": {
    "malformed_input": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "prompt_injection": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "cancel_resume": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "stale_state": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "dirty_worktree": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "hung_commands": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "flaky_tests": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "misleading_success_output": {"probed": bool, "result": "PASS|FAIL|N-A"},
    "repeated_interruptions": {"probed": bool, "result": "PASS|FAIL|N-A"}
  },
  "gap_analysis": {"missing_test_gap": "description or N-A"}
}
```

See LazyCodex source: start-work SKILL.md lines 136-160

## WorkBuddy-Native Features

- **Subagent spawning:** WorkBuddy Agent tool replaces `multi_agent_v1.spawn_agent`; `isolation: true` replaces `fork_context: false`
- **`.lazyworkbuddy/runs/`:** Run state replaces `.omo/boulder.json` + `.omo/start-work/`
- **Hooks:** Stop/SubagentStop hooks (v0.6) drive continuation loop
- **State ledger:** `state.json` + `events.jsonl` follow the schema in `docs/lazyworkbuddy-state-ledger-design.md`

---

_Adapted from LazyCodex start-work. Preserved: orchestrator-delegate discipline, 5 verification gates, Sisyphus completion contract, Boulder state, evidence ledger. Adapted: all Codex tool names → WorkBuddy equivalents; `.omo/` → `.lazyworkbuddy/`; plan scaffolding script → inline plan reading. The "NO DIRECT IMPLEMENTATION" rule is preserved verbatim._
