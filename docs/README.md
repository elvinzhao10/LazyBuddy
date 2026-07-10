# LazyBuddy Documentation

## Architecture

| Doc | Purpose |
|-----|---------|
| [architecture-plan.md](lazybuddy-architecture-plan.md) | Three-layer model (Plugin / Project Memory / Run State), component map, data flow |
| [plugin-design.md](lazybuddy-plugin-design.md) | Plugin directory layout, manifest fields, component list, install/uninstall |
| [state-ledger-design.md](lazybuddy-state-ledger-design.md) | `.lazybuddy/` schema, event format, checkpoint protocol |
| [state-schema.md](lazybuddy-state-schema.md) | Full JSON schema with field descriptions |
| [versioned-execution-plan.md](lazybuddy-versioned-execution-plan.md) | Per-version plan (v0.2–v0.12) with objectives, steps, verification |

## Protocols

| Doc | Purpose |
|-----|---------|
| [loop-protocol.md](lazybuddy-loop-protocol.md) | Loop state machine, transitions, iteration caps |
| [verifier-protocol.md](lazybuddy-verifier-protocol.md) | 9 check categories, discovery, pass/fail criteria |
| [reviewer-protocol.md](lazybuddy-reviewer-protocol.md) | 7 review dimensions, accept/reject/revise decision tree |
| [librarian-protocol.md](lazybuddy-librarian-protocol.md) | Memory update triggers, diff-before-write rule |
| [handoff-protocol.md](lazybuddy-handoff-protocol.md) | Inter-agent message, evidence, and verdict formats |
| [parallelism-policy.md](lazybuddy-parallelism-policy.md) | Parallelization rules, merge gates, max concurrency |
| [quality-gates.md](lazybuddy-quality-gates.md) | 12 quality gates spanning the full workflow |

## Operations

| Doc | Purpose |
|-----|---------|
| [operating-manual.md](lazybuddy-operating-manual.md) | Agent operating loop and escalation rules |
| [runbook.md](lazybuddy-runbook.md) | How to operate a run manually |
| [run-log-template.md](lazybuddy-run-log-template.md) | Required output format for every version |
| [hooks.md](lazybuddy-hooks.md) | Hook inventory: events, scripts, behavior |
| [hook-test-plan.md](lazybuddy-hook-test-plan.md) | Manual test procedures for each hook |
| [safety-gates.md](lazybuddy-safety-gates.md) | 5 safety gate definitions |
| [permission-policy.md](lazybuddy-permission-policy.md) | Deny/ask/allow model, PreToolUse enforcement |
| [security-and-permissions-plan.md](lazybuddy-security-and-permissions-plan.md) | 9-agent permission matrix, 5-layer model |
| [checkpoint-format.md](lazybuddy-checkpoint-format.md) | Checkpoint directory structure and recovery |

## Parity & Tracking

| Doc | Purpose |
|-----|---------|
| [parity-ledger.md](lazybuddy-parity-ledger.md) | Living parity tracking vs LazyCodex |
| [known-gaps.md](lazybuddy-known-gaps.md) | Documented deviations from LazyCodex |
| [risk-register.md](lazybuddy-risk-register.md) | Ranked risks with mitigations |
| [verification-matrix.md](lazybuddy-verification-matrix.md) | Every workflow mapped to verification path |
| [command-index.md](lazybuddy-command-index.md) | Master index of all commands, skills, agents |
| [command-constitution.md](lazybuddy-command-constitution.md) | Command design and composition |
| [agent-inventory.md](lazybuddy-agent-inventory.md) | Table of all 13 agents |
| [agent-orchestration.md](lazybuddy-agent-orchestration.md) | Full lifecycle flow diagram |

## MCP & Tools

| Doc | Purpose |
|-----|---------|
| [mcp-and-tools.md](lazybuddy-mcp-and-tools.md) | MCP inventory: 8 servers, 30+ tools |
| [mcp-security.md](lazybuddy-mcp-security.md) | MCP security model |
| [dashboard-design.md](lazybuddy-dashboard-design.md) | Dashboard design (read-only) |

## Migration

| Doc | Purpose |
|-----|---------|
| [migration-planner.md](lazybuddy-migration-planner.md) | 9-step migration workflow |
| [self-adapter.md](lazybuddy-self-adapter.md) | How LazyBuddy migrated LazyCodex into WorkBuddy |
| [migration-examples.md](lazybuddy-migration-examples.md) | Example scenarios |
| [templates/](templates/) | 7 reusable templates for adapting to new hosts |

## Evaluation

| Doc | Purpose |
|-----|---------|
| [evaluation.md](../lazybuddy-evaluation.md) | Full LazyCodex parity assessment: strengths, weaknesses, future improvements |
| [known-gaps.md](lazybuddy-known-gaps.md) | 17 documented deviations from LazyCodex |
| [parity-ledger.md](lazybuddy-parity-ledger.md) | Living parity tracking (per-method status) |
| [risk-register.md](lazybuddy-risk-register.md) | Ranked risks with mitigations |

## Examples

| Doc | Purpose |
|-----|---------|
| [examples/](examples/) | Example run logs |
