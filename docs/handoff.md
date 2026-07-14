# LazyBuddy documentation handoff

## Purpose

The root `docs/` directory intentionally contains only this handoff. Write
from the implemented package, not private legacy notes, and keep private
working material under ignored `dev/docs/root/`. This repository carries a
v0.17 alignment candidate; published package manifests remain
v0.16.0-alpha.1 until a separate release-version bump. Verification is on
macOS only.

## Start here

- `README.md` explains user-facing workflow and repository layout.
- `AGENTS.md` is the host-specific onboarding guide.
- `lazybuddy-plugin/README.md` describes the installable package and its safe
  install, verification, and uninstall paths.
- `lazybuddy-plugin/` is the package boundary: skills, commands, agents, hooks,
  MCP servers, templates, and scripts must work when copied without repository
  root `docs/` or `dev/` directories.

## Documentation ownership

The tracked `docs/` directory contains only this handoff. Private legacy
material is organized under ignored `dev/docs/{root,package,mcp,evaluations}/`;
it is background only, not an authoritative source and never a runtime
dependency. Do not force-add it. Keep maintained public explanation in the
root README, root AGENTS guide, or package-local documentation where
installation requires it.

## Validate before documenting behavior

Run these commands from `lazybuddy-plugin/`:

```bash
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
bash scripts/lazybuddy-mcp-test.sh
bash scripts/lazybuddy-verify.sh
```

Treat command output and the package source as the authority if legacy notes
conflict with current behavior. Documentation must distinguish the v0.17
alignment candidate from the published v0.16.0-alpha.1 package baseline, and
preserve tested host surfaces, the six-server MCP inventory, and the safe
host-managed uninstall procedure.

## v0.16 tooling foundation

`lazybuddy-plugin/scripts/lazybuddy-tooling.sh` owns the optional local
tooling lifecycle. It detects compatible host `rg` and `sg` providers without
altering them, provisions locked fallbacks only in an explicit empty caller
root when a provider is missing, and removes only an unmodified receipt-owned
root. It also exposes `verify --target ... --dry-run|--run` for declared,
allowlisted repository-native checks. Keep this capability package-local: it
must never read root `docs/` or `dev/`, mutate a target manifest/lockfile, or
guess a host-managed installation path.

The same script owns the optional LSP provider lifecycle through
`lsp-status`, `lsp-install`, `lsp-doctor`, and `lsp-uninstall`. The provider
registry is `lazybuddy-plugin/tooling/capabilities.json`; the locked provider
manifests are under `lazybuddy-plugin/tooling/lsp/`. Only JavaScript/
TypeScript and Python are supported. The package-owned MCP bridge is
`lazybuddy-plugin/mcp/lsp/server.sh`; it requires an explicit
`LAZYBUDDY_TOOLING_ROOT` and offers only provider-advertised read-only
definition, references, symbols, hover/type, and diagnostics operations.
Rename and all other languages remain intentionally unsupported. Preserve the
separate-LSP-root requirement: LSP provisioning never mutates a target or a
global/host-managed location.

## Conditional real CodeGraph

`lazybuddy-plugin/scripts/lazybuddy-tooling.sh` owns a separate optional
CodeGraph lifecycle: `codegraph-status`, `codegraph-install`,
`codegraph-init`, `codegraph-enable`, `codegraph-doctor`,
`codegraph-export-mcp`, and `codegraph-uninstall`. It pins
`@colbymchenry/codegraph@1.4.1` in the package-owned tooling manifest. It does
not run upstream agent installers/uninstallers, use `~/.omo`, mutate global or
host-managed configuration, allow CodeGraph's fallback download, or enable
CodeGraph telemetry. Its npm and CodeGraph runtime state stays inside the
receipt-owned tooling root.

The caller explicitly selects a safe absolute project root and empty tooling
root, then installs, initializes the project-local `.codegraph/` index, and
enables it before requesting an exported MCP registration fragment. The
launcher at `lazybuddy-plugin/mcp/codegraph/server.sh` performs only
`codegraph serve --mcp`; it refuses disabled, missing, unsafe, or uninitialized
state. `codegraph-doctor` merely recommends the feature at 500 supported files
or 100,000 supported lines and never initializes or starts CodeGraph.

Keep `mcp/context-graph` described as a grep-based heuristic fallback, not a
real CodeGraph implementation. Its result quality and operation must never be
presented as equivalent to semantic CodeGraph data. Receipts record whether an
index existed before LazyBuddy initialization; `codegraph-uninstall` removes an
index only when that receipt proves LazyBuddy created it.

## Public capability status contract

Describe tooling status, load-check, and doctor as read-only canonical package
reports. They must not imply provider execution, registration, optional
activation, or a live CodeBuddy/WorkBuddy session.

## Optional capability policy

Keep Context7, `grep_app`, Playwright, LSP, and CodeGraph optional and
explicit. Offline status does not contact a provider; approvals, lifecycle
steps, and manual host merging remain separate decisions.

## Receipt and safe removal

Removal is receipt-bound: only exact unmodified owned tooling roots may be
removed. Preserve foreign, modified, linked, caller-owned, project, and
host-managed paths, and use the host UI for plugin/MCP removal.

## Package readiness versus host verification

Package readiness covers copied files, declarations, and local contracts. It
does not prove SessionStart, hooks, marketplace installation, a live session,
or MCP connection; document those as manual host observations.

## JSON-RPC resilience

JSON-RPC stream handling is package-level protocol evidence. Never present it
as proof that CodeBuddy or WorkBuddy launched or connected an MCP endpoint.

## Host-specific exclusions

- **Host integration:** CodeBuddy uses plugin flows; WorkBuddy requires its
  documented UI/marketplace or local skills with manual connectors.
- **State/path:** package-local receipt roots are distinct from `.workbuddy`
  and all host-managed plugin/configuration paths.
- **Inventory:** six local MCP servers are declared; Context7 and `grep_app`
  are optional export fragments, while filesystem and Playwright are outside
  the bundled local-server inventory.

## Known unverified host behavior

Do not claim live host discovery, hook execution, marketplace activation, or
MCP connection. The copied repository remains an unverified WorkBuddy plugin
installer; the local-skills fallback still needs manual host observation.

## macOS verification scope

This handoff documents macOS only as verified. Normal CI does not require a sibling repository; release-only paired parity takes explicit sibling roots as release evidence and never becomes a runtime or installation dependency.

## Optional remote capability exports

Context7 and experimental, unpinned `grep_app` are deliberately separate from
the six package-declared local MCP servers. The tooling registry records both
as explicit remote capabilities. `remote-status` and `remote-doctor` remain
offline and non-blocking; `remote-enable`, `remote-disable`, and
`remote-export-mcp` persist only an explicit selection in a receipt-owned
tooling root. Export returns namespaced host-registration entries for
`https://mcp.context7.com/mcp` and `https://mcp.grep.app`; it neither edits
host configuration nor includes credentials. Keep the `docs` MCP described as
the existing local resolver, never as Context7.

The installed package additionally vendors the automatic-tooling contract,
its SHA-256 sidecar, and the provider-policy adapter. Keep readiness and
doctor checks responsible for those files so a copied package cannot appear
ready without its provider policy. Document automatic capability selection as
task-scoped and non-persistent: it must not mutate a host MCP configuration or
export a registration. `setup` and `providers` remain offline status/setup
surfaces; provider output is where cost, egress, credential-reference, and
approval state are reported. Persistent `remote-enable`/`remote-export-mcp`
compatibility must remain explicit, receipt-owned, namespaced, and manually
merged. Preserve separate explicit approval/lifecycle language for Playwright
and CodeGraph, including their no-auto-start/no-auto-index rule.
