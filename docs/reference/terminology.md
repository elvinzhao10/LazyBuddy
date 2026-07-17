# Terminology

| Term | Meaning |
| --- | --- |
| **Package readiness** | Evidence that copied package assets and local contracts are complete. It is not proof of live host loading or MCP connection. |
| **Host observation** | User-confirmed behavior in a new host session or host UI, such as a command/skill listing or MCP status. |
| **Local-first** | Prefer the lightest eligible local/read-only capability before remote or approval-sensitive work. |
| **Receipt-owned root** | A caller-selected tooling directory whose exact, unmodified contents match LazyBuddy's ownership receipt and may therefore be removed safely. |
| **Capability broker** | Task-scoped selector that chooses an eligible provider without persisting host registration or changing project dependencies. |
| **Provider** | Concrete implementation of a capability, such as ripgrep, ast-grep, LSP, CodeGraph, Context7, or Playwright. |
| **Explicit selection** | A user/agent decision required before remote egress, browser automation, provider costs, credentials/auth, or other approval-sensitive activity. |
| **CodeGraph** | Optional, pinned local architecture exploration with an explicit install/init/enable lifecycle. It is not automatic. |
| **`context-graph`** | Bundled grep-based heuristic MCP fallback; it is not semantic CodeGraph analysis. |
| **Remote export fragment** | A namespaced MCP configuration fragment printed for manual host-UI merge. It does not modify host configuration or include credentials. |
| **Manual-QA evidence** | An observable real-surface result used alongside appropriate automated checks; a green test suite alone does not prove every user-facing claim. |
| **Done claim** | A concise statement of outcome, changed files, commands/results, manual QA, cleanup, and remaining risks that an independent verifier can reproduce. |
| **Verification gate** | A workflow requirement that withholds completion until required evidence/review criteria pass. |
| **MCP lifecycle** | Declaration, host registration, connection, tool availability, and removal: distinct steps with distinct proof. |
| **Timeout status** | A bounded local check that exceeded its deadline; it is failure, never a pass or host-success claim. |
| **Package-built capability** | Behavior implemented and shipped by LazyBuddy, such as scripts, receipts, hook policy, or a local MCP server. |
| **Host-native capability** | Behavior owned by CodeBuddy or WorkBuddy, such as discovery, session lifecycle, marketplace state, connector launch, and credential storage. |
| **Base MCP declaration** | A package-shipped launcher entry; it becomes a usable endpoint only when a host starts and connects it. |
| **Tooling dependency** | A pinned local fallback placed only in a receipt-owned root, not a dependency added to the target project. |

Use [workflow playbooks](../04-workflow-playbooks.md) to choose a workflow,
[verification contract](verification-contract.md) to interpret checks,
[MCP lifecycle](../07b-mcp-lifecycle.md) for connection boundaries, and
[safe removal](../08-safe-removal.md) before deleting tooling.

## How to read these terms in the code

Start with **package readiness**, **host observation**, and **MCP lifecycle**
when following an install or connection path. Then use **receipt-owned**,
**tooling dependency**, and **host-native capability** to decide whether a
script may write or remove a path. Finally, use **evidence gate** and
**DoneClaim** when following a workflow to completion. This order mirrors the
implementation: package facts first, host boundaries second, and outcome
claims last.
