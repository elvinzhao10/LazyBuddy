---
name: review-work
description: "Post-implementation review orchestrator. Launches 5 parallel WorkBuddy Agent subagents (Goal Verifier, QA Executor, Code Reviewer, Security Auditor, Context Miner). ALL 5 must PASS for review to pass. INCONCLUSIVE lane = not approved. Retry budget: max 3 per lane. Triggers: review work, review my work, review changes, QA this, verify implementation, check my work, validate changes, post-implementation review."
---

# review-work

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/review-work/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md)

## Purpose

Launch 5 specialized WorkBuddy Agent subagents in parallel to review completed implementation work from every angle. All 5 must pass for the review to pass. If even ONE fails or remains INCONCLUSIVE, the review does not pass. This is the final gate before claiming work is done, creating a PR, or merging.

The 5 agents cover complementary concerns that together form a comprehensive review no single reviewer could match:

| # | Agent | Type | Focus |
|---|-------|------|-------|
| 1 | Goal Verifier | Oracle (read-only context) | Did we build what was asked? |
| 2 | QA Executor | Autonomous executor | Does it actually work when run? |
| 3 | Code Reviewer | Oracle (read-only context) | Is the code well-written? |
| 4 | Security Auditor | Oracle (read-only context) | Is it secure? |
| 5 | Context Miner | Autonomous executor | Did we miss any context? |

## Trigger Conditions

- User says "review work", "review my work", "review changes", "QA this"
- User says "verify implementation", "check my work", "validate changes"
- The work is a significant implementation, PR, or branch needing review
- The orchestrator's gate requires post-implementation review

## Required Context

- **GOAL**: The original objective from the user's request and any clarifications
- **CONSTRAINTS**: Rules, requirements, limitations (tech stack, performance, API contracts)
- **BACKGROUND**: Why this work was needed; business context, related systems
- **CHANGED_FILES**: Auto-collected via `git diff --name-only` against base
- **DIFF**: Auto-collected via `git diff` against base
- **FILE_CONTENTS**: Full content of every changed file (oracle agents cannot read files)
- **RUN_COMMAND**: How to start the app (from package.json, Makefile, or user)

Use a dedicated review worktree for PR/branch reviews: `git worktree add <path> <branch>`. The main worktree is read-only context; never checkout or edit the review branch there.

## Tool Access

- Full read access: Read, Grep, Glob, Bash (git, test runners, linters)
- The orchestrator spawns subagents via the WorkBuddy Agent tool
- Oracle subagents receive full context in their prompt (they cannot use filesystem tools)
- Autonomous subagents can read files, run commands, and use tools independently

## Step-by-Step Procedure

### Phase 0: Gather Review Context

1. Extract GOAL, CONSTRAINTS, BACKGROUND from conversation history (ask only if truly missing)
2. Collect CHANGED_FILES: `git diff --name-only HEAD~1` (or against appropriate base)
3. Collect DIFF: `git diff HEAD~1` (or against appropriate base)
4. Read FILE_CONTENTS for all changed files
5. Detect RUN_COMMAND from project manifests

### Phase 1: Launch All 5 Agents in Parallel

Launch ALL 5 in a single turn via the WorkBuddy Agent tool, each with `run_in_background=true`. No sequential launches. No waiting between them.

**Agent 1 — Goal & Constraint Verification (Oracle, read-only prompt context)**
Verify the implementation against the original goal and constraints. Check: goal completeness (every sub-requirement), constraint compliance, requirement gaps, over-engineering, edge cases (5+ traced), behavioral correctness (3+ scenarios). Output: verdict (PASS/FAIL), confidence (HIGH/MED/LOW), goal breakdown, constraint compliance, findings, blocking issues.

**Agent 2 — QA via App Execution (Autonomous executor)**
Run the application and verify through hands-on testing. Process: brainstorm 15-30 test scenarios (happy paths, boundary conditions, error paths, regression, state transitions), self-review and augment (add 5+ more), create task list (P0/P1/P2), execute systematically. Use the appropriate channel: WebFetch for HTTP surfaces, bash for CLI, Agent tool for browser testing. If the app cannot start (build failure), immediate FAIL.

**Agent 3 — Code Quality Review (Oracle, read-only prompt context)**
Senior staff engineer code review. Examine: correctness, pattern consistency, naming & readability, error handling, type safety, performance, abstraction level, testing, API design, tech debt. Categorize findings: CRITICAL (production bugs/data loss), MAJOR (should fix before merge), MINOR (improvement, not blocking), NITPICK (style). Output: verdict, confidence, findings with file:line references, blocking issues (CRITICAL + MAJOR).

**Agent 4 — Security Review (Oracle, read-only prompt context)**
Security engineer review. Examine: input validation, auth/authz bypass, secrets in code, data exposure, dependency CVEs, cryptography, path traversal, CORS/TLS, error leakage, supply chain. Categorize: CRITICAL/HIGH/MEDIUM/LOW/NONE. Output: verdict, severity, findings with risk+remediation, blocking issues (CRITICAL + HIGH).

**Agent 5 — Context Mining (Autonomous executor)**
Search all accessible sources for missed context. Search: git history (`git log`, `git blame`, commit messages), GitHub issues/PRs if `gh` CLI available, codebase cross-references (importers, config files, docs), and any available MCP channels. Output: verdict, confidence, sources searched, discovered context with impact (BLOCKING/IMPORTANT/FYI), missed requirements, blocking issues.

### Phase 2: Wait & Collect with Bounded Polling

After launching all 5 agents, wait for completions. Use `TaskOutput` to poll for results. Do not treat a timeout, ack-only reply, or empty result as PASS.

Track each lane independently:

| Agent | Verdict | Notes |
|-------|---------|-------|
| 1. Goal Verification | pending/PASS/FAIL/INCONCLUSIVE | |
| 2. QA Execution | pending/PASS/FAIL/INCONCLUSIVE | |
| 3. Code Quality | pending/PASS/FAIL/INCONCLUSIVE | |
| 4. Security | pending/PASS/FAIL/INCONCLUSIVE | |
| 5. Context Mining | pending/PASS/FAIL/INCONCLUSIVE | |

Do NOT deliver the final report until ALL 5 lanes reach a terminal state (PASS/FAIL/INCONCLUSIVE). If a lane is silent, send a follow-up; if still unfinished, mark INCONCLUSIVE and respawn a smaller agent for that lane (max 3 retries per lane). Do not spin in repeated wait cycles.

### Phase 3: Deliver Verdict

```
ALL 5 PASS → REVIEW PASSED
ANY FAIL → REVIEW FAILED — criteria not met
ANY INCONCLUSIVE and 0 FAIL → REVIEW INCONCLUSIVE — not approved
```

Compile the report: overall verdict, per-agent verdict table with confidence, aggregated blocking issues (deduplicated, prioritized), top 5-10 key findings grouped by theme, specific fix instructions in priority order (if FAILED).

## Expected Output Artifacts

1. Per-agent verdict with confidence score and findings
2. Aggregated final report with per-agent verdict table
3. Blocking issues list (deduplicated, prioritized, with file:line refs)
4. Fix instructions in priority order (if FAILED or INCONCLUSIVE)
5. All evidence redacted: no secrets, tokens, credentials, PII

## Verification Gates

1. All 5 agents launched in parallel (not sequentially)
2. All 5 lanes have a terminal verdict (PASS/FAIL/INCONCLUSIVE)
3. Every PASS has supporting evidence from the agent's output
4. INCONCLUSIVE lanes have been retried with max budget (3)
5. Retry budget honored: respawned smaller agents for missing deliverables
6. Final report includes all lanes with evidence

## Failure Behavior

- If a lane returns FAIL: record specific findings; do not merge or hand off
- If a lane is INCONCLUSIVE: retry with smaller agent (up to 3 times); if still inconclusive, record as not approved and emit the aggregate result
- If an agent times out or returns ack-only: do not count as PASS; follow up; if no deliverable after follow-up, mark INCONCLUSIVE
- If all lanes INCONCLUSIVE after full retry budget: emit REVIEW INCONCLUSIVE with per-lane status and retry count
- Redact secrets and PII before including any evidence in logs or reports

## Handoff Format

```
# Review Work — Final Report

## Overall Verdict: PASSED / FAILED / INCONCLUSIVE

| # | Review Area | Agent Type | Verdict | Confidence |
|---|------------|------------|---------|------------|
| 1 | Goal & Constraint Verification | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 2 | QA Execution | Autonomous | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 3 | Code Quality | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 4 | Security | Oracle | PASS/FAIL/INCONCLUSIVE | Severity |
| 5 | Context Mining | Autonomous | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |

## Blocking Issues
[Aggregated from all agents — deduplicated, prioritized]

## Key Findings
[Top 5-10 findings grouped by theme]

## Recommendations
[If FAILED: exactly what to fix, in priority order]
[If PASSED: non-blocking suggestions]
```

## WorkBuddy-Native Features

- **Agent tool:** All 5 subagents are spawned via the WorkBuddy Agent tool with `run_in_background=true`. Oracle agents receive full context in their prompt (TASK/DELIVERABLE/SCOPE/VERIFY). Autonomous agents receive goal, scope, and tool permissions. This replaces LazyCodex's `multi_agent_v1.spawn_agent` with `agent_type`.
- **TaskOutput:** Polling for subagent completions uses WorkBuddy's `TaskOutput` tool instead of LazyCodex's `multi_agent_v1.wait_agent`. Track spawned task IDs locally and poll with bounded cycles.
- **TaskCreate/TaskUpdate:** The orchestrator tracks progress via WorkBuddy's native task management. Each review lane is a separate task; status transitions are marked with TaskUpdate.
- **Worktree discipline:** Use `git worktree add` for isolated review workspaces. Review evidence is collected from the worktree path, not the main worktree. The `.lazyworkbuddy/` directory replaces LazyCodex's `.omo/` for review artifacts.
- **Browser testing:** QA Executor uses WebFetch for HTTP-visible surfaces and the WorkBuddy Agent tool with browser instructions for visual surfaces. This replaces LazyCodex's `browser:control-in-app-browser`.
- **Retry budget:** 3 retries per lane, tracked manually by the orchestrator. Each retry spawns a fresh, smaller `isolation: true` agent with only the missing deliverable.

---
_Adapted from LazyCodex review-work/SKILL.md. Preserved verbatim: the 5-agent taxonomy (Goal Verifier, QA Executor, Code Reviewer, Security Auditor, Context Miner), the ALL-MUST-PASS verdict logic, the Phase 0/1/2/3 procedure, the per-agent review checklists, the INCONCLUSIVE retry protocol. Adapted: `multi_agent_v1.spawn_agent` + `agent_type` → WorkBuddy Agent tool; `multi_agent_v1.wait_agent` → TaskOutput; `task(...)` / `call_omo_agent(...)` → WorkBuddy Agent tool with self-contained messages; `.omo/` → `.lazyworkbuddy/`; `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`; `browser:control-in-app-browser` → WebFetch + Agent tool browser; `fork_context: false` → `isolation: true`._
