---
description: "Create a decision-complete work plan. Prometheus planner mode — explores, researches, writes a plan to .lazybuddy/plans/. Never writes product code. Produces plans consumed by /lazy-start-work."
---

# /lazy-ulw-plan

Create a decision-complete work plan. The planner explores the codebase, researches unknowns, evaluates alternatives, and writes a structured plan. Never writes product code — planning only.

## Usage

```
/lazy-ulw-plan "what to build"
```

## Inputs

- User's build request (natural language description)
- Workspace context (`workbuddy.md`, project structure, existing plans)
- Codebase state (via explorer subagents)

## Outputs

- Plan file written to `.lazybuddy/plans/<slug>.md`
- Decision log with alternatives considered and rationale
- Task decomposition with dependency graph

## Success Criteria

1. Plan file written and self-contained
2. Every decision has a documented rationale
3. Task decomposition is granular and dependency-ordered
4. Approval gate presented (awaits user "approved" or `/lazy-start-work`)

## Constitution

Link to command constitution: `../../docs/lazybuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/lazy-ulw-plan/SKILL.md` for the full workflow logic, exploration phases, decision framework, and Prometheus planner constraints.
