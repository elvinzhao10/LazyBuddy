# LazyBuddy documentation handoff

This public handoff is for the next documentation owner. Learn the implemented
package first, write only claims supported by its checks, and keep root
documentation focused on how users can understand and operate LazyBuddy.

LazyBuddy v0.16.0-alpha.1 is the current package baseline.
Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.

## Reading order

1. [README.md](../README.md) explains the user workflow, host choices, automatic
   local capability routing, and safe removal.
2. [AGENTS.md](../AGENTS.md) is the agent-facing onboarding and offboarding
   contract.
3. [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md) is the
   self-contained package guide with exact installation, verification, tooling,
   and uninstall commands.
4. [lazybuddy-plugin/docs/verification-matrix.md](../lazybuddy-plugin/docs/verification-matrix.md)
   maps package evidence to the host observations it cannot make.
5. [lazybuddy-evaluation.md](../lazybuddy-evaluation.md) records the present
   public verification boundary.

## Repository and package boundaries

The repository root introduces the product. `lazybuddy-plugin/` is the
installable, self-contained package: its skills, commands, agents, hooks, MCP
servers, templates, scripts, tooling policy, and checks must work when copied
without root documentation. Do not create runtime dependencies on root
`README.md`, `AGENTS.md`, or `docs/`.

The package contains 14 skills, 14 commands, 13 agents, 12 hook-event
declarations, and six bundled local MCP declarations. Counts are an inventory,
not proof a host session loaded every component.

## How the workflow fits together

- **Skills** are reusable playbooks. They route ordinary-language requests to
  planning, execution, debugging, review, verification, project memory, or a
  long-running loop.
- **Commands** are CodeBuddy entry points for those playbooks, exposed as
  `/lazybuddy:lazy-<command>` when a host loads the plugin.
- **Agents** divide a larger workflow into roles such as planner, explorer,
  implementer, verifier, reviewer, QA executor, and security auditor.
- **Hooks** enforce or report lifecycle policy only after the host loads the
  package. They are not a substitute for observing the host session.
- **MCP servers** expose local package services. Their declarations are
  checked statically; a host connection remains a separate observation.

For a new repository, InitDeep establishes local project memory. For broad
work, planning writes an approval-ready plan; start-work executes it with
evidence; review-work independently challenges the result. A user should ask
for the smallest workflow that matches the change's risk.

## Capability and receipt lifecycle

`lazybuddy-tooling.sh` applies a local-first policy. It detects compatible
`rg` and `sg`, supports JavaScript/TypeScript and Python LSP navigation, and
can run declared repository-native verification. A task may select one of
these capabilities temporarily without changing host configuration, a target
manifest, a lockfile, or a global tool.

A missing local provider can be provisioned only in an explicit empty,
absolute receipt-owned tooling root. The receipt records ownership and makes
safe removal possible: uninstall accepts only the exact unmodified owned root
and preserves modified, foreign, linked, caller-owned, project, and
host-managed paths.

CodeGraph is separate from automatic routing. It has a pinned,
receipt-owned lifecycle: explicit install, explicit project initialization,
explicit enable, then an exported MCP fragment that the user merges through
the host UI. It never auto-indexes, auto-starts, enables telemetry, or uses an
upstream global installer. `context-graph` remains a grep-based heuristic
fallback, never a synonym for semantic CodeGraph.

## Public capability status contract

Describe load-check, doctor, status, and provider reports as read-only package
evidence. They report copied assets, eligible local providers, policy, and
receipt state. They do not imply provider execution, host registration,
optional activation, or a live CodeBuddy/WorkBuddy session.

## Optional capability policy

Context7 and experimental, unpinned `grep_app` are remote capability exports,
not bundled local MCP servers. They stay disabled unless a user explicitly
selects them; export prints a namespaced fragment for manual host merging and
never writes credentials. Remote calls can egress data or incur cost.

Playwright is outside the bundled local MCP inventory and needs explicit
browser approval. CodeGraph needs its explicit lifecycle. Offline status,
doctor, and readiness do not contact remote providers, start a browser,
initialize an index, or persist a host MCP entry.

## Receipt and safe removal

The receipt is the ownership boundary. Document package tooling removal as
receipt-bound and host removal as host-managed: remove only an exact,
unmodified package-owned root with the documented command. Preserve foreign,
modified, linked, caller-owned, project, and host assets. Plugin, marketplace,
and MCP connector removal happens through the selected host UI or CLI, never
through guessed filesystem paths.

## Package readiness versus host verification

Package readiness verifies copied package contents, declarations, inventories,
and local contracts. It cannot prove marketplace installation, plugin
discovery, SessionStart, hook execution, a live host session, or an MCP
connection. Document a required manual observation for each host path:

- CodeBuddy IDE: a loaded skill/command and MCP status in a new session.
- CodeBuddy CLI: plugin/MCP activation after marketplace installation and a new
  CLI session.
- WorkBuddy plugin/marketplace: a loaded session before relying on plugin
  capabilities.
- WorkBuddy local fallback: an imported skill and each manually configured
  connector shown by the host.

## JSON-RPC resilience

The MCP servers have package-level JSON-RPC stream coverage, including
malformed-input handling and continued processing. That evidence demonstrates
the package protocol boundary only; it is not evidence that a CodeBuddy or
WorkBuddy host launched or connected an endpoint.

## Host-specific exclusions

- **Host integration:** CodeBuddy IDE/CLI use host plugin flows. WorkBuddy uses
  its documented UI/marketplace, or local skills with manual connectors.
- **State/path:** receipt-owned tooling roots are package-local. `.workbuddy`,
  plugin locations, credentials, and host MCP configuration are host/user
  assets and are never scanned or removed.
- **Inventory:** six local MCP servers are bundled: `run-ledger`,
  `verification`, `status-dashboard`, `context-graph`, `code-intel`,
  and `docs`. Context7 and `grep_app` are optional export fragments;
  filesystem and Playwright are outside the bundled local-server inventory.

## How to verify documentation claims

Run package checks from `lazybuddy-plugin/`:

```bash
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
bash scripts/lazybuddy-mcp-test.sh
bash scripts/lazybuddy-verify.sh
bash tests/v018-documentation-regression.sh
```

Use command output and the package source as the authority. Verify internal
links with `bash scripts/lazybuddy-docs-check.sh`. When documenting a host
claim, distinguish the package command's result from the user-observed host
result. When documenting an inventory, compare it with the manifests and
load-check output rather than copying an old count.

## Known unverified host behavior

Live CodeBuddy and WorkBuddy discovery, marketplace behavior, hook execution,
and MCP connection require manual session observation. A copied repository is
not a verified WorkBuddy plugin installer; the local-skills fallback still
requires manual connector setup and host confirmation.

## macOS verification scope

LazyBuddy is verified on macOS only. Normal CI does not require a sibling
repository. Release-only paired parity can receive explicitly supplied sibling
roots as evidence; it is never a runtime, installation, or normal-CI
dependency.
