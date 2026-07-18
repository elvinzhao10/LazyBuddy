# AGENTS.md — LazyBuddy setup and removal guide

LazyBuddy supports CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy. It is verified
on macOS only. Package files, host settings, credentials, marketplace state,
and live sessions remain separate authorities.

## Local-first onboarding (start here)

Keep the pinned `v1.0.2` release in a permanent folder. Open or link that
folder in the selected host, give the agent the GitHub repository link,
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`. Do not use a
temporary copy or treat a package file as proof that a host loaded it.

## Current-message routing contract

Before taking onboarding action, scan the whole current user message,
including every line. Route only explicit direct actions for this turn. Text
presented as a quote, history, example, transcript, or instruction under
discussion is not a new action. A compatible later detail refines the earlier
route; when explicit current-message routes conflict, the rightmost conflicting
route wins.

If the host or operation is still ambiguous, ask one focused question and take
no action. The supported choices are **CodeBuddy IDE**, **CodeBuddy CLI**, and
**WorkBuddy**. Keep host authority and proof boundaries unchanged.

## `onboard` protocol

When the user types `onboard`:

1. Detect the selected host from the open app or ask the one focused host
   question above. Do not run a host route while the answer is ambiguous.
2. Resolve the permanent release root and confirm the pinned `v1.0.2` package.
   Give the user the GitHub link if it was not supplied. Never infer host
   readiness from a PATH entry, `--plugin-dir`, file existence, or a load-check.
3. Run only safe package checks and local filesystem/command setup. From the
   release root, use `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh`
   and `bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh`; these validate
   package manifests, Skills, declarations, and local contracts without
   installing a host plugin, changing host settings, or contacting providers.
4. Report **package readiness** separately. Package checks do not prove plugin
   discovery, command/Skill loading, hooks, agents, SessionStart, or an MCP
   connection.
5. Before any host-managed mutation (marketplace trust/add, plugin install,
   Settings connector, account, credential, or remote provider), ask for
   explicit approval naming the exact action. Never automate trust or install.
6. After approval, give exactly one concrete GUI/host action and wait. Do not
   bundle discovery, installation, reload, and verification in one handoff.
7. After the user responds, inspect the corresponding app with Computer Use and
   record only what is visibly observed. If a reload or new session is needed,
   issue the next single action, wait, and inspect again.
8. Verify one real Skill or command and every expected MCP connection for the
   selected route. Report the observed host result separately from package
   readiness; without observation, `host readiness: pending` remains the only
   honest result.

## Host artifact boundary

| Host | Safe package artifact | Host action and expected observation |
| --- | --- | --- |
| **CodeBuddy IDE** | Copied package, `.codebuddy-plugin/plugin.json`, local Skills/commands/agents/hooks declarations, and six local MCP declarations. | Use the host's plugin flow only after approval. In a new session inspect one `/lazybuddy:lazy-<command>` or Skill and all six MCP connections: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`. |
| **CodeBuddy CLI** | The release-root `.codebuddy-plugin/marketplace.json` and package checks. Use the exact local marketplace commands below; `--plugin-dir` is development/testing only and never persistent. | Use the two separate CodeBuddy handoff actions below. After installation and a fresh session inspect one real Skill/command and all six MCP connections. |
| **WorkBuddy fallback** | Skills import/copy from `lazybuddy-plugin/skills/` only, plus six individual manual local MCP connectors. | After approval, import Skills and add each connector manually in Settings. Observe one imported Skill and all six connector statuses. Unless a full plugin session is actually observed, do not claim that files or load-check output loaded commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | No copied-repository full-plugin claim is made by default. | A full plugin/marketplace route is conditional on real host proof. Only after a loaded session is observed may its commands, agents, hooks, or MCP be discussed as active. |

## CodeBuddy local marketplace handoff

The supported local route uses the **release root** (the directory containing
`.codebuddy-plugin/marketplace.json`), not the nested `lazybuddy-plugin/`
directory:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

The interactive `/plugin` menu is equivalent. Do not automate marketplace trust
or installation, and do not treat `--plugin-dir <absolute-local-LazyBuddy-path>`
as persistence.

These are two separate future user actions:

1. **Action 1 — discover:** after approval, add the absolute release root with
   `/plugin marketplace add <absolute-local-LazyBuddy-path>` (or the equivalent
   UI action), then wait while the agent uses Computer Use to observe that
   `lazybuddy@lazybuddy` is discovered. Do not install yet.
2. **Action 2 — install and observe:** after a separate approval, install
   `/plugin install lazybuddy@lazybuddy`, start a fresh CodeBuddy session, and
   let the agent inspect one real Skill/command plus all six MCP connections.

Do not combine the two actions, pre-approve trust, or claim host readiness from
the marketplace JSON alone. Repeating safe package checks preserves existing
project configuration.

## CodeBuddy project-local configuration

`.codebuddy/settings.json` may hold shareable, non-secret project defaults.
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Package checks and repeated safe
setup preserve both files and do not write host configuration.

## WorkBuddy Skills/manual-MCP fallback

Import only `lazybuddy-plugin/skills/` through WorkBuddy's Skills UI or its
documented local import. Add each compatible local MCP connector manually in
Settings: `run-ledger`, `verification`, `status-dashboard`, `context-graph`,
`code-intel`, and `docs`. A package file, manifest, or `load-check` result is
not a WorkBuddy session and must never be described as loading commands,
agents, hooks, or MCP. If the user supplies real full-plugin proof from a
loaded session, record that observation before relying on any broader surface.

## Safe package commands

```bash
# Run from the permanent release root; these are package checks only.
bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh
```

Do not enable optional remote, browser, or architecture capabilities during
onboarding. `--plugin-dir` is development/testing only, never persistent, and
does not replace the local marketplace route.

## `offboard` protocol

When the user types `offboard`, ask which host and whether CodeBuddy plugin
installation or WorkBuddy Skills/manual connectors are being removed. Inspect
the selected package receipt first, remove only exact receipt-owned local
assets, and preserve unknown, modified, linked, caller-owned, project, and
host-managed paths. Use the host's own plugin/Skills removal flow for host
state. Report package result separately from the user-observed host result in a
new session; never scan or guess host directories and never remove another
host's settings.
