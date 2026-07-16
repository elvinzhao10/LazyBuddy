# MCP lifecycle

An MCP declaration is not a connection. Treat the lifecycle as five distinct
steps, each with a different owner and proof requirement.

1. **Declaration:** the copied package contains six local declarations in
   `.mcp.json`.
2. **Host registration:** CodeBuddy uses its plugin flow; WorkBuddy's local
   fallback requires manual compatible-connector configuration in Settings.
3. **Connection:** the host starts and connects the server in a new session.
4. **Tool availability:** the connected host reports the tools it exposes.
5. **Removal:** remove host-managed registrations through that host and remove
   receipt-owned tooling only through its ownership check.

Package checks can validate step 1 and exercise local JSON-RPC behavior. They
cannot prove steps 2–4. A successful local server process is not a claim that
CodeBuddy or WorkBuddy connected it.

## The six local declarations

`run-ledger`, `verification`, `status-dashboard`, `context-graph`,
`code-intel`, and `docs` are the bundled declarations. Context7 and `grep_app`
are optional remote export fragments, while filesystem and Playwright are not
part of this six-server inventory. Exact tool and boundary details are in
[MCP inventory](reference/mcp-inventory.md).

## Host-specific route

CodeBuddy may expose the package declarations after its plugin flow and a new
session; observe the command/skill and MCP status in that session. WorkBuddy
plugin or marketplace behavior needs its own live-session observation. The
verified WorkBuddy fallback is narrower: import local skills, then configure
each compatible connector manually. It does not establish CodeBuddy feature
parity.

For the proof boundary, see [host routes](reference/host-routes.md); for safe
removal, see [safe removal](08-safe-removal.md).
