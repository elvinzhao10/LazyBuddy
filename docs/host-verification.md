# Package readiness versus host verification

LazyBuddy v0.16.0-alpha.1 is the current package baseline.
Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.

## The boundary

Package readiness verifies copied package contents, declarations, inventories, and local contracts. It cannot prove marketplace installation, plugin discovery, SessionStart, hook execution, a live host session, or an MCP connection.

## Required host observations

| Surface | Package evidence | Required user observation |
|---|---|---|
| CodeBuddy IDE | Copyable package, manifest, local checks, six MCP declarations. | Install with the host plugin flow, reload if offered, then confirm a LazyBuddy skill/command and MCP status in a new session. |
| CodeBuddy CLI | Marketplace commands and package validation are documented. | Install through the host, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Compatibility metadata and package assets are present. | Use the documented UI/marketplace and confirm a loaded session before relying on plugin capabilities. |
| WorkBuddy local fallback | `lazybuddy-plugin/skills/` is the verified no-package-manager import source. | Import skills through Skills UI and add each compatible MCP connector manually in Settings. |

## Known unverified host behavior

Live CodeBuddy and WorkBuddy discovery, marketplace behavior, hook execution, and MCP connection require manual session observation. A copied repository is not a verified WorkBuddy plugin installer; the local-skills fallback still requires manual connector setup and host confirmation.

## Host-specific exclusions

- **Host integration:** CodeBuddy IDE/CLI use host plugin flows. WorkBuddy uses its documented UI/marketplace, or local skills with manual connectors.
- **State/path:** receipt-owned tooling roots are package-local. `.workbuddy`, plugin locations, credentials, and host MCP configuration are host/user assets and are never scanned or removed.
- **Inventory:** six local MCP servers are bundled: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`. Context7 and `grep_app` are optional export fragments; filesystem and Playwright are outside the bundled local-server inventory.

## JSON-RPC resilience

The six packaged local MCP endpoints have JSON-RPC stream regression coverage, including malformed input and subsequent-request behavior. This is protocol evidence for the package, not proof that a host process launched or connected an endpoint.

## macOS verification scope

LazyBuddy is verified on macOS only. Normal CI does not require a sibling repository. Release-only paired parity can receive explicitly supplied sibling roots as evidence; it is never a runtime, installation, or normal-CI dependency.
