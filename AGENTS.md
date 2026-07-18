# AGENTS.md — LazyBuddy setup and removal guide

> **Agent:** use this guide to install, verify, and remove LazyBuddy safely.
> For workflow use after installation, read [README.md](README.md). For the
> package's exact tooling commands, read [lazybuddy-plugin/README.md](lazybuddy-plugin/README.md).

LazyBuddy supports CodeBuddy IDE and CodeBuddy CLI through their plugin flows.
WorkBuddy's only verified copied-repository path is Skills-only import/copy from
`lazybuddy-plugin/skills/` plus manual local MCP configuration; any WorkBuddy
plugin/marketplace route remains manual until a real host proof is provided.
LazyBuddy is a learning project primarily inspired by LazyCodex. It is an
independent implementation for CodeBuddy and WorkBuddy and does not require
LazyCodex or OmO at runtime; [NOTICE](NOTICE) records the upstream attribution.
Verification is on macOS only.

## Current-message routing contract

Before taking onboarding action, scan the whole current user message, including
every line. Route only explicit direct actions for this turn. Text presented as
a quote, history, example, transcript, or instruction under discussion is not a
new action. A compatible later detail refines the earlier route. When explicit
current-message routes conflict, the rightmost conflicting route wins.

If the host or operation is still ambiguous after that scan, ask one focused
clarifying question and take no action. Keep host authority and proof boundaries
unchanged: WorkBuddy plugin/marketplace installation, host settings, accounts,
credentials, and connectors remain manual; package load-check reports package
readiness only; and a loaded WorkBuddy session must be observed before relying
on hooks, agents, commands, or MCP.

| Current message | Route and boundary |
|---|---|
| `lazy-init-deep` | Run the InitDeep flow only; it does not select a host-install route. |
| `WorkBuddy UI 装插件` | Route to WorkBuddy UI onboarding; host installation remains manual and InitDeep is not invoked. |
| `lazy-init-deep` followed by `WorkBuddy UI 装插件` on the next line | Route to WorkBuddy UI onboarding. The later explicit host route supersedes InitDeep for this turn; do not invoke InitDeep or load-check, mutate host state, or claim readiness. Require loaded-session observation. |
| `onboard` plus a later compatible `WorkBuddy` host detail | Follow the WorkBuddy onboarding path; package readiness and live host proof remain separate. |
| Explicit `CodeBuddy` and later explicit `WorkBuddy` host routes | Follow the rightmost host route, WorkBuddy, and do not perform the earlier host route. |
| `onboard` or “install the plugin” without one unambiguous host | Ask once which host/path the user means and take no action. |

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
| **CodeBuddy CLI** | Add the absolute release root through the local marketplace route below, then install `lazybuddy@lazybuddy`. | Plugin/MCP activation in a new session. |
| **WorkBuddy** | Skills-only import/copy from `lazybuddy-plugin/skills/` plus manual local MCP connectors; a full plugin route needs real host proof. | Imported skill and each manually configured connector, or a loaded plugin session observed by the user. |
| **WorkBuddy fallback** | Import `lazybuddy-plugin/skills/` with the Skills UI and add compatible MCP connectors manually. | Imported skill and each manual connector shown in Settings. |

## CodeBuddy CLI installation

```bash
git clone --branch v1.0.2 --depth 1 https://github.com/elvinzhao10/LazyBuddy.git
cd LazyBuddy
codebuddy plugin validate lazybuddy-plugin
bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
```

For a local release checkout, pass the absolute **release root** — the
directory containing `.codebuddy-plugin/marketplace.json`, not the nested
`lazybuddy-plugin/` package directory — to CodeBuddy's local marketplace:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

The interactive `/plugin` menu is equivalent: choose Marketplace → Add with
that same release-root path, then install `lazybuddy@lazybuddy`. Repeat the
route safely; it preserves existing project configuration. `--plugin-dir
<absolute-local-LazyBuddy-path>` is for development/testing only, never
persistent, and is not a substitute for the marketplace route. Do not automate
CodeBuddy marketplace trust or host installation. Start a new CodeBuddy session
after installation and observe plugin/MCP activation yourself.

Marketplace metadata and local file validation establish **package readiness**;
they are not evidence that commands, agents, hooks, or MCP loaded in a host.

## CodeBuddy project-local configuration

`.codebuddy/settings.json` may hold shareable, non-secret project defaults.
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Onboarding and readiness checks
preserve both files across repeated runs and do not write host configuration.

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
