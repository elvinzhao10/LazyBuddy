# Request decomposition

The workflow layer converts an open-ended request into three durable concepts: an outcome, acceptance criteria, and a proof surface. The package does not parse product intent automatically; skills and agents make these concepts explicit so later state and verification have something concrete to reference.

## Input shape

An effective workflow request has this conceptual shape:

```text
outcome: what changes for the user
constraints: scope, safety, compatibility, ownership limits
acceptance criteria: observable pass/fail conditions
proof surface: test, CLI, API, browser, or host session
```

`skills/lazy-ulw-plan/` teaches the planning role to preserve uncertainty as a decision rather than silently inventing it. `skills/lazy-start-work/` assumes that a plan has already identified the acceptance criteria. This is why planning and execution are separate files and separate host actions.

## From request to records

The state helpers under `scripts/state/` provide the persistence layer for the workflow: a run contains tasks, checkpoints, events, and evidence references. The loop helpers operate on that state rather than trying to infer current work from the latest chat message. A verifier can therefore inspect the claimed outcome, named checks, and recorded result independently.

## Proof surface selection

The proof surface is intentionally not always a test suite. A library change may be proved by tests; a command requires a command invocation; a UI needs a visual/user interaction check; a host integration requires host observation. The workflow text only directs that selection. The executable verifier records package-local checks, while the person or host supplies the final surface observation.

See [Workflow playbooks](04-workflow-playbooks.md) for policy roles and [State and validation](07a-state-and-validation.md) for the persisted representation.
