---
name: lazy-ulw-plan
description: "Strategic planning consultant. Produces one decision-complete work plan from vague or large requests. Explore-first, asks only genuine owner-decisions."
---

# ulw-plan

> **earlier host implementation source:** `local project documentation`

## Purpose

Turn a vague or large request into ONE **decision-complete** work plan a downstream worker executes with zero further interview. This is the Prometheus strategic planner — it reads, searches, runs read-only analysis, and writes ONLY plan artifacts under `.lazybuddy/plans/`. It is a PLANNER — it never edits product code and never implements.

**Plan mode is sticky.** "do X" / "fix X" / "build X" / "just do it" all mean "plan X". Execution begins only when the user explicitly starts it with `/lazy-start-work`.

## Trigger Conditions

- User says "plan", "ulw-plan", "design", "figure out how to build"
- Task involves 5+ steps, multiple files, or architecture decisions
- Task is ambiguous ("make auth better", "just make it good")
- User explicitly invokes `/lazy-ulw-plan "description"`

## Required Context

Before planning, inspect:
- `workbuddy.md` — project structure and conventions
- `plan/v0.<N>-*.md` — the current version spec if relevant
- Relevant source files in the codebase (Read, Grep, Glob)
- `local project documentation` if the task relates to earlier host implementation parity

## Tool Access

This skill is **read-only** — it NEVER writes product code.
- Allowed: Read, Grep, Glob, Bash (read-only), WebSearch, WebFetch
- Allowed for plan output: Write, Edit (ONLY to `.lazybuddy/plans/`)
- Disallowed: Write, Edit on any product path

## Step-by-Step Procedure

### 1. Ground in the codebase

Explore the relevant parts of the codebase before asking questions. Use Grep/Glob/Read to understand the current state. Run read-only analysis commands.

**Rule:** Discoverable facts → research and cite. Preferences/tradeoffs → the only things to ask. When unsure, treat as user-decision.

### 2. Classify intent

Make ONE judgment about whether the desired OUTCOME is clear:

- **CLEAR:** The user knows the outcome. Only open items are preferences/tradeoffs. Ask the surviving genuine forks.
- **UNCLEAR:** The outcome is fuzzy. Research maximally, adopt and ANNOUNCE best-practice defaults, do NOT ask extra questions.

**Announce the intent** to the user before proceeding.

### 3. Ask only blocking questions

Apply two filters to every candidate question:
1. Could collected evidence answer it? → explore instead.
2. Could a defensible default answer it? → adopt the default, record it, do not ask — UNLESS it is an owner-decision (irreversible, destructive, safety-critical, cross-cutting product choice).

### 4. Write the decision-complete plan

Write to `.lazybuddy/plans/<slug>.md` with:

```markdown
## TL;DR (For humans)

Brief summary of what this plan builds and why.

## TODOs

- [ ] T1: Discovery & scaffold (provisional: false, depends_on: [])
  - Acceptance: ...
  - QA: ...
  - Commit: ...

- [ ] T2: Billing integration (provisional: true, depends_on: T1, parent_plan_id: plan-x)
  - Acceptance: ...
  - QA: ...
  - Commit: ...

## Decision Gates

### G-billing-provider
- question: Which billing provider should the billing milestone integrate?
- recommendation: Provider X (existing contract, lowest integration cost).
- alternatives:
  - id: provider-x — Existing contract provider (Lower cost, fewer features)
  - id: provider-y — New provider (More features, new procurement)
- owner: product-owner
- affected_tasks: [billing-integration]
- needed_by: milestone-billing
- status: open   # stays open until a REAL answer — a recommendation never auto-approves
- assumptions: [Billing is the only consequential product decision surfaced now.]

## Final Verification Wave

- [ ] End-to-end scenario
- [ ] All tests pass
- [ ] Type check / lint clean
```

### Plan formatting rules (canonical)

- The task section heading MUST be `## TODOs` (canonical). Legacy plans may use
  `## Todos` — both are parsed; any other casing (e.g. `## todos`, `## TodOs`)
  is NOT recognised and will make the plan parse as zero tasks (a hard error).
- Each task checkbox SHOULD carry a canonical `T<n>:` id prefix, e.g. `- [ ] T1: ...`.
  Legacy `A<n>.` id prefixes are also accepted. The `Final Verification Wave`
  section may use id-less checkboxes.
- The verification section heading MUST be `## Final Verification Wave`.

### Milestone flags (v1.3.0 — progressive milestones)

Complex work uses ONE parent plan with milestones. Each task checkbox MAY carry
trailing milestone flags in parentheses (parsed and validated by `sync-plan-state.sh`):

- `provisional: true|false` — a provisional milestone and its tasks MUST NOT
  dispatch. The NEXT non-provisional milestone is executable; distant
  provisional milestones are intentionally not demanded upfront.
- `depends_on: T1,T2` — dependency links. Cycles, missing IDs, and dangling
  child links are rejected at sync time (the run fails visibly, never silently).
- `parent_plan_id: <plan-id>` — authoritative parent plan id for child plans.

### Decision gates (v1.3.0 — scoped gates)

Consequential product decisions are recorded as decision gates with the canonical
shape (see scenario fixture `canonical_formats.decision_gate`):

- required: `question`, `recommendation`, `alternatives`, `owner`, `needed_by`, `status`
- `alternatives` MUST include at least one NON-recommended option
- `status` ∈ {open, answered, blocked, superseded}
- **A recommendation NEVER becomes owner approval automatically** — `status`
  stays `open` until a real answer exists.
- Only tasks in `affected_tasks` (and their transitive dependents) block;
  independent work proceeds.

The plan must be **decision-complete** — the executor needs ZERO judgment calls.

### 5. Present the approval gate

Record `status: awaiting-approval`, present a short brief, then **wait for the user's explicit okay**. Read their next reply as a decision (approve / scope-change / still-unclear).

## Expected Output Artifacts

- `.lazybuddy/plans/<slug>.md` — the decision-complete work plan
- Each todo has: acceptance criteria, QA steps (with exact commands), commit message guidance
- Dependency matrix is consistent (independent tasks marked parallel; dependent tasks serialized)

## Verification Gates

1. Plan file exists and has all required sections (TL;DR, TODOs, Final Verification Wave)
2. Every todo has references + acceptance + QA + commit
3. No ambiguous instructions — implementer needs zero interviews
4. Approval gate recorded and presented

## Failure Behavior

- If exploration cannot resolve a genuine fork: ask the user (do not guess)
- If scope is too large for one plan: propose splitting into multiple plans
- If user changes scope mid-planning: restart from grounding phase
- If approval is denied: revise plan per user feedback; do not re-explore unless scope changed

## Handoff Format

When the plan is approved:
```
Plan ready: .lazybuddy/plans/<slug>.md
  - Todos: N checkboxes
  - Parallel lanes: M independent groups
  - Next: run /lazy-start-work <slug> to execute
```

## WorkBuddy-Native Features

- **Plan Mode:** This skill is compatible with WorkBuddy's Plan Mode for read-only planning
- **Subagent spawning:** Use WorkBuddy Agent tool for parallel exploration (explorer subagents with `isolation: true`)
- **`.lazybuddy/plans/`:** Plan output goes to WorkBuddy-native run state directory
- **Agent roles:** The planner subagent (v0.5) will embody this skill's discipline

---

_Adapted from earlier host implementation ulw-plan (Prometheus planner). Preserved: intent routing, explore-before-asking, owner-decision filter, approval gate, "never implements" rule. Adapted: `.lazybuddy/plans/` → `.lazybuddy/plans/`; `multi_agent_v1.spawn_agent` → WorkBuddy Agent tool; `<skill-root>/scripts/scaffold-plan.mjs` → inline plan generation (script in v0.8)._
