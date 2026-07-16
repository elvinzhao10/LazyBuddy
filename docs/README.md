# Learning guide

LazyBuddy is a learning project for safe, evidence-led agent workflows on CodeBuddy and WorkBuddy. It is independently implemented and does not require LazyCodex or OmO at runtime. This is a source-reading guide: it explains the control flow, ownership boundaries, and tests behind the harness before it describes a host workflow.

> **Verification scope:** the documented package evidence is verified on macOS only. A package check is not proof that a host loaded a plugin, ran hooks, or connected MCP.

## Read the code in this order

1. Read [the package map](07-package-map.md) to locate executable components and boundaries.
2. Read [security and authority](06a-security-and-authority.md) and [receipts](06b-receipts-and-owned-tooling.md) to understand why the package refuses broad ownership.
3. Follow [state and validation](07a-state-and-validation.md) to see how plans, loops, evidence, and verification become durable records.
4. Follow [MCP lifecycle](07b-mcp-lifecycle.md) from a static declaration to a connected stdio tool without confusing either with host proof.
5. Read [test and release verification](09-test-and-release-verification.md) to see the difference between unit, package, protocol, and host evidence.

## Guide map

| Guide | Use it when |
| --- | --- |
| [00 — Learning path](00-learning-path.md) | You want the recommended reading and action order. |
| [01 — Mental model](01-mental-model.md) | You need to distinguish a task request, package evidence, and host evidence. |
| [02 — First task](02-first-task.md) | You are ready to ask for a small, concrete change. |
| [03 — Install and host verification](03-install-and-host-verification.md) | You need the exact package-check and host-proof boundary. |
| [04 — Workflow playbooks](04-workflow-playbooks.md) | Your task needs planning, debugging, review, or a durable loop. |
| [05 — Evidence and completion](05-evidence-and-completion.md) | You need to decide what is sufficient to call work complete. |
| [06 — Capabilities and approvals](06-capabilities-and-approvals.md) | You need optional local, remote, browser, or architecture capability details. |
| [06a — Security and authority](06a-security-and-authority.md) | You need secret-path, registry, explicit-root, and approval boundaries. |
| [06b — Receipts and owned tooling](06b-receipts-and-owned-tooling.md) | You need to understand limited ownership and removal receipts. |
| [07 — Package map](07-package-map.md) | You want to find skills, commands, agents, hooks, or MCP declarations. |
| [07a — State and validation](07a-state-and-validation.md) | You need state artifacts and bounded verifier statuses. |
| [07b — MCP lifecycle](07b-mcp-lifecycle.md) | You need declaration-to-removal and host-connection boundaries. |
| [08 — Safe removal](08-safe-removal.md) | You want to remove LazyBuddy without touching host-managed state. |
| [09 — Test and release verification](09-test-and-release-verification.md) | You need the five layers of evidence. |
| [10 — Host capability matrix](10-host-capability-matrix.md) | You need the CodeBuddy/WorkBuddy capability boundaries. |

Detailed lookup material lives in the [host routes](reference/host-routes.md), [state artifact reference](reference/state-artifact-reference.md), [MCP inventory](reference/mcp-inventory.md), [verification contract](reference/verification-contract.md), and [terminology](reference/terminology.md) references.

## The implementation loop

Skills and commands provide the policy text an agent sees. Agents provide
role-specific instructions. Hooks and MCP servers are narrow host/protocol
adapters. Scripts perform the actual local state transitions: creating
receipts, validating inventory, running a bounded verification check, and
emitting a machine-readable result. Tests exercise those layers independently
so a host-facing declaration is never mistaken for a live integration.

## What this guide does not claim

The included checks can establish **package readiness**: copied assets, declarations, inventories, and local contracts are present. They cannot establish marketplace activation, a new host session, SessionStart, hook execution, or a live MCP connection. Complete the applicable host observation before making an integration claim.
