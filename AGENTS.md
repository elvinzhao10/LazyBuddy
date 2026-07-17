# AGENTS.md — LazyBuddy setup and removal guide

> **Agent:** use this guide to install, verify, and remove LazyBuddy safely.
> For workflow use after installation, read [README.md](README.md). For the
> package's exact tooling commands, read [lazybuddy-plugin/README.md](lazybuddy-plugin/README.md).

LazyBuddy supports CodeBuddy IDE and CodeBuddy CLI through their plugin flows.
WorkBuddy uses its documented plugin/marketplace UI; its copied-repository
installer is not verified. The verified no-package-manager WorkBuddy fallback
is local `lazybuddy-plugin/skills/` import plus manual MCP configuration.
LazyBuddy is a learning project primarily inspired by LazyCodex. It is an
independent implementation for CodeBuddy and WorkBuddy and does not require
LazyCodex or OmO at runtime; [NOTICE](NOTICE) records the upstream attribution.
Verification is on macOS only.

## `onboard` protocol

When the user types `onboard`:

1. Ask which installed host/version they use: **CodeBuddy IDE**, **CodeBuddy CLI**, or **WorkBuddy**.
2. Follow only that host's setup path. Run `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh`; after package readiness is full, invoke `/lazybuddy:lazy-init-deep` or accept the equivalent natural-language request. For a skills-only WorkBuddy import, say that the package is intentionally degraded to the fallback surface.
3. Report every completed safe repository/package action and its observed result. Call load-check **package readiness**: it proves copied files and declarations, not plugin loading, SessionStart, hooks, or an MCP connection.
4. Stop before account, marketplace, host-settings, credential, remote-provider, browser, or architecture-tool actions. Give exact manual host directions and name the live host observation the user must make.
5. Explain that optional tooling is unchanged: onboarding, doctor, and load-check do not enable providers, register MCP servers, install global tools, or write host configuration.

## `offboard` protocol

When the user types `offboard`:

1. Ask which host was used and whether the installation was a host plugin/marketplace install or WorkBuddy's local skills-import fallback.
2. Inspect and report the selected package-owned removal path before changing anything. Remove only an exact, unmodified receipt-owned tooling root through its documented package command; preserve unknown, modified, linked, caller-owned, project, and host-managed assets.
3. Use the selected host's own removal flow. For CodeBuddy IDE/CLI, remove LazyBuddy through the host plugin UI/CLI and then remove or disable only LazyBuddy MCP registrations the user personally added. For WorkBuddy plugin/marketplace use its UI; for the local fallback remove imported `lazybuddy-plugin/skills/` entries through Skills and manual connectors through Settings.
4. Never guess paths, scan host directories, delete `.workbuddy-plugin`, `.workbuddy`, shared MCP metadata, or remove another host's configuration. Never enable optional tooling while removing it.
5. Report **package result** separately from the **user-observed host result**. The package can prove receipt-safe local removal; only the user can confirm plugin and MCP removal in a new host session. Keep or delete the copied repository only after that observation.

## Host paths

| Host | Safe setup path | Required host proof |
|---|---|---|
| **CodeBuddy IDE** | Install the copied package with the plugin UI; reload if offered. | A `lazybuddy` command/skill and MCP status in a new session. |
| **CodeBuddy CLI** | Use the host marketplace discovery flow, confirm the publisher and an immutable revision or release reference, then begin a new session after installation. | Plugin/MCP activation in that session. |
| **WorkBuddy** | Use its documented plugin/marketplace UI. | Loaded session before relying on plugin hooks, agents, commands, or MCP. |
| **WorkBuddy fallback** | Import `lazybuddy-plugin/skills/` with the Skills UI and add compatible MCP connectors manually. | Imported skill and each manual connector shown in Settings. |

## CodeBuddy CLI installation

```bash
git clone https://github.com/elvinzhao10/LazyBuddy.git
cd LazyBuddy
codebuddy plugin validate lazybuddy-plugin
bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
```

Use CodeBuddy's current marketplace discovery flow to locate LazyBuddy. Confirm
the publisher and review the exact immutable revision or release reference
before running the host-generated install command. No reviewed immutable
marketplace reference is bundled here, so this guide intentionally provides no
marketplace-add URL or executable install command. Start a CodeBuddy session
afterwards. The scripts validate the package only; they do not prove a
connected MCP server or live hook execution.

## MCP and capability boundaries

The package declares six local MCP servers: `run-ledger`, `verification`,
`status-dashboard`, `context-graph`, `code-intel`, and `docs`. A host
session or settings page must confirm connection. `context-graph` is
heuristic search, not CodeGraph; filesystem and Playwright are outside this
bundled inventory.

LazyBuddy can select local `rg`, `sg`, supported JS/TS or Python LSP, and
repository-native checks for a task without persisting a host change. Any
fallback is installed only in an explicit receipt-owned tooling root. CodeGraph
is an explicit `install`/`init`/`enable` lifecycle. Context7 and experimental
`grep_app` need explicit selection and manual export/merge; remote requests can
egress data or cost money. Playwright needs explicit browser approval. Normal
onboarding, doctor, and status never activate, start, index, register, or
contact optional providers.

## Verify

```bash
bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh
```

Package readiness is not a host-readiness claim. Perform the applicable host
proof from the table before relying on integration behavior.

## References

- [Public usage guide](README.md)
- [Package commands and safe tooling lifecycle](lazybuddy-plugin/README.md)
- [Public verification evidence](lazybuddy-evaluation.md)
