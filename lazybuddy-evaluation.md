# LazyBuddy v0.17 Alignment Candidate Evidence

> Published package baseline: v0.16.0-alpha.1. The v0.17 candidate is not a
> separate published package version until a release-version bump is made.

> Current tooling-foundation release evidence, verified on macOS only; not a historical parity score or a certification that a CodeBuddy or WorkBuddy session loaded the package.

## What is implemented and checked

The v0.16 CodeBuddy package declares 14 `lazy-` skills, 14 current slash-command workflows, 13 agents, 12 hook-event declarations, and 6 MCP servers: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`. The removed `parity` and `source-map` servers are not part of this release.

Package checks cover the manifest, component inventory, JSON validity, executable MCP scripts, internal Markdown links, smoke checks, MCP regression checks, and hook/security verification. The aggregate `lazybuddy-verify.sh` reports these package checks; it does not claim a live host loaded the plugin or connected a server.

The package readiness and doctor checks also verify that a copied plugin
contains the versioned automatic-tooling contract, its SHA-256 sidecar, and
the provider-policy adapter. The package onboarding regression copies the
plugin, validates readiness and doctor, confirms offline provider status, and
proves a host-MCP sentinel remains unchanged. It also rejects tooling-root
uninstall after a caller-owned entry appears.

The v0.16 tooling registry adds disabled-by-default Context7 and experimental,
unpinned `grep_app` export capabilities. They are not counted as bundled MCP
servers: normal install, status, and doctor make no remote request. Explicit
selection produces only a namespaced registration fragment with the Context7
or grep.app endpoint; it stores and logs no credentials and never replaces a
caller-owned MCP entry.

Automatic capability selection is task-scoped and does not persist a host
registration or export. `setup` and `providers` expose reference-only
credential state, cost/reachability, and approval decisions without remote
contact. Explicit `remote-enable`/`remote-export-mcp` compatibility commands
remain persistent only inside a receipt-owned tooling root and require manual
host merging. Context7 and `grep_app` can egress query data; Playwright is
approval-gated; CodeGraph is an explicit install/init/enable lifecycle and is
never automatically indexed, launched, or registered.

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

## Public capability status contract

`lazybuddy-tooling.sh` status, load-check, and doctor expose canonical package
capability status without provider execution, host registration, or optional
activation. Their output is evidence about copied package assets and local
state, not proof that a CodeBuddy or WorkBuddy session loaded the plugin.

## Optional capability policy

Context7, `grep_app`, Playwright, LSP, and CodeGraph remain optional. Status
and readiness commands stay offline and read-only; explicit approval, lifecycle
commands, and manual host merging remain required before an optional path can
be used.

## Receipt and safe removal

Only an exact, unmodified receipt-owned tooling root is removable. Modified,
foreign, linked, caller-owned, project, and host-managed paths are preserved;
host plugin and MCP entries are removed through their host-managed UI.

## Package readiness versus host verification

Package readiness validates copied package contents, declarations, and local
contracts. It does not prove SessionStart, hook execution, marketplace
installation, a live session, or MCP connection.

## JSON-RPC resilience

Packaged MCP endpoints have package-level JSON-RPC stream coverage. That
coverage is not evidence that a host has launched, connected, or exercised an
endpoint in a live session.

## Host-specific exclusions

- **Host integration:** CodeBuddy IDE/CLI use host plugin flows; WorkBuddy
  relies on its UI/marketplace or the documented local-skills fallback.
- **State/path:** LazyBuddy uses package-local tooling roots and does not guess
  `.workbuddy` or other host-managed installation paths.
- **Inventory:** six local MCP servers are bundled; Context7 and `grep_app`
  are optional export fragments, while filesystem and Playwright are not local
  MCP servers in the package inventory.

## Known unverified host behavior

Live CodeBuddy and WorkBuddy plugin discovery, hook execution, marketplace
behavior, and MCP connection require manual session observation. A copied
repository is not claimed as a verified WorkBuddy plugin installer.

## macOS verification scope

This release is verified on macOS only. Normal CI does not require a sibling
repository; release-only paired parity receives explicitly supplied sibling
roots for release evidence and never creates a runtime or install dependency.

## Attribution and limits

The repository [NOTICE](NOTICE) and [LICENSE](LICENSE) are the authoritative attribution and license records. This document deliberately replaces earlier structural and semantic percentage claims with v0.16 inventory and test evidence. It does not claim verification of a live CodeBuddy or WorkBuddy host session.
