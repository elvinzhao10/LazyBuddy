# Host routes

LazyBuddy supports CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy, but package
readiness does not prove any host route is live. Verification is macOS-only.

| Host route | Package role | Required user observation |
| --- | --- | --- |
| CodeBuddy IDE | Copied package, manifest, local checks, and six local MCP declarations. | Install with the host plugin flow, reload if offered, then in a new session confirm a LazyBuddy command/skill and MCP status. |
| CodeBuddy CLI | Marketplace discovery and package validation are documented. | Use the host's current marketplace flow, verify publisher and immutable revision, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Compatibility metadata and package assets are present. | Use the documented UI/marketplace and confirm a loaded session before relying on plugin capabilities. |
| WorkBuddy local fallback | `lazybuddy-plugin/skills/` is the verified no-package-manager import source. | Import through Skills UI and manually add each compatible MCP connector in Settings. |

## CodeBuddy

For IDE installation, use the current plugin UI, reload if the host offers it,
then inspect a new session for `/lazybuddy:lazy-<command>` and MCP status. For
CLI installation, discover the current marketplace entry via host documentation
or UI; confirm the publisher and exact immutable revision/release reference
before executing the host-generated install command. This repository does not
endorse a mutable marketplace URL.

## WorkBuddy

`.workbuddy-plugin/plugin.json` is internal, unverified compatibility metadata;
it is not an executable copied-repository WorkBuddy installer. A plugin or
marketplace installation must be verified in a live session. The verified
fallback imports local skills and configures connectors manually. WorkBuddy
does not gain CodeBuddy command behavior merely because the copied package
contains command files.

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
