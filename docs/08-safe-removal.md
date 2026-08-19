# Safe removal

Remove host-managed integration through its host, and remove package-owned
tooling only when its receipt proves ownership. These are separate operations.

## v1.1.0 route removal boundary

For `codebuddy-cli`, `codebuddy-ide`, and `workbuddy`, remove only LazyBuddy
entries through the selected host UI or documented host command. Preserve
credentials, trust decisions, unrelated plugins and connectors, project files,
and host-private paths. Marketplace is the default full-plugin route for
CodeBuddy IDE and WorkBuddy; Skills/manual MCP is recovery-only and mutually
exclusive with the full-plugin route. A package result does not prove a live
host was removed.

## Remove by installation route

| Route | Safe action | Preserve |
| --- | --- | --- |
| CodeBuddy IDE or CLI plugin | Use the host plugin removal flow; remove or disable only LazyBuddy MCP servers that you manually registered. | Host installation paths, unrelated MCP entries, credentials, and host state. |
| WorkBuddy plugin/marketplace | Use the emitted marketplace removal receipt with WorkBuddy's remove flow and confirm the result in the host. | Host-managed plugin locations, modified assets, and `.workbuddy` state. |
| WorkBuddy local-import fallback | Only after full-plugin removal, remove receipt-owned unmodified imported `skills/` entries through Skills UI and manually configured connectors through Settings. | Other or modified skills, connectors, and Settings entries. |
| Receipt-owned tooling root | Run the package uninstall command only for the exact owned root. | Modified, foreign, linked, caller-owned, project, global, and host-managed paths. |

For a package-owned tooling root:

```bash
bash scripts/lazybuddy-tooling.sh uninstall \
  --tooling-root "/absolute/path/to/lazybuddy-tools"
```

The command removes only an unmodified, receipt-owned installation. It checks
for an exact ownership receipt and owned contents; it does not use a path name
as proof of ownership. If a root is modified, linked, foreign, or caller-owned,
it is preserved rather than removed.

## What not to remove

Never guess or scan for host-managed installation paths. Do not delete
`.workbuddy` state, `.workbuddy-plugin` marketplace metadata, another host's
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

## Removal decision flow

```mermaid
flowchart TD
    Request["requested removal"] --> Scope["identify package, tooling, or host scope"]
    Scope --> Owned{exact receipt-owned asset?}
    Owned -->|yes| Match{unmodified and unlinked?}
    Match -->|yes| Remove["remove only recorded asset"]
    Match -->|no| Preserve["preserve and report"]
    Owned -->|no| Host{host/user-managed?}
    Host -->|yes| Manual["direct user to host UI/command"]
    Host -->|no| Preserve
```

The important implementation rule is that a refusal is a successful safety outcome. `lazybuddy-tooling.sh` validates an explicit root and receipt before deleting a toolpack; it never turns a filename match, parent directory, or host plugin name into ownership. Host removal remains a separate user action because the package cannot safely enumerate host-managed installation paths.
