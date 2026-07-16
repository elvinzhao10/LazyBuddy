# Safe removal

Remove host-managed integration through its host, and remove package-owned
tooling only when its receipt proves ownership. These are separate operations.

## Remove by installation route

| Route | Safe action | Preserve |
| --- | --- | --- |
| CodeBuddy IDE or CLI plugin | Use the host plugin removal flow; remove or disable only LazyBuddy MCP servers that you manually registered. | Host installation paths, unrelated MCP entries, credentials, and host state. |
| WorkBuddy plugin/marketplace | Use WorkBuddy's documented remove flow and confirm the result in the host. | Host-managed plugin locations and `.workbuddy` state. |
| WorkBuddy local-import fallback | Remove imported `skills/` entries through Skills UI and manually configured connectors through Settings. | Other imported skills, connectors, and Settings entries. |
| Receipt-owned tooling root | Run the package uninstall command only for the exact owned root. | Modified, foreign, linked, caller-owned, project, global, and host-managed paths. |

For a package-owned tooling root:

```bash
bash scripts/lazybuddy-tooling.sh uninstall \
  --tooling-root /absolute/path/to/lazybuddy-tools
```

The command removes only an unmodified, receipt-owned installation. It checks
for an exact ownership receipt and owned contents; it does not use a path name
as proof of ownership. If a root is modified, linked, foreign, or caller-owned,
it is preserved rather than removed.

## What not to remove

Never guess or scan for host-managed installation paths. Do not delete
`.workbuddy` state, `.workbuddy-plugin` compatibility metadata, another host's
MCP configuration, project files, global tools, or credentials. Removing a
tooling root does not authorize removal of a plugin, marketplace installation,
MCP registration, or credential state.

CodeGraph follows the same boundary. Its uninstall removes only a project
index proven by the CodeGraph receipt, and preserves a pre-existing
`.codegraph/` directory. Then the normal tooling-root uninstall may remove the
remaining verified root.

## Confirm the result

Report package removal separately from the user's observed host result. After
using a host removal UI, confirm that the plugin/skills and manually configured
connectors are gone in that host. Only then may the copied repository be
deleted; it is independent of host removal and is not itself a host installer.

Read [host routes](reference/host-routes.md) for the exact boundaries,
[MCP lifecycle](07b-mcp-lifecycle.md) for the host-registration sequence, and
[receipts and owned tooling](06b-receipts-and-owned-tooling.md) for receipt
ownership and optional tooling.
