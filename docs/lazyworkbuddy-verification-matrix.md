# Lazyworkbuddy Verification Matrix

> v0.1 — Every workflow mapped to its verification path
> Command → Expected Result → Evidence Artifact

## Overview

Every Lazyworkbuddy workflow must have a verification path: a concrete command, an expected result, and an evidence artifact. This matrix defines the verification strategy for every component.

Principles:
1. Verification is automated wherever possible; Manual-QA where a real surface must be exercised
2. Evidence is captured as artifacts (files, logs, screenshots), not assertions
3. Every verification step traces to a LazyCodex source file

---

## Core Workflow Verification

### 1. Deep Init (`/init-deep`)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Skill loads correctly | Invoke `/init-deep` in WorkBuddy | Skill activates, begins Phase 1 (Discovery) | Chat transcript |
| Project structure explored | Observe agent spawns (explorer agents) | 6+ explore agents fire in background | Agent spawn logs |
| scoring works | Read generated `.workbuddy/workbuddy.md` | Directory scoring table present with scores >0 | `workbuddy.md` file |
| AGENTS.md generated | Check `.workbuddy/workbuddy.md` exists | File 50-150 lines, non-generic content | `workbuddy.md` file |
| Subdirectory AGENTS.md | Check for subdirectory workbuddy.md variants | Files exist where score >15 | Subdirectory files |
| Hierarchy correct | Verify child does not repeat parent | No duplicate content between root and child | Diff between files |

**LazyCodex source:** [init-deep SKILL.md](../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md) Phase 1-4.

### 2. Planning (`/ulw-plan`)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Skill loads correctly | Invoke `/ulw-plan "build a login form"` | Skill activates, announces intent + review_required | Chat transcript |
| Exploration runs | Observe explorer/librarian spawns | Subagents fired for repo exploration | Agent spawn logs |
| Plan file created | Check `.lazyworkbuddy/plans/<slug>.md` | File has TL;DR, Todos, Final Verification Wave | Plan file |
| Plan is decision-complete | Read plan file | Every todo has references + acceptance + QA + commit | Plan file content |
| Approval gate works | After plan presented | Status: awaiting-approval; does not execute | Chat transcript |
| No product code written | Check git status | No product files modified | `git status` output |

**LazyCodex source:** [ulw-plan SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md) Intent Routing, Approval Gate.

### 3. Execution (`/start-work`)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Plan selection works | `/start-work <slug>` | Selects plan, creates boulder state | `.lazyworkbuddy/runs/<run_id>/state.json` |
| Boulder state created | Read state.json | Has schema_version, active_work_id, works | `state.json` |
| Subagent spawning works | Observe orchestrator output | Worker subagents spawned for implementation | Agent spawn logs |
| Orchestrator never implements | Check git diff | All product changes from subagents, not root | `git log` per-author |
| Evidence captured | Read events.jsonl | DoneClaim entries with changed_files, tests, manual_qa | `events.jsonl` |
| Verification gate passes | Check Phase 4 output | Plan reread + automated + Manual-QA + adversarial + cleanup | Chat transcript |
| Checkbox marked | Read plan file after completion | `- [x]` on completed checkbox | Plan file |
| ORCHESTRATION COMPLETE | Final output | Prints full completion block | Chat transcript |

**LazyCodex source:** [start-work SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phases 1-5.

### 4. Verified Loop (`/ulw-loop`)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Goal creation works | `/ulw-loop "fix all type errors"` | Creates goal with success criteria | `.lazyworkbuddy/ulw-loop/` state |
| Iteration cap respected | Run 500+ iteration loop | Stops at 500 (ultrawork) or 100 (normal) | Run log |
| Evidence required per criterion | Check each criterion completion | Each has Manual-QA artifact | Evidence files |
| Resume after compaction | Simulate context loss → resume | Reads state → resumes from last goal | Chat transcript |
| Completion verified by evidence | Oracle verification | Only marked done when evidence is real | events.jsonl |

**LazyCodex source:** [ulw-loop SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md) Non-Negotiables.

### 5. Review (`/review-work`)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| 5 agents spawn | `/review-work` after implementation | 5 subagents fire in parallel | Agent spawn logs |
| Goal Verifier runs | Agent 1 output | Goal completeness + constraint compliance checked | Agent output |
| QA Executor runs | Agent 2 output | 15-30 test scenarios executed | Agent output |
| Code Reviewer runs | Agent 3 output | 10 review dimensions scored | Agent output |
| Security Auditor runs | Agent 4 output | 10 security checks | Agent output |
| Context Miner runs | Agent 5 output | Git/issue/context search results | Agent output |
| All 5 must PASS | Aggregate verdict | REVIEW PASSED only if all 5 PASS | Final report |
| INCONCLUSIVE handling | Simulate agent timeout | Lane marked INCONCLUSIVE; review not passed | Final report |

**LazyCodex source:** [review-work SKILL.md](../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) Phases 0-3.

---

## Hook Verification

### SessionStart

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Rules loaded | Start new session | `.workbuddy/rules/lazyworkbuddy.md` loaded | Status message: `(Lazyworkbuddy): Loading Project Rules` |
| Bootstrap checked | First session after install | Bootstrap provisioning runs if needed | Status message |

**LazyCodex source:** [session-start-loading-project-rules.json](../reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json).

### Stop / SubagentStop (Continuation)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Continuation re-injection | Stop while start-work has unchecked checkboxes | Next turn re-injects start-work Skill | Chat transcript |
| Evidence verification | SubagentStop with executor matcher | Verifier checks DoneClaim → AdversarialVerify | Status message: `(Lazyworkbuddy): Verifying Executor Evidence` |
| Completion stops loop | Stop after all checkboxes done | No re-injection; prints ORCHESTRATION COMPLETE | Chat transcript |

**LazyCodex source:** [stop-checking-start-work-continuation.json](../reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json), [subagent-stop-verifying-lazycodex-executor-evidence.json](../reference/lazycodex/plugins/omo/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json).

### PreToolUse (Budget Enforcement)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Budget warning | Exceed iteration budget | Warning message; budget not enforced (only warned) | Status message |
| Budget tracking | Run long workflow | Iteration count tracked in run state | state.json iteration_count |

### PostToolUse (Diagnostics)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Rule matching | Edit a file → tool use completes | Rules matched against changed files | Status message |
| Diagnostics check | Edit TypeScript file → PostToolUse | LSP diagnostics checked if enabled | Status message |

---

## State Ledger Verification

### Run State (state.json)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Schema validity | Create run → read state.json | Valid JSON with all required fields | state.json |
| Session tracking | Multiple sessions on same run | session_ids array accumulates correctly | state.json |
| Status transitions | active → paused → completed | Status field updates correctly | state.json diffs |

### Evidence Ledger (events.jsonl)

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Event append | Complete a checkbox | New JSON line appended | events.jsonl tail |
| DoneClaim format | Read a DoneClaim entry | Has task, changed_files, tests, manual_qa, cleanup, risks | events.jsonl entry |
| AdversarialVerify format | Read a verify entry | Has verdict, evidence, repro, confidence | events.jsonl entry |
| FullyDone transition | DoneClaim + AdversarialVerify confirmed | FullyDone recorded | events.jsonl entry |

**LazyCodex source:** [start-work SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phases 2, 4.

### Checkpoints

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Checkpoint creation | After N checkboxes completed | Snapshot created in checkpoints/ dir | Checkpoint files |
| Checkpoint restore | Simulate crash → restore | Resume from last checkpointed checkbox | State matches before crash |

---

## MCP Verification

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Run ledger query | MCP: query run status | Returns current state.json contents | MCP response |
| Run ledger append | MCP: append event | Appends JSON line to events.jsonl | MCP response + file check |
| Verification test | MCP: run verification | Returns test results with pass/fail | MCP response |
| Parity check | MCP/cli: compare parity | Returns diff between Lazyworkbuddy and LazyCodex behavior | Diff report |

---

## Agent Verification

| Agent | Verification Step | Expected Result | Evidence |
|-------|-------------------|-----------------|----------|
| Planner | Attempt to write product code | Refuses; "I am a planner — I never write product code" | Chat transcript |
| Implementer | Spawn subagent | Refuses or errors (orchestrator-only) | Agent error |
| Verifier | Test true claim | Returns confirmed verdict | Verifier output |
| Verifier | Test false claim | Returns needs-fix verdict | Verifier output |
| Reviewer | 5-lane review | Each lane has PASS/FAIL/INCONCLUSIVE verdict | Review report |
| Librarian | After accepted change | Updates workbuddy.md + parity ledger | File diffs |
| Orchestrator | Spawn multiple agents | Agents run independently; orchestrator only coordinates | Agent spawn logs |

---

## Cross-Cutting Verification

### Parity Check

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| Method coverage | scripts/parity-check.sh | All LazyCodex methods have Lazyworkbuddy equivalent or documented gap | Parity report |
| Behavior comparison | Compare specific workflow outputs | Lazyworkbuddy produce same result structure as LazyCodex | Diff report |

### Clean-Room Compliance

| Verification Step | Command | Expected Result | Evidence Artifact |
|-------------------|---------|-----------------|-------------------|
| No copied source code | Grep for LazyCodex source patterns | No verbatim matches | Grep results |
| Semantic equivalence | Behavioral tests | Same inputs produce same outputs | Test results |
| License compliance | Check all files for proper attribution | All attributions correct; no copied material without license | Audit report |

---

## Verification Priority

| Priority | Workflows | When to Verify |
|----------|-----------|---------------|
| P0 (blocking) | start-work, ulw-loop, Stop hooks | Every code change |
| P1 (required) | ulw-plan, review-work, state ledger | Every version phase |
| P2 (recommended) | init-deep, MCP tools, parity check | Every major version |
| P3 (nice-to-have) | Full end-to-end, cross-cutting | v0.11 dogfood, v0.12 release |

---

_All verification steps trace to LazyCodex source files in `reference/lazycodex/`. Expected results are derived from the method semantics documented in each source file._
