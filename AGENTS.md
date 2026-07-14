# AGENTS.md — LazyBuddy Setup Guide

> **Agent:** this file is the **setup** guide. It tells you how to install and configure LazyBuddy. For *how to use* the harness once installed, see the [LazyBuddy README](https://github.com/elvinzhao10/LazyBuddy#readme).

LazyBuddy supports **CodeBuddy IDE** and **CodeBuddy CLI** as documented plugin surfaces. **WorkBuddy** documents plugins, skills, MCP, hooks, agents, and rules through its UI/marketplace, but this release has not verified a copied-repository installer for LazyBuddy. The verified no-package-manager path is local skill import plus manual MCP configuration; any WorkBuddy marketplace/plugin installation must be confirmed in a live session.

**Repository state:** v0.17 alignment candidate. Published package manifests
remain v0.16.0-alpha.1 until a separate release-version bump; candidate checks
are verified on macOS only.

## `onboard` protocol

When the user types `onboard`:

1. Read this guide and ask which installed host/version they are using: **WorkBuddy**, **CodeBuddy IDE**, or **CodeBuddy CLI**.
2. Follow only that host's setup path. Perform safe repository and CLI steps automatically. Run `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh`, then invoke `/lazybuddy:lazy-init-deep` (or make the equivalent natural-language request) only after the package is ready or explicitly degraded to a skills-only import.
3. Report each completed action and its observed result. Label the load-check as **package readiness**: it cannot confirm that the host loaded the plugin, ran SessionStart, or connected an MCP server.
4. Stop before account, marketplace, or app-setting changes. Give exact manual directions for those steps and say which host check the user must observe.
5. End by explaining that the copied repository can be deleted after installation, or retained to explore and study the project.

Onboarding, load-check, and doctor do not activate optional providers, perform
a global installation, or prove live host/MCP connection. Any optional
capability and every host plugin, marketplace, or connector action remains an
explicit user or host-UI step.

## Step 0 — Which platform are you on?

| Platform | Documented entry point | Commands / skills | Hooks / MCP |
|---|---|---|---|
| **WorkBuddy** | documented plugin/marketplace UI (verify session load), or import `lazybuddy-plugin/skills/` locally | plugin capabilities only after session verification; local import uses skills or natural language | local import requires manual MCP; do not promise LazyBuddy hooks/agents/commands auto-load |
| **CodeBuddy IDE** | `.codebuddy-plugin/plugin.json` | use a loaded `/lazybuddy:lazy-<command>` or skill | host-side activation and MCP connection must be observed manually |
| **CodeBuddy CLI** | CodeBuddy marketplace entry | `codebuddy plugin …`, then a CLI session | manifest declares hooks/MCP; connection is checked in the host session |

- **WorkBuddy** → use the documented plugin/marketplace UI and verify the loaded session before relying on any plugin capability. The verified no-package-manager fallback is importing `lazybuddy-plugin/skills/` locally, then using skills or natural language with manual MCP configuration.
- **CodeBuddy IDE** → install the copied package through its plugin flow, run `/reload-plugins` if the host exposes it (or use its equivalent reload action), then confirm that one `/lazybuddy:lazy-<command>` or skill is available.
- **CodeBuddy CLI** → install the included marketplace entry with the commands below, then begin a session to observe plugin/MCP activation.

## Step A — Install

**Option A — AI onboarding (recommended).** Open the copied repository in your chosen host and type `onboard`.

**Option B — manual CodeBuddy CLI install:**

1. Clone this repo:
   ```bash
   git clone https://github.com/elvinzhao10/LazyBuddy.git
   ```
2. Add the repository marketplace and install the plugin:
   ```bash
   codebuddy plugin marketplace add https://github.com/elvinzhao10/LazyBuddy.git --name lazybuddy
   codebuddy plugin install lazybuddy@lazybuddy --scope project
   codebuddy plugin validate lazybuddy-plugin
   ```
3. Verify:
   ```bash
   bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
   bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
   ```
   `load-check` and `doctor` validate the package. Start a CodeBuddy session and inspect its plugin/MCP status separately; the scripts do not claim that a live host connected it.

**WorkBuddy:** use its documented plugin/marketplace UI if available, then verify the loaded session before assuming hooks, agents, commands, or MCP are active. This release does not verify direct copied-repository installation through `.workbuddy-plugin/plugin.json`; it is compatibility metadata, not a documented folder installer. The verified no-package-manager fallback is importing `lazybuddy-plugin/skills/` with the local Skills UI and manually adding compatible MCP connectors in WorkBuddy settings.

**CodeBuddy IDE:** install **LazyBuddy** through the host's plugin UI, run `/reload-plugins` if available (or the host equivalent), and confirm one `/lazybuddy:lazy-<command>` or skill in a new workspace. Use natural language when the host does not expose plugin slash commands. Use manual skill/MCP import only when marketplace installation is unavailable and report any missing hook/MCP support.

> After the host confirms installation, the copied repository can be deleted if it is no longer needed, or retained to explore and study. Do not assume a generated `AGENTS.md`, hooks, or MCP connection unless the installed host shows them.

## MCP servers

The CodeBuddy manifest declares six servers in `lazybuddy-plugin/.mcp.json`. Package readiness validates that declaration; a new CodeBuddy session or settings view must confirm whether a server is loaded and connected. WorkBuddy supports MCP through its documented UI, but this release's verified local path is manual connector configuration; do not treat `.mcp.json` or `.workbuddy-plugin/plugin.json` as an executable copied-repository installer.

Optional Context7 and experimental, unpinned `grep_app` registrations are not
part of those six package MCP declarations. They remain disabled until the
user explicitly selects them with `lazybuddy-tooling.sh remote-enable` and
exports a namespaced merge fragment. Do not add credentials to that fragment:
they stay solely in the user's host environment. Normal tooling install,
status, and doctor do not contact either remote endpoint.

## v0.16 automatic tooling

The installed package includes a versioned provider contract and policy
adapter. `bash lazybuddy-plugin/scripts/lazybuddy-tooling.sh setup
--non-interactive --json` writes only reference-safe user configuration, and
`providers --policy ask-once --json` reports eligibility, cost, egress,
credential-reference, and approval state without contacting remote providers.
Automatic capability selection is task-scoped and never registers or exports a
host MCP entry. Stop before granting a remote, metered, browser, or
architecture capability unless the user has explicitly chosen it.

`remote-enable` and `remote-export-mcp` are deliberate persistent
compatibility commands: enable records only a selected optional provider in a
verified receipt-owned tooling root, and export prints a namespaced fragment
for the user to merge through the host UI. They never replace caller entries
or write raw credentials. Context7/`grep_app` can egress query data; Playwright
requires browser-specific approval; CodeGraph requires its separate explicit
install, initialization, and enable sequence. Do not automatically start,
index, register, or enable any of them.

## Uninstall

Use the host's own plugin removal flow for CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy. LazyBuddy never guesses, searches for, or deletes host-managed plugin paths. After removal, delete or disable only the LazyBuddy MCP connectors you personally added in that host's MCP settings. For the verified WorkBuddy local-import fallback, remove the imported `lazybuddy-plugin/skills/` entries through the Skills UI and remove the manually added connectors through Settings; do not delete `.workbuddy-plugin`, `.workbuddy`, or another host's metadata as a substitute. Keep the copied repository until the host confirms removal, then delete that copy only if you no longer need it.

## Verify CodeBuddy installation

```bash
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh    # health check
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh          # verification gate
bash lazybuddy-plugin/scripts/lazybuddy-smoke-test.sh      # smoke test
```

## Verify

```bash
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh    # expect: 0 FAIL
```

## What gets installed

The CodeBuddy package contains 14 `lazy-` skills, 14 `lazy-` commands, 13 agents, 12 hook-event declarations, and 6 MCP declarations. WorkBuddy may load those through its documented plugin/marketplace UI only after a live-session check; the verified local fallback imports the 14 skills and configures MCP manually. Host enforcement applies only after the relevant host confirms the package load.

## Reference

- How to use the harness: [LazyBuddy README](https://github.com/elvinzhao10/LazyBuddy#readme)
- Repository handoff: [docs/handoff.md](docs/handoff.md). Private legacy root
  documentation belongs in ignored `dev/docs/root/`.
