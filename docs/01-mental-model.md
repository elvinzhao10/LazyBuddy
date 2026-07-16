# Mental model

LazyBuddy helps turn a request into a scoped change and evidence that the requested result works. It is not a replacement for the host: CodeBuddy and WorkBuddy remain responsible for loading plugins, running hooks, and connecting MCP servers.

## A task has three parts

1. **Outcome** — what should be true when the task is done.
2. **Acceptance criteria** — the observable behaviors or constraints that decide whether the outcome is acceptable.
3. **Proof surface** — where the behavior will be checked: a test suite, CLI, API, page, or a host session.

For example: “Add project search. It must work on a real project, have tests, and be checked in the user interface.” The [first-task guide](02-first-task.md) turns that into a practical request.

## Two different kinds of evidence

**Package readiness** is evidence about copied package contents and contracts: manifests, component inventories, local MCP declarations, and tooling policy. The package readiness script can report `PACKAGE_READINESS=full`; doctor and aggregate checks add package-health evidence. See the exact contract in [verification contract](reference/verification-contract.md).

**Host proof** is evidence from the selected host. It requires a new session or applicable host UI observation: a loaded LazyBuddy command or skill and the relevant MCP status. It is the only evidence that supports a claim that the integration is active. The required observation varies by host; see [host routes](reference/host-routes.md).

Package evidence does **not** prove marketplace installation, plugin discovery, SessionStart, hook execution, a running host session, or a live MCP connection. This distinction matters especially because the published verification scope is macOS only.

## Use the smallest capable workflow

Ask normally for a small, clear task. Request a plan for ambiguity or broad work, debugging for a failure, review for material risk, and a durable loop only for a long-running goal. The [workflow playbooks](04-workflow-playbooks.md) explain those choices; [terminology](reference/terminology.md) defines the terms used across this guide.

## Capabilities are separate decisions

Routine local discovery may use a suitable local capability without creating a persistent host registration. Optional remote, browser, or architecture work has explicit approval and lifecycle boundaries. Learn those boundaries in [capabilities and approvals](06-capabilities-and-approvals.md) and [security and authority](06a-security-and-authority.md) before opting in. Receipts establish limited ownership, not host authority; see [receipts and owned tooling](06b-receipts-and-owned-tooling.md).
