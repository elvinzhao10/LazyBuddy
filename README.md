# Lazyworkbuddy

Lazyworkbuddy is a WorkBuddy-native recreation of the LazyCodex/OmO agent harness. It preserves the major LazyCodex workflows - project memory, planning, delegated execution, verification loops, review, and durable run state - on WorkBuddy plugin surfaces.

This is a clean-room adaptation. LazyCodex remains the canonical behavioral reference under `reference/lazycodex/`; Lazyworkbuddy reimplements the semantics with WorkBuddy Skills, Commands, Agents, Hooks, MCP servers, scripts, and docs.

## Release State

- Current phase: v0.12 diagnosis and release hardening.
- Package status: `runtime-verified` for the local v0.12 release gates recorded in `.omo/evidence/` and `.lazyworkbuddy/runs/dogfood-v0.12/`.
- Canonical current status: [docs/lazyworkbuddy-current-status.md](docs/lazyworkbuddy-current-status.md).
- Known gaps: [docs/lazyworkbuddy-known-gaps.md](docs/lazyworkbuddy-known-gaps.md).
- Final parity package: [docs/lazyworkbuddy-final-parity-report.md](docs/lazyworkbuddy-final-parity-report.md).

## What You Get

| Surface | Purpose | Current status source |
| --- | --- | --- |
| `lazyworkbuddy-plugin/skills/` | Workflow instructions for init, planning, start-work, loop, review, and supporting disciplines | [docs/lazyworkbuddy-command-index.md](docs/lazyworkbuddy-command-index.md) |
| `lazyworkbuddy-plugin/commands/` | WorkBuddy slash command entry points | [docs/lazyworkbuddy-command-index.md](docs/lazyworkbuddy-command-index.md) |
| `lazyworkbuddy-plugin/agents/` | Orchestrator, planner, implementer, verifier, reviewer, QA, librarian, and support agents | [docs/lazyworkbuddy-agent-orchestration.md](docs/lazyworkbuddy-agent-orchestration.md) |
| `lazyworkbuddy-plugin/hooks/` | 12 lifecycle hooks for rules, safety, continuation, evidence, and run tracking | [docs/lazyworkbuddy-hooks.md](docs/lazyworkbuddy-hooks.md) |
| `lazyworkbuddy-plugin/mcp/` | 8 MCP servers: 5 run-management additions and 3 context-tooling substitutes | [docs/lazyworkbuddy-mcp-and-tools.md](docs/lazyworkbuddy-mcp-and-tools.md) |
| `.lazyworkbuddy/` | Durable run state, checkpoints, evidence, and review outputs | [docs/lazyworkbuddy-loop-protocol.md](docs/lazyworkbuddy-loop-protocol.md) |

## Main Workflow

1. `/init-deep` builds project memory in `workbuddy.md` and `.workbuddy/rules/`.
2. `/ulw-plan` creates a decision-complete plan before multi-file work.
3. `/start-work` executes approved plan checkboxes through delegated workers and evidence gates.
4. `/ulw-loop` keeps open-ended goals tied to observable success criteria.
5. `/review-work` runs goal, QA, code, security, and context review lanes.
6. `/ultrawork` enables the strict evidence-bound mode for high-precision tasks.

## Quick Start

Use [docs/lazyworkbuddy-quickstart.md](docs/lazyworkbuddy-quickstart.md) for install, verification, first run, and uninstall steps.

Minimum local verification from this repository:

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh
```

Treat any stronger runtime claim as pending unless the relevant transcript is cited from `.omo/evidence/` or `.lazyworkbuddy/runs/`.

## Parity Posture

Lazyworkbuddy aims for source-backed workflow parity, not byte-for-byte runtime identity.

- `reference parity`: a LazyCodex source-backed behavior is preserved.
- `host-substitution`: WorkBuddy covers the use case through a different surface.
- `native-enhancement`: Lazyworkbuddy-only functionality improves WorkBuddy operation.
- `platform-gap`: the original LazyCodex surface is not directly portable or not needed on WorkBuddy.

The most important caveat is context tooling: `context-graph`, `code-intel`, and `docs` are useful host substitutions, but they are not full LazyCodex `codegraph`, `lsp`, or `context7` semantic parity.
