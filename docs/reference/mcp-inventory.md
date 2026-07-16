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
