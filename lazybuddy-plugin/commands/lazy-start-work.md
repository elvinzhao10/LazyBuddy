---
description: "Orchestrate plan execution. Reads a plan, creates bootstrap state in .lazybuddy/runs/, decomposes into sub-tasks, spawns worker subagents via WorkBuddy Agent tool, verifies evidence, marks progress. Root agent is orchestrator only — never implements directly."
---

# /lazy-start-work

Orchestrate plan execution. The orchestrator reads a plan, bootstraps run state, decomposes work into sub-tasks, spawns worker subagents, verifies their DoneClaims, and marks progress. The orchestrator never implements product code directly.

## Usage

```
/lazy-start-work [plan-name] [--worktree <path>]
```

## Inputs

- Plan file from `.lazybuddy/plans/<slug>.md` (or no-plan bootstrap)
- Workspace context and project state
- Run state from `.lazybuddy/runs/<run_id>/state.json` (continuation mode)

## Outputs

- `.lazybuddy/runs/<run_id>/state.json` — bootstrap state with checkpoints
- `.lazybuddy/runs/<run_id>/events.jsonl` — evidence ledger
- Completed implementation artifacts (via worker subagents)
- Final verification report

## Success Criteria

1. All plan checkboxes marked done
2. Every DoneClaim verified by an independent verifier subagent
3. Final verification gate passed
4. Global review gate passed (5-agent review, all PASS)
5. Prints `ORCHESTRATION COMPLETE`

## Coupled worker exception

Independent work remains split and parallel. Assign one worker an explicitly
enumerated coupled file/test bundle only when a shared mutable interface, atomic
fixture, or invalid intermediate state makes a split unsafe. Its dispatch record
must include `coupled: true`, the reason, exact checkbox/file scope, and why
parallel decomposition is unsafe. Coupling is not for convenience, capacity, or
generic multi-file work; it never permits root product edits or bypasses tests,
Manual-QA, adversarial QA, independent verifier confirmation, or final review.

## Constitution

This command is governed by its package-local skill contract below.

Do not claim completion without verification.

## Skill

See `../skills/lazy-start-work/SKILL.md` for the full workflow logic, Sisyphus completion contract, subagent orchestration pattern, and evidence verification protocol.
