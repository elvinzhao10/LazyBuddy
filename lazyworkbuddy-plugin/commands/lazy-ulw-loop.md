---
description: "Verified completion loop for open-ended tasks. Creates goals with binding success criteria, decomposes into evidence-bound steps, runs until all criteria have real-surface proof. Manages goal state in .lazyworkbuddy/ulw-loop/."
---

# /lazy-ulw-loop

Verified completion loop for open-ended tasks. Creates binding goals with success criteria, decomposes into evidence-bound steps, and iterates until every criterion has verified proof. Delegates implementation waves to `/lazy-start-work` when needed.

## Usage

```
/lazy-ulw-loop "task" [--completion-promise=TEXT] [--strategy=reset|continue]
```

## Inputs

- Task description (natural language)
- Completion promise (binding success criteria, optional)
- Strategy: `reset` (fresh start) or `continue` (resume from `.lazyworkbuddy/ulw-loop/` state)
- Workspace context via `workbuddy.md`

## Outputs

- `.lazyworkbuddy/ulw-loop/goals.json` — binding success criteria
- `.lazyworkbuddy/ulw-loop/evidence.jsonl` — per-goal evidence log
- Completed work artifacts (via delegated `/lazy-start-work` waves)
- Final evidence report showing every criterion met

## Success Criteria

1. All success criteria have verified evidence
2. Evidence is self-contained (another agent can re-verify from the evidence alone)
3. No evidence claim without an observed value
4. Iteration cap respected (100 normal, 500 ultrawork)

## Constitution

Link to command constitution: `../../docs/lazyworkbuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/lazy-ulw-loop/SKILL.md` for the full workflow logic, goal creation protocol, evidence binding rules, and iteration management.
