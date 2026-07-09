---
description: "Orchestrate plan execution. Reads a plan, creates bootstrap state in .lazyworkbuddy/runs/, decomposes into sub-tasks, spawns worker subagents via WorkBuddy Agent tool, verifies evidence, marks progress. Root agent is orchestrator only — never implements directly."
---

# /start-work

Orchestrate plan execution. The orchestrator reads a plan, bootstraps run state, decomposes work into sub-tasks, spawns worker subagents, verifies their DoneClaims, and marks progress. The orchestrator never implements product code directly.

## Usage

```
/start-work [plan-name] [--worktree <path>]
```

## Inputs

- Plan file from `.lazyworkbuddy/plans/<slug>.md` (or no-plan bootstrap)
- Workspace context and project state
- Run state from `.lazyworkbuddy/runs/<run_id>/state.json` (continuation mode)

## Outputs

- `.lazyworkbuddy/runs/<run_id>/state.json` — bootstrap state with checkpoints
- `.lazyworkbuddy/runs/<run_id>/events.jsonl` — evidence ledger
- Completed implementation artifacts (via worker subagents)
- Final verification report

## Success Criteria

1. All plan checkboxes marked done
2. Every DoneClaim verified by an independent verifier subagent
3. Final verification gate passed
4. Global review gate passed (5-agent review, all PASS)
5. Prints `ORCHESTRATION COMPLETE`

## Constitution

Link to command constitution: `../../docs/lazyworkbuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/start-work/SKILL.md` for the full workflow logic, Sisyphus completion contract, subagent orchestration pattern, and evidence verification protocol.
