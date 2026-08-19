# Technical architecture guide

This tree explains how LazyBuddy is built. It is a source-reading guide, not
an installation manual: each page names the executable boundary, the data it
owns, and the evidence that constrains its behavior. Use the root
[README](../README.md) for host directions.

## System at a glance

```mermaid
flowchart TD
    Host["CodeBuddy / WorkBuddy host"] --> Surface["skills, commands, agents"]
    Host --> Hooks["structured hook events"]
    Host --> MCP["local stdio MCP declarations"]
    Surface --> Scripts["package scripts"]
    Hooks --> Scripts
    Scripts --> State["run state + evidence"]
    Scripts --> Tooling["receipt-owned local tooling"]
    MCP --> State
    Scripts --> Evidence["bounded verification results"]
    Host -. host-owned .-> HostState["marketplace, credentials, live connections"]
```

The host loads integrations; `lazybuddy-plugin/` supplies their definitions.
Scripts and MCP endpoints operate only on their defined package/project
boundaries. Host state is deliberately outside those boundaries.

## Read the implementation in this order

1. [00 — Architecture tour](00-learning-path.md) identifies the package
   boundary and the request-to-evidence path.
2. [01 — Execution model](01-mental-model.md) explains workflow text, agents,
   hooks, scripts, and proof as separate layers.
3. [07 — Package map](07-package-map.md) maps those layers to files; follow it
   with [07a — State and validation](07a-state-and-validation.md) and
   [07b — MCP lifecycle](07b-mcp-lifecycle.md).
4. [06a — Security and authority](06a-security-and-authority.md) and
   [06b — Receipts and owned tooling](06b-receipts-and-owned-tooling.md)
   explain why the package refuses broad discovery and deletion.
5. [09 — Test and release verification](09-test-and-release-verification.md)
   connects unit, package, protocol, and host evidence.

## Technical map

| Page | Implementation question answered |
| --- | --- |
| [00 — Architecture tour](00-learning-path.md) | Which component receives an event, and where does its result go? |
| [01 — Execution model](01-mental-model.md) | Why are instructions, execution, state, and proof distinct layers? |
| [02 — Request decomposition](02-first-task.md) | How does an outcome become acceptance criteria and a proof surface? |
| [03 — Package delivery](03-install-and-host-verification.md) | What does copying a package establish, and what does it not establish? |
| [04 — Workflow playbooks](04-workflow-playbooks.md) | How do skills, commands, and agent roles encode proportional workflow policy? |
| [05 — Evidence and completion](05-evidence-and-completion.md) | How are checks, statuses, timeouts, and completion claims kept honest? |
| [06 — Capabilities and approvals](06-capabilities-and-approvals.md) | How does local-first capability selection avoid persistent mutation? |
| [06a — Security and authority](06a-security-and-authority.md) | Which inputs, paths, registries, and user decisions are trusted? |
| [06b — Receipts and owned tooling](06b-receipts-and-owned-tooling.md) | How does tooling record and later prove limited ownership? |
| [07 — Package map](07-package-map.md) | Which source directories implement each runtime surface? |
| [07a — State and validation](07a-state-and-validation.md) | Which artifacts are durable, validated, and safe to mutate? |
| [07b — MCP lifecycle](07b-mcp-lifecycle.md) | How does a declaration become a JSON-RPC process without becoming host proof? |
| [08 — Safe removal](08-safe-removal.md) | Why does removal stop at package-owned paths? |
| [09 — Test and release verification](09-test-and-release-verification.md) | What does each release gate prove? |
| [10 — Host capability matrix](10-host-capability-matrix.md) | Where do CodeBuddy and WorkBuddy intentionally diverge? |
| `RELEASE_NOTES-v1.1.0.md` | Current route, readiness, migration, security, and removal boundaries at the repository root. |
| [v1.0.3 migration guide](v1.0.3-migration-guide.md) | Historical guide to durable onboarding, update confirmation, runtime refresh, and scoped offboard. |

The lookup tables in [state artifact reference](reference/state-artifact-reference.md),
[MCP inventory](reference/mcp-inventory.md), [verification contract](reference/verification-contract.md),
[host routes](reference/host-routes.md), and [terminology](reference/terminology.md)
provide the concrete artifacts and vocabulary used by these explanations.

For the full split between package-built functions, receipt-owned dependencies,
optional providers, and raw host capabilities, read the [dependency and host
boundary reference](reference/dependency-and-host-boundaries.md).

For a complete source-family index, including hooks, loop state, helper
libraries, provider lifecycle, and release checks, read the [runtime subsystem
reference](reference/runtime-subsystems.md).
