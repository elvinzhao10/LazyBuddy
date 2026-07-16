# LazyBuddy verification evidence

This document records public, present-tense evidence for the LazyBuddy package.
It is not evidence that a specific CodeBuddy or WorkBuddy session has loaded a
plugin. Verification is on macOS only.

## Project purpose and attribution

LazyBuddy is a learning project for evidence-led agent workflows. It is
primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). OmO upstream
attribution is recorded in [NOTICE](NOTICE). The package is an independent
implementation and does not require LazyCodex or OmO at runtime.

## Features and verification

LazyBuddy packages 14 `lazy-` skills, 14 command workflows, 13 agents, 12
hook-event declarations, and six local MCP declarations: `run-ledger`,
`verification`, `status-dashboard`, `context-graph`, `code-intel`, and
`docs`. The package checks validate manifests, component inventory, JSON,
executable MCP scripts, internal Markdown links, hook/security behavior, MCP
protocol regressions, and the automatic-tooling contract.

`bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` reports
`PACKAGE_READINESS=full` when the copied package assets and local contracts
are complete. `lazybuddy-plugin-doctor.sh` and
`lazybuddy-plugin/scripts/lazybuddy-verify.sh` provide package health and an
aggregate verification gate. These commands are evidence about the package,
not a host session.

The package's local-first tooling policy detects compatible `rg` and `sg`,
supports JavaScript/TypeScript and Python LSP navigation, and recognizes
declared repository-native verification. A missing provider can be installed
only in a caller-selected empty receipt-owned root; verification never mutates
a target manifest, lockfile, global tool, or host configuration.

## Host support and required observation

| Surface | Package evidence | Required user observation |
|---|---|---|
| CodeBuddy IDE | Copyable package, manifest, local checks, and six MCP declarations. | Install with the host plugin flow, reload if offered, then confirm a LazyBuddy skill/command and MCP status in a new session. |
| CodeBuddy CLI | Marketplace commands and package validation are documented. | Install through the host, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Compatibility metadata and package assets are present. | Use the documented UI/marketplace and confirm a loaded session before relying on plugin capabilities. |
| WorkBuddy local fallback | `lazybuddy-plugin/skills/` is the verified no-package-manager import source. | Import skills through Skills UI and add each compatible MCP connector manually in Settings. |

The copied repository is not a verified WorkBuddy plugin installer. Package
readiness cannot prove SessionStart, hook execution, marketplace activation, a
live session, or MCP connection.

## Public capability status contract

`lazybuddy-tooling.sh` status, load-check, doctor, and provider reports are
read-only canonical package evidence. They report assets, capability eligibility,
policy, and receipt state without provider execution, optional activation, host
registration, or a claim that a live host loaded the package.

## Optional capability policy

Automatic task routing is temporary and nonpersistent. It selects the lightest
eligible local capability for the task without writing host/project
configuration or lockfiles. Context7 and experimental, unpinned `grep_app`
are remote exports that require explicit selection; any export is namespaced,
manual to merge, and contains no credential. Remote calls can egress data or
incur cost.

CodeGraph is optional architecture exploration with its own explicit
install/init/enable lifecycle. It is not automatically indexed, launched,
registered, or telemetered. Playwright requires explicit browser approval and
is outside the bundled local MCP inventory. `context-graph` is a heuristic
grep fallback, not CodeGraph.

## Receipt and safe removal

Receipt ownership is enforced for package tooling. Only an exact, unmodified
receipt-owned root can be removed. Modified, foreign, linked, caller-owned,
project, and host-managed paths are preserved. This boundary protects local
tooling and does not authorize removal of host plugin, marketplace, MCP, or
credential state.

## Package readiness versus host verification

Package readiness validates copied contents, declarations, inventories, and
local contracts. It does not prove host discovery, SessionStart, hooks,
marketplace installation, a running session, or MCP connection. The host
observation in the support table is required before making an integration
claim.

## JSON-RPC resilience

The six packaged local MCP endpoints have JSON-RPC stream regression coverage,
including malformed input and subsequent-request behavior. This is protocol
evidence for the package, not proof that a host process launched or connected
an endpoint.

## Host-specific exclusions

- **Host integration:** CodeBuddy IDE/CLI use host plugin flows; WorkBuddy uses
  its UI/marketplace or local skills with manual connectors.
- **State/path:** tooling roots are package receipt-owned; `.workbuddy`,
  host plugin locations, host MCP entries, and credentials remain host/user
  state and are never guessed or deleted.
- **Inventory:** six local MCP servers are bundled. Context7 and `grep_app`
  are optional export fragments; filesystem and Playwright are not bundled
  local MCP servers.

## Known unverified host behavior

Live plugin discovery, marketplace behavior, hook execution, SessionStart, and
MCP connection remain user-observed host behavior. WorkBuddy's copied-repo
plugin installation is not verified; the local import fallback intentionally
requires manual MCP configuration.

## macOS verification scope

LazyBuddy is verified on macOS only. Normal CI does not require a sibling
repository. Release-only paired parity receives explicitly supplied sibling
roots as release evidence and never creates a runtime or installation
dependency.

## Attribution and limits

[NOTICE](NOTICE) and [LICENSE](LICENSE) are the attribution and license
records. This evidence describes the package's tested boundaries and does not
claim host behavior beyond the required manual observations.
