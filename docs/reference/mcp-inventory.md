# MCP inventory

The copied package declares six local MCP servers in `.mcp.json`. A declaration
is package evidence only; registration, connection, and exposed tool
availability must be observed in the selected host.

| Declaration | Local role | Important boundary |
| --- | --- | --- |
| `run-ledger` | Run/evidence ledger access. | Does not prove a host launched it. |
| `verification` | Local verification information. | Result scope remains package/local. |
| `status-dashboard` | Local status dashboard. | Dashboard state is not host proof. |
| `context-graph` | Grep-based context heuristic. | Not semantic CodeGraph analysis. |
| `code-intel` | Local code-intelligence bridge. | Read-only capability; host availability is separate. |
| `docs` | Registry package-documentation resolver. | Fixed npm/PyPI registry requests only; no metadata URL fetches or redirects. |

The `docs` server validates package names and requests only
`registry.npmjs.org` or `pypi.org` over HTTPS. It may return registry metadata
such as homepage text, but never follows a homepage, repository, or docs URL.
Context7 and `grep_app` are optional remote export fragments. Filesystem and
Playwright are not bundled local MCP servers.

For declaration-to-removal sequence, read [MCP lifecycle](../07b-mcp-lifecycle.md).
For host routes, read [host routes](host-routes.md).

## Server implementation and data boundary

| Server | Launcher/runtime | Local data or operation | Important limitation |
| --- | --- | --- | --- |
| `run-ledger` | `mcp/run-ledger/server.sh` | Creates/reads run state, events, tasks, and checkpoints through `scripts/state/`. | Run IDs and paths are validated; it is not a general file writer. |
| `verification` | `mcp/verification/server.sh` | Reads verification matrix, records gate events, creates repair tasks, summarizes state. | It records and classifies checks; it does not prove a host executed a feature. |
| `status-dashboard` | `mcp/status-dashboard/server.sh` | Calculates run/task/gate summaries from local state. | A rendered status is not a completion or host-integration claim. |
| `context-graph` | `mcp/context-graph/server.py` | Runs `rg`/`grep` heuristics for imports, symbols, references, and overview. | Comments/strings and language syntax can produce approximate results. |
| `code-intel` | `mcp/code-intel/server.py` | Provides package-local code-intelligence helpers. | It remains local/read-only; semantic LSP availability is separate. |
| `docs` | `mcp/docs/server.py` | Validates a package name and fetches fixed npm/PyPI registry metadata. | No arbitrary URL, redirect, homepage, or repository fetch. |

All servers follow a line-oriented JSON-RPC pattern: parse one input line,
return a JSON-RPC result/error on stdout, and continue with the next line after
malformed input. Their launchers find the package root and `exec` only the
local endpoint. They do not install dependencies, register host connectors, or
store credentials.
