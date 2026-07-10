# LazyBuddy Parallelism Policy

> v0.5 — Rules for concurrent subagent execution in LazyBuddy workflows.

## Core Rule

Parallelize aggressively when safe; serialize only when necessary. The orchestrator is the sole merge point — it owns completion claims and state updates.

## When to Parallelize

### Always parallelize

- **Read-only analysis tasks.** Different files, different search scopes — no shared state risk.
- **Independent implementation tasks.** Different product files, no shared dependencies — safe to run concurrently.
- **Isolated documentation tasks.** Different doc files, different sections — no write conflicts.
- **Review lanes.** The 5-agent review-work (Goal/QA/Code/Security/Context) are independent read operations.
- **Exploration waves.** init-deep fires 6+ explorer subagents simultaneously in Phase 1.

### Example: start-work parallel dispatch

```
orchestrator:
  checkbox_A → implementer (file: src/auth/login.ts)
  checkbox_B → implementer (file: src/db/migrations.ts)
  checkbox_C → implementer (file: src/api/routes.ts)

  All 3 run concurrently — different files, no shared state.
  After completion: serialized verify → review per checkbox.
```

## When to Serialize

### Never parallelize

- **Same file mutations.** Two implementers editing the same file → race condition. Serialize.
- **State-dependent tasks.** Task B depends on Task A's output → Task B waits for Task A.
- **Orchestrator writes.** Only the orchestrator writes to state.json and events.jsonl. Subagents never write shared state.
- **Sequential gates.** Verifier runs AFTER implementer. Reviewer runs AFTER verifier. These are ordered by design.

### Example: dependency chain

```
orchestrator:
  checkbox_A → implementer_A → wait → verifier_A → wait → reviewer_A
  checkbox_B (depends on checkbox_A completion) → waits

  Serialized because B depends on A's output.
```

## Agent-Specific Parallelism Rules

| Agent | Can Run Concurrently | Constraint |
|-------|---------------------|------------|
| **Explorer** | Yes — multiple explorers in parallel | Different search scopes or different questions |
| **Context Indexer** | Yes — with explorers | Different dirs; writes to .lazybuddy/context/ |
| **Planner** | No — single planner at a time | One plan being written at a time |
| **Implementer** | Yes — parallel when different files | Never same file simultaneously |
| **Verifier** | Yes — parallel when verifying different tasks | Independent DoneClaims, independent evidence |
| **Reviewer** | Yes — parallel review lanes (5-agent review) | All lanes are read-only; merge after all complete |
| **QA Executor** | Yes — parallel with implementers on different targets | May compete for ports; serialize if port conflicts |
| **Gate Reviewer** | No — single gate reviewer | Final approval before handoff |
| **Librarian** | No — single librarian | Memory files should be updated atomically |
| **Security Auditor** | Yes — in parallel with other review lanes | Read-only; part of 5-agent review |
| **Migration Planner** | No — single planner | One adapter plan at a time |

## Parallelism Patterns

### Pattern 1: Fan-out (exploration)

```
orchestrator → [explorer_A, explorer_B, explorer_C, ...]
orchestrator ← [result_A, result_B, result_C, ...]
orchestrator: merge and proceed
```

### Pattern 2: Delegate-and-verify (implementation)

```
orchestrator → [implementer_A, implementer_B]  (parallel, different files)
orchestrator ← [DoneClaim_A, DoneClaim_B]
orchestrator → verifier_A → wait → result_A
orchestrator → verifier_B → wait → result_B  (can run in parallel with verifier_A)
```

### Pattern 3: Review gate (serial)

```
orchestrator → reviewer → wait → accept/revise/reject
orchestrator → (if accept) librarian → wait → memory updated
orchestrator → (if revise) implementer → wait → verifier → wait → reviewer
```

### Pattern 4: 5-agent review (fan-out + merge)

```
orchestrator → [goal_verifier, qa_executor, code_reviewer, security_auditor, context_miner]
  All 5 run in parallel with run_in_background=true
orchestrator polls each with TaskOutput until all 5 have terminal state
orchestrator: merge verdicts → REVIEW PASSED only if all 5 PASS
```

## Orchestrator Merge Rules

The orchestrator is the **sole writer** of shared state:

- `state.json` — written by orchestrator only; subagent results inform updates
- `events.jsonl` — appended by orchestrator only; appends are atomic
- Plan checkboxes — edited by orchestrator only after all gates pass

Subagents return their results in their agent output message. The orchestrator reads the output, validates it, then writes to the ledger.

## Maximum Concurrency

| Context | Max Parallel Subagents | Rationale |
|---------|----------------------|-----------|
| Exploration (init-deep) | 12 | One-shot fan-out; results collected before proceeding |
| Implementation (start-work) | 5 | Different files, independent tasks |
| Review (review-work) | 5 | 5 independent lanes |
| Total active at once | 10 | System resource ceiling; beyond this, queue tasks |

---

_These rules are enforced by the orchestrator's system prompt and the verification gates in start-work/ulw-loop skills. Violation = defect._
