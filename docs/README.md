# Lazyworkbuddy Documentation

## Architecture

| Doc | Purpose |
|-----|---------|
| [architecture-plan.md](lazyworkbuddy-architecture-plan.md) | Three-layer model (Plugin / Project Memory / Run State), component map, data flow |
| [plugin-design.md](lazyworkbuddy-plugin-design.md) | Plugin directory layout, manifest fields, component list, install/uninstall |
| [state-ledger-design.md](lazyworkbuddy-state-ledger-design.md) | `.lazyworkbuddy/` schema, event format, checkpoint protocol |
| [state-schema.md](lazyworkbuddy-state-schema.md) | Full JSON schema with field descriptions |
| [versioned-execution-plan.md](lazyworkbuddy-versioned-execution-plan.md) | Per-version plan (v0.2–v0.12) with objectives, steps, verification |

## Protocols

| Doc | Purpose |
|-----|---------|
| [loop-protocol.md](lazyworkbuddy-loop-protocol.md) | Loop state machine, transitions, iteration caps |
| [verifier-protocol.md](lazyworkbuddy-verifier-protocol.md) | 9 check categories, discovery, pass/fail criteria |
| [reviewer-protocol.md](lazyworkbuddy-reviewer-protocol.md) | 7 review dimensions, accept/reject/revise decision tree |
| [librarian-protocol.md](lazyworkbuddy-librarian-protocol.md) | Memory update triggers, diff-before-write rule |
| [handoff-protocol.md](lazyworkbuddy-handoff-protocol.md) | Inter-agent message, evidence, and verdict formats |
| [parallelism-policy.md](lazyworkbuddy-parallelism-policy.md) | Parallelization rules, merge gates, max concurrency |
| [quality-gates.md](lazyworkbuddy-quality-gates.md) | 12 quality gates spanning the full workflow |

## Operations

| Doc | Purpose |
|-----|---------|
| [operating-manual.md](lazyworkbuddy-operating-manual.md) | Agent operating loop and escalation rules |
| [runbook.md](lazyworkbuddy-runbook.md) | How to operate a run manually |
| [run-log-template.md](lazyworkbuddy-run-log-template.md) | Required output format for every version |
| [hooks.md](lazyworkbuddy-hooks.md) | Hook inventory: events, scripts, behavior |
| [hook-test-plan.md](lazyworkbuddy-hook-test-plan.md) | Manual test procedures for each hook |
| [safety-gates.md](lazyworkbuddy-safety-gates.md) | 5 safety gate definitions |
| [permission-policy.md](lazyworkbuddy-permission-policy.md) | Deny/ask/allow model, PreToolUse enforcement |
| [security-and-permissions-plan.md](lazyworkbuddy-security-and-permissions-plan.md) | 9-agent permission matrix, 5-layer model |
| [checkpoint-format.md](lazyworkbuddy-checkpoint-format.md) | Checkpoint directory structure and recovery |

## Parity & Tracking

| Doc | Purpose |
|-----|---------|
| [parity-ledger.md](lazyworkbuddy-parity-ledger.md) | Living parity tracking vs LazyCodex |
| [known-gaps.md](lazyworkbuddy-known-gaps.md) | Documented deviations from LazyCodex |
| [risk-register.md](lazyworkbuddy-risk-register.md) | Ranked risks with mitigations |
| [verification-matrix.md](lazyworkbuddy-verification-matrix.md) | Every workflow mapped to verification path |
| [command-index.md](lazyworkbuddy-command-index.md) | Master index of all commands, skills, agents |
| [command-constitution.md](lazyworkbuddy-command-constitution.md) | Command design and composition |
| [agent-inventory.md](lazyworkbuddy-agent-inventory.md) | Table of all 13 agents |
| [agent-orchestration.md](lazyworkbuddy-agent-orchestration.md) | Full lifecycle flow diagram |

## MCP & Tools

| Doc | Purpose |
|-----|---------|
| [mcp-and-tools.md](lazyworkbuddy-mcp-and-tools.md) | MCP inventory: 8 servers, 30+ tools |
| [mcp-security.md](lazyworkbuddy-mcp-security.md) | MCP security model |
| [dashboard-design.md](lazyworkbuddy-dashboard-design.md) | Dashboard design (read-only) |

## Migration

| Doc | Purpose |
|-----|---------|
| [migration-planner.md](lazyworkbuddy-migration-planner.md) | 9-step migration workflow |
| [self-adapter.md](lazyworkbuddy-self-adapter.md) | How Lazyworkbuddy migrated LazyCodex into WorkBuddy |
| [migration-examples.md](lazyworkbuddy-migration-examples.md) | Example scenarios |
| [templates/](templates/) | 7 reusable templates for adapting to new hosts |

## Evaluation

| Doc | Purpose |
|-----|---------|
| [evaluation.md](../lazyworkbuddy-evaluation.md) | Full LazyCodex parity assessment: strengths, weaknesses, future improvements |
| [known-gaps.md](lazyworkbuddy-known-gaps.md) | 17 documented deviations from LazyCodex |
| [parity-ledger.md](lazyworkbuddy-parity-ledger.md) | Living parity tracking (per-method status) |
| [risk-register.md](lazyworkbuddy-risk-register.md) | Ranked risks with mitigations |

## Examples

| Doc | Purpose |
|-----|---------|
| [examples/](examples/) | Example run logs |
