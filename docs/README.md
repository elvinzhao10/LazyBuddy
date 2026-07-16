# Learn LazyBuddy

LazyBuddy is a learning project for safe, evidence-led agent workflows on CodeBuddy and WorkBuddy. It is independently implemented and does not require LazyCodex or OmO at runtime. This guide starts with the smallest useful task, then separates what the copied package can check from what a real host session must prove.

> **Verification scope:** the documented package evidence is verified on macOS only. A package check is not proof that a host loaded a plugin, ran hooks, or connected MCP.

## Start here

1. Follow the [learning path](00-learning-path.md) for the shortest route.
2. Read the [mental model](01-mental-model.md) to understand the evidence boundary.
3. Try a [first task](02-first-task.md).
4. Before relying on integrations, complete [installation and host verification](03-install-and-host-verification.md).

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
| [07 — Package map](07-package-map.md) | You want to find skills, commands, agents, hooks, or MCP declarations. |
| [08 — Safe removal](08-safe-removal.md) | You want to remove LazyBuddy without touching host-managed state. |

Detailed lookup material lives in the [host routes](reference/host-routes.md), [verification contract](reference/verification-contract.md), and [terminology](reference/terminology.md) references.

## What this guide does not claim

The included checks can establish **package readiness**: copied assets, declarations, inventories, and local contracts are present. They cannot establish marketplace activation, a new host session, SessionStart, hook execution, or a live MCP connection. Complete the applicable host observation before making an integration claim.
