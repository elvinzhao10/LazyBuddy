# LazyBuddy Agent Orchestration

> v0.5 — Full lifecycle agent flow from init-deep to completion.

## Orchestration Flow

```
                    ┌─────────────┐
                    │  init-deep  │  User invokes /lazy-init-deep
                    │  (explorer  │  → Context Indexer maps repo
                    │  + context  │  → Generates workbuddy.md
                    │  -indexer)  │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  ulw-plan   │  User invokes /lazy-ulw-plan "task"
                    │  (planner)  │  → Planner inspects codebase
                    │             │  → Writes plan to .lazybuddy/plans/
                    │             │  → Awaits approval
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ start-work  │  User invokes /lazy-start-work
                    │(orchestrator│  → Orchestrator loads plan
                    │  = Sisyphus)│  → Creates run state
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │implementer│ │implementer│ │implementer│  Parallel lanes
        │  (task A) │ │  (task B) │ │  (task C) │  (independent tasks)
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             └────────────┼────────────┘
                          │ DoneClaims returned
                          ▼
                   ┌─────────────┐
                   │  verifier   │  Independent from implementers
                   │  (Oracle)   │  → Reproduces each DoneClaim
                   │             │  → AdversarialVerify
                   │             │  → confirmed / needs-fix
                   └──────┬──────┘
                          │
               ┌──────────┴──────────┐
               ▼                     ▼
        ┌────────────┐        ┌────────────┐
        │  reviewer  │        │implementer  │  If needs-fix:
        │ (Momus/    │        │  (re-fix)  │  re-dispatch with
        │  Metis)    │        └─────┬──────┘  exact failure
        └─────┬──────┘              │
              │                     │
              │    ┌────────────────┘
              │    ▼
              │  ┌────────────┐
              │  │  verifier  │  Re-verify fix
              │  │  (Oracle)  │
              │  └─────┬──────┘
              │        │
              └────────┼──────────────────────┐
                       ▼                      ▼
                ┌────────────┐         ┌────────────┐
                │  reviewer  │         │  librarian │  On accept:
                │  accept?   │  yes    │  (memory   │  → update memory
                └─────┬──────┘────────►│   update)  │
                      │ no             └─────┬──────┘
                      ▼                      │
                ┌────────────┐                │
                │implementer │                │
                │  (revise)  │                │
                └────────────┘                │
                                              ▼
                                       ┌────────────┐
                                       │  ulw-loop  │  Next checkbox
                                       │ (continue) │  or completion
                                       └─────┬──────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                       ┌────────────┐ ┌────────────┐ ┌────────────┐
                       │ 5-agent    │ │  gate-     │ │ librarian  │
                       │ review-work│ │  reviewer  │ │ (final     │
                       │            │ │  (Oracle)  │ │  update)   │
                       └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
                             │              │              │
                             └──────────────┼──────────────┘
                                            ▼
                                    ORCHESTRATION
                                     COMPLETE
```

## 5-Agent Review (review-work detail)

When the orchestrator invokes review-work, 5 subagents run in parallel:

```
                    orchestrator
                          │
         ┌────────────────┼────────────────┬───────────────┐
         ▼                ▼                ▼               ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  Goal    │    │   QA     │    │  Code    │    │ Security │
   │ Verifier │    │ Executor │    │ Reviewer │    │ Auditor  │
   │ (reason) │    │(default) │    │ (reason) │    │ (reason) │
   └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
        │               │               │               │
        └───────────────┼───────────────┼───────────────┘
                        │               │
                        ▼               ▼
                  ┌──────────┐    ┌──────────┐
                  │ Context  │    │  Gate    │
                  │  Miner   │    │ Reviewer │ (optional heavy review)
                  │(default) │    │ (reason) │
                  └────┬─────┘    └────┬─────┘
                       │               │
                       └───────┬───────┘
                               ▼
                         REVIEW PASSED
                     (all 5 lanes PASS)
```

## Agent Authority Boundaries

| Agent | Owns | Never |
|-------|------|-------|
| **Orchestrator** | Workflow state, task selection, delegation, completion claim | Implements product code |
| **Planner** | Read-only analysis, plan generation | Writes product code |
| **Explorer** | Codebase search, pattern discovery | Writes files, browses internet |
| **Implementer** | Bounded code/docs changes, evidence capture | Spawns subagents, broadens scope |
| **Verifier** | Command execution, verification summaries | Writes files, marks work done |
| **Reviewer** | Intent match, scope check, accept/revise/reject | Writes product code |
| **QA Executor** | Hands-on QA execution, real-surface evidence | Speculative analysis without running |
| **Gate Reviewer** | Final artifact audit, APPROVE/REJECT | Writes files, approves without evidence |
| **Librarian** | Memory files (workbuddy.md, .workbuddy/, docs/) | Rewrites canonical method map, writes to .lazybuddy/ run state |
| **Migration Planner** | Host-adapter plans | Modifies reference/ or product code |
| **Context Indexer** | Repo map, .lazybuddy/context/ | Writes to product paths |
| **Security Auditor** | Secret detection, permission review, unsafe patterns | Writes files |

## State Transitions

The orchestrator tracks run progress in `.lazybuddy/runs/<run_id>/state.json`:

```
active → (checkbox dispatched → implementer) → (DoneClaim received → verifier)
  → (confirmed → reviewer) → (accept → librarian) → (next checkbox or complete)
  → (needs-fix → implementer re-dispatch) → (re-verify)
  → (all checkboxes done → review-work → gate-reviewer) → completed
```

---

_See `docs/lazybuddy-handoff-protocol.md` for inter-agent message formats and `docs/lazybuddy-parallelism-policy.md` for concurrent execution rules._
