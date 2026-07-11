# LazyBuddy documentation

## Current v0.15 entrypoints

Use these documents to install, operate, or verify the current release:

| Document | Purpose |
| --- | --- |
| [Setup guide](../AGENTS.md) | Host-specific onboarding for CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy. |
| [User guide](../README.md) | Workflow selection and everyday use. |
| [Plugin guide](../lazybuddy-plugin/README.md) | Package layout, installation, and package-readiness checks. |
| [Command constitution](lazybuddy-command-constitution.md) | Current command model and invocation rules. |
| [Command index](lazybuddy-command-index.md) | Current command, skill, agent, hook, and MCP inventory. |
| [Hook inventory](lazybuddy-hooks.md) | Current hook declarations, behavior, and timeouts. |
| [Checkpoint format](lazybuddy-checkpoint-format.md) | Current checkpoint artifact format. |
| [Hook test plan](lazybuddy-hook-test-plan.md) | Manual validation for current hook declarations. |
| [State ledger design](lazybuddy-state-ledger-design.md) | Current run-state layout used by workflow skills. |

The current package declares six MCP servers. Its manifest and package checks are the source of truth for that registry.

## Historical records

All other files in this directory preserve earlier plans, prompts, designs, evaluations, migration notes, templates, and reports. They are retained for provenance and study only; they are not current operating instructions and must not be treated as a dependency of a v0.15 installation.

- `plan/` and `prompts/` contain historical versioned execution records.
- `templates/`, `examples/`, and the named design/protocol/report files capture prior work.
- The repository `NOTICE` and `LICENSE` are the authoritative legal and attribution records.
