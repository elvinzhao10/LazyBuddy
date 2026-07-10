# Lazyworkbuddy Operating Manual

> How an agent operates in this workspace: the inspect→plan→implement→verify→review→update-memory loop.

## The Loop

Every significant work unit in Lazyworkbuddy follows this loop:

```
INSPECT → PLAN → IMPLEMENT → VERIFY → REVIEW → UPDATE MEMORY
  │                                            │
  └────────────────────────────────────────────┘
              (loop for next checkbox)
```

## Phase 1: Inspect

**Before doing anything:** read the relevant files.

1. Read `workbuddy.md` — project identity, structure, conventions
2. Read `plan/v0.<N>-<description>.md` — the spec for the current version
3. Read any reference files in `reference/lazycodex/` that the spec cites
4. Read any files you plan to modify
5. Read `docs/lazyworkbuddy-known-gaps.md` — know what's already broken

**Guard:** Do not skip inspection. "I remember this" is not inspection. Every claim needs a file path.

## Phase 2: Plan

**Before multi-file changes:** create a decision-complete plan.

- **Small changes** (1-2 files, obvious): Plan in conversation; state the plan explicitly.
- **Medium changes** (3-5 files, some ambiguity): Use WorkBuddy Plan Mode.
- **Large changes** (5+ files, architecture decisions): Invoke `/lazy-ulw-plan`.

The plan must be decision-complete — the implementer needs zero further interviews.

**Guard:** Never implement without a plan unless the change is trivial (single-line fix, typo).

## Phase 3: Implement

**Execute the plan** using `/lazy-start-work` for planned work, or direct implementation for small changes.

- **Orchestrator:** Root agent orchestrates; never implements directly. Spawn subagents for implementation.
- **Implementer subagent:** Receives a self-contained task (TASK + DELIVERABLE + SCOPE + VERIFY). Returns DoneClaim.
- **Parallelism:** Independent sub-tasks run concurrently; same-file writes serialize.

**Guard:** NEVER skip the orchestrator-delegate pattern for medium+ work. "I'll just do it myself" defeats the reviewer safety net.

## Phase 4: Verify

**Prove the work is correct:**

1. Automated verification: run tests, typecheck, lint, build
2. Manual-QA: capture a real-surface artifact (screenshot, curl output, tmux transcript)
3. Adversarial QA (HEAVY-tier): probe every applicable ultraqa class
4. Cleanup: tear down QA resources, capture receipts

**Guard:** "Looks correct" is not verification. `--dry-run` is not evidence. Tests alone do not prove done.

## Phase 5: Review

**Prove the work is good:**

- **Small work:** Self-review against acceptance criteria; record in run log.
- **Significant work:** Spawn a 5-agent `review-work` parallel review (Goal, QA, Code, Security, Context). All 5 lanes must PASS.

**Guard:** A separate reviewer agent must accept. The implementer cannot self-review for significant work.

## Phase 6: Update Memory

**After accepted work:**

1. Append daily log: `.workbuddy/memory/YYYY-MM-DD.md`
2. Update parity: `docs/lazyworkbuddy-parity-ledger.md` if parity changed
3. Update gaps: `docs/lazyworkbuddy-known-gaps.md` if new deviations found
4. Update project memory: `workbuddy.md` if conventions changed

**Guard:** Never skip memory update after substantive work.

## When to Use Each Command

| Situation | Command | Why |
|-----------|---------|-----|
| First time in a workspace | `/lazy-init-deep` | Generate hierarchical project memory |
| Before a multi-file change | `/lazy-ulw-plan "description"` | Decision-complete plan |
| Approved plan ready to build | `/lazy-start-work <plan-name>` | Orchestrated execution with evidence |
| Open-ended task, need verified done | `/lazy-ulw-loop "task"` | Evidence-backed completion loop |
| Implementation complete | `/lazy-review-work` | 5-agent parallel review |
| Need maximum precision | `/lazy-ultrawork` | Binding ultrawork directive |

## Escalation Rules

| Situation | Action |
|-----------|--------|
| Objective is unclear | Ask ONE focused question; do not guess |
| Destructive action needed | Warn + list affected files + require confirmation |
| Blocked by missing dependency | Document the block; pause; do not work around |
| Verification fails | Re-dispatch implementer with exact failure; do not hand-fix |
| Review fails (any lane) | Fix with evidence; rerun affected lane; do not override |
| Parity discrepancy found | Document in known-gaps; do not silently adapt |
| State corruption detected | Restore from latest checkpoint; do not hand-edit state |
| Iteration cap reached | Pause and ask user; do not force-continue |

## Output Format

Every version's work report uses this 7-section format:

1. **What I inspected** — file paths read (in this repo, docs/, reference/lazycodex/)
2. **What I found** — key decisions, architectural choices, why
3. **What I changed** — every file created/modified, one-line summary each
4. **How to run it** — validation commands, how to test
5. **Verification performed** — each check with PASS/FAIL + evidence
6. **Remaining gaps** — unresolved issues for the next version
7. **Next prompt to paste** — delegation prompt for the following version

---

_This manual is binding: every agent in this workspace must follow it. Violations are defects._
