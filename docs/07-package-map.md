# Package map

LazyBuddy is a self-contained workflow harness for CodeBuddy IDE, CodeBuddy
CLI, and WorkBuddy. It is independently implemented and does not require
LazyCodex or OmO at runtime.

| Component | Inventory | Purpose and boundary |
| --- | ---: | --- |
| `skills/` | 14 | Portable workflow instructions; CodeBuddy content and verified WorkBuddy local-import source. |
| `commands/` | 14 | Current slash-command workflows in CodeBuddy; WorkBuddy only after a verified plugin/marketplace session. |
| `agents/` | 13 | Role definitions for planning, implementation, research, QA, review, security, and verification. |
| `hooks/hooks.json` | 12 | CodeBuddy hook-event declarations; WorkBuddy behavior requires a verified plugin/marketplace session. |
| `mcp/` and `.mcp.json` | 6 | Local MCP declarations for CodeBuddy; WorkBuddy fallback uses manual connector configuration. |
| `scripts/` | — | State, hook, loop, tooling, and validation utilities. |
| `templates/AGENTS.md` | — | Reusable onboarding template, not proof that an installer generated it. |

## Roles and events

The 13 agents are `lazybuddy-context-indexer`, `lazybuddy-context-miner`,
`lazybuddy-explorer`, `lazybuddy-gate-reviewer`, `lazybuddy-implementer`,
`lazybuddy-librarian`, `lazybuddy-migration-planner`,
`lazybuddy-orchestrator`, `lazybuddy-planner`, `lazybuddy-qa-executor`,
`lazybuddy-reviewer`, `lazybuddy-security-auditor`, and `lazybuddy-verifier`.

The 12 hook events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `PostToolUseFailure`, `PreCompact`, `Stop`, `StopFailure`,
`TaskCreated`, `TaskCompleted`, `SubagentStart`, and `SubagentStop`. A declared
hook is package inventory, not evidence that a host invoked it.

## Local MCP inventory

The six bundled local MCP declarations are `run-ledger`, `verification`,
`status-dashboard`, `context-graph`, `code-intel`, and `docs`. Context7 and
`grep_app` are optional remote export fragments, not bundled servers.
Filesystem and Playwright are also not part of this six-server inventory.

The `context-graph` endpoint is a clearly labelled grep-based heuristic
fallback. It must not be represented as CodeGraph semantic analysis.

## Where components run

CodeBuddy uses its plugin flow and can expose the commands, agents, hooks, and
MCP declarations after the user verifies a new session. WorkBuddy plugin or
marketplace behavior is live-session evidence, not copied-repository evidence.
The verified no-package-manager WorkBuddy path is to import `skills/` locally
and configure compatible MCP connectors manually. See [host routes](reference/host-routes.md).

The package's inventory and contracts can be checked locally, but they do not
prove host discovery, marketplace activation, SessionStart, hook execution, or
MCP connection. See [evidence and completion](05-evidence-and-completion.md)
for the correct claims to make.

Next: see [capabilities and approvals](06-capabilities-and-approvals.md) or
the [verification contract](reference/verification-contract.md).
