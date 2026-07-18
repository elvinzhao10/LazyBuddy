# Host routes

LazyBuddy supports CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy, but package
readiness does not prove any host route is live. Verification is macOS-only.
The only verified copied-repository WorkBuddy path is Skills-only import/copy
from `lazybuddy-plugin/skills/` plus manual local MCP connectors; a full
WorkBuddy plugin route requires real host proof.

| Host route | Package role | Required user observation |
| --- | --- | --- |
| CodeBuddy IDE | Copied package, manifest, local checks, and six local MCP declarations. | Install with the host plugin flow, reload if offered, then in a new session confirm a LazyBuddy command/skill and MCP status. |
| CodeBuddy CLI | Local release-root marketplace metadata and package validation are documented. | Add the release root, install `lazybuddy@lazybuddy`, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | No executable local route is claimed; compatibility metadata is package-only. | Use a documented host UI only when a loaded session provides real plugin proof. |
| WorkBuddy local fallback | `lazybuddy-plugin/skills/` is the verified Skills-only import/copy source. | Import through Skills UI and manually add each compatible local MCP connector in Settings. |

## CodeBuddy

For IDE installation, use the current plugin UI, reload if the host offers it,
then inspect a new session for `/lazybuddy:lazy-<command>` and MCP status. For
CLI installation from a local checkout, pass the absolute **release root** —
the directory containing `.codebuddy-plugin/marketplace.json`, not the nested
`lazybuddy-plugin/` directory — to the local marketplace:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

The interactive `/plugin` menu is equivalent: choose Marketplace → Add with
the same release-root path, then install `lazybuddy@lazybuddy`. `--plugin-dir
<absolute-local-LazyBuddy-path>` is for development/testing only, never
persistent, and is not a marketplace install. Do not automate CodeBuddy
marketplace trust or host installation. Repeating this route preserves
existing project configuration; start a new session and inspect plugin/MCP
activation after installation.

`.codebuddy/settings.json` may be shared for non-secret project defaults.
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Marketplace metadata and local
file validation establish **package readiness**; they are not evidence that
commands, agents, hooks, or MCP loaded in a host.

## WorkBuddy

`.workbuddy-plugin/plugin.json` is compatibility metadata, not an executable
copied-repository WorkBuddy installer. The verified fallback imports local
`skills/` and configures compatible local MCP connectors manually. WorkBuddy
does not gain CodeBuddy commands, agents, hooks, or MCP behavior merely because
the copied package contains those declarations; a full plugin route needs a
loaded host session.

## Shared boundary

Local checks establish package evidence only. They do not prove plugin
discovery, marketplace activation, SessionStart, hook execution, a running
session, or MCP connection. See [verification contract](verification-contract.md)
and [safe removal](../08-safe-removal.md). The declaration-to-connection
boundary is explained in [MCP lifecycle](../07b-mcp-lifecycle.md).

## What the route actually changes

Each route gives the host a package artifact or a manual connector recipe; it
does not make the package an owner of host state. CodeBuddy discovery and
WorkBuddy marketplace loading remain host-native operations. That is why the
package validates its own manifests and launchers but does not scan a
marketplace database, rewrite a settings directory, or infer that an MCP
entry belongs to LazyBuddy. Treat a host UI observation as the final boundary
between a valid package and an active integration.
