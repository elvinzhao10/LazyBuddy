# LazyBuddy Loop Protocol v0.7

> State machine, transitions, and iteration rules for autonomous runs.

## State Machine

```
(plan assigned)   (plan approved)   (task done+verify)  (all gates)
┌────────┐        ┌───────────┐     ┌────────────┐      ┌──────────┐
│created ├───────►│ planning  ├────►│ executing  ├─────►│verifying │
└────────┘        └───────────┘     └──┬──┬──┬───┘      └────┬─────┘
                                       │  │  │                │
                          (failure)    │  │  │  (resolve)     │ (pass)
                              ┌────────┘  │  └───────┐        │
                              ▼            │          │        ▼
                         ┌─────────┐       │     ┌────┴──────────┐
                         │ blocked │◄──────┘     │  reviewing     │
                         │(repair) │             │                │
                         └─────────┘             └──┬──┬──┬───────┘
                                                    │  │  │
                          any state ──► failed       │  │  └─ (accepted) → complete
                          any state ──► cancelled    │  └──── (revise) → executing
                                                     └─────── (reject) → blocked
```

## Transition Rules

| From | Trigger | To | Notes |
|------|---------|----|-------|
| `created` | plan_reference assigned | `planning` | Must exist + parse |
| `planning` | plan decision-complete | `executing` | Orchestrator approval |
| `executing` | tasks done, verify pending | `verifying` | DoneClaim logged |
| `verifying` | all gates passed | `reviewing` | AdversarialVerify confirms |
| `reviewing` | accepted | `complete` | Terminal — done |
| `reviewing` | revisions requested | `executing` | List attached to state |
| `reviewing` | rejected | `blocked` | Requires human intervention |
| `executing` | subagent/gate failure | `blocked` | Auto repair task created |
| `blocked` | repair task resolved | `executing` | Re-enter loop |
| `blocked` | unrecoverable | `failed` | Terminal |
| any | user abort | `cancelled` | Terminal |
| any | unrecoverable error | `failed` | Terminal |

## Loop Phases

**Phase 1 — created → planning:** Parse plan checkboxes into task list. Set iteration cap: 500 ultrawork / 100 normal.

**Phase 2 — planning → executing:** Orchestrator validates decision-completeness. Each checkbox needs acceptance criteria, QA steps, commit message.

**Phase 3 — executing:** Find next pending checkbox → classify tier → decompose → dispatch subagents → collect DoneClaims → transition to verifying.

**Phase 4 — verifying:** Run adversarial QA per checkbox (HEAVY: full class probing). Gate status progresses pending → passed | failed. All pass → reviewing. Any fail → back to executing.

**Phase 5 — reviewing:** 5-lane parallel review (Goal, QA, Code, Security, Context). Aggregate: PASS→complete, REVISE→executing, REJECT→blocked.

**Phase 6 — termination:** `complete` (all done+passed), `failed` (unrecoverable), `cancelled` (user).

## Iteration Cap

1 cycle = find checkbox → dispatch → DoneClaim → verify. Cap: 500 ultrawork / 100 normal. At cap: pause + ask user. Stall (>20 iterations no progress): auto-pause.

## Loop Health Checks

| Check | Symptom | Action |
|-------|---------|--------|
| Stall | No completions in 20 iterations | Pause + warn |
| Corruption | state.json unreadable | Restore latest checkpoint |
| Regression | Previous done now unchecked | Restore checkpoint |
| Orphan | Agent running, no parent loop | Cancel + log |

## Flow Diagram

```
START → find pending checkbox
  ├── none found → all done? → YES → COMPLETE
  │                NO → stall check → pause
  ├── dispatch sub-tasks
  ├── collect DoneClaim → fail? → blocked + repair
  ├── adversarial verify → fail? → executing (retry)
  └── review (5 lanes) → fail? → executing (retry)
                       → REJECT? → blocked
                       → PASS → COMPLETE
```

---
_Iteration caps and loop phases trace to `docs/lazybuddy-state-ledger-design.md`. v0.7 adds explicit planning, verification, review, and blocked/rejected terminal paths._
