# LazyBuddy v0.16.0-alpha.1 Implementation Evidence

> Current tooling-foundation release evidence, verified on macOS only; not a historical parity score or a certification that a CodeBuddy or WorkBuddy session loaded the package.

## What is implemented and checked

The v0.16 CodeBuddy package declares 14 `lazy-` skills, 14 current slash-command workflows, 13 agents, 12 hook-event declarations, and 6 MCP servers: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`. The removed `parity` and `source-map` servers are not part of this release.

Package checks cover the manifest, component inventory, JSON validity, executable MCP scripts, internal Markdown links, smoke checks, MCP regression checks, and hook/security verification. The aggregate `lazybuddy-verify.sh` reports these package checks; it does not claim a live host loaded the plugin or connected a server.

The v0.16 tooling registry adds disabled-by-default Context7 and experimental,
unpinned `grep_app` export capabilities. They are not counted as bundled MCP
servers: normal install, status, and doctor make no remote request. Explicit
selection produces only a namespaced registration fragment with the Context7
or grep.app endpoint; it stores and logs no credentials and never replaces a
caller-owned MCP entry.

## Host-compatibility boundary

| Surface | Current evidence | Required manual observation |
| --- | --- | --- |
| CodeBuddy IDE | The copied package, manifest, and package checks are present. | Install through the host flow, reload if offered, and confirm a `lazybuddy` command/skill and MCP status in a new session. |
| CodeBuddy CLI | Marketplace commands and package validation are documented. | Install through the host, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Compatibility metadata is retained, but a copied-repository installer is not verified. | Use the documented UI/marketplace and confirm the live session before relying on hooks, commands, agents, or MCP. |
| WorkBuddy local fallback | The local `skills/` directory is the supported no-package-manager import source. | Import skills through the Skills UI and manually add compatible MCP connectors in Settings. |

No package-readiness result is evidence of SessionStart, hook execution, marketplace installation, or MCP connection.

## Safe removal contract

LazyBuddy does not locate or delete host-managed installation paths. Remove a CodeBuddy installation through its plugin removal flow, then remove only the LazyBuddy MCP registrations you added. For WorkBuddy, use its documented plugin/marketplace removal flow; for the local import fallback, remove the imported skills through the Skills UI and remove manual connectors in Settings. Do not delete `.workbuddy-plugin`, `.workbuddy`, shared MCP metadata, or another host's files as a substitute for removal.

## Attribution and limits

The repository [NOTICE](NOTICE) and [LICENSE](LICENSE) are the authoritative attribution and license records. This document deliberately replaces earlier structural and semantic percentage claims with v0.15 inventory and test evidence. It does not claim verification of a live CodeBuddy or WorkBuddy host session.
