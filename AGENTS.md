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
   record only what is visibly observed. If Computer Use is unavailable, a
   user-pasted verbatim status or screenshot counts as observed evidence. If a
   reload or new session is needed, issue the next single action, wait, and
   inspect again.
8. Verify one real Skill or command and every expected MCP connection for the
   selected route. Report the observed host result separately from package
   readiness; without observation, **HOST READINESS: PENDING** remains the only
   honest result.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. None of those labels proves the current build:
without current observation, **HOST READINESS: PENDING**.

## Host artifact boundary

| Host | Safe package artifact | Host action and expected observation |
| --- | --- | --- |
| **CodeBuddy IDE** | Public guidance supports local Skills import and MCP JSON. Plugin loading seen in the supplied build is an observed-build route, not a public marketplace guarantee. | Use the plugin route only after approval and current discovery; otherwise import `lazybuddy-plugin/skills/` and configure six local MCP connectors. In a new session inspect one real Skill/command appropriate to the chosen route and all six connections. |
| **CodeBuddy CLI** | The release-root `.codebuddy-plugin/marketplace.json` and package checks. Use the exact local marketplace commands below; `--plugin-dir` is development/testing only and never persistent. | Use the three separate CodeBuddy handoff actions below. After installation and a fresh session inspect one real Skill/command and all six MCP connections. |
| **WorkBuddy fallback** | Skills import/copy from `lazybuddy-plugin/skills/` only, plus six individual manual local MCP connectors. | After approval, import Skills and add each connector manually in Settings. Observe one imported Skill and all six connector statuses. Unless a full plugin session is actually observed, do not claim that files or load-check output loaded commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | The supplied prerelease build exposed an observed-build route; this is not a public compatibility promise. | Use it only if the current build discovers the plugin after approval. Only a loaded session may prove commands, agents, hooks, or MCP active. |

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

These are three separate future user actions:

1. **Action 1 — discover:** after approval, add the absolute release root with
   `/plugin marketplace add <absolute-local-LazyBuddy-path>` (or the equivalent
   UI action), then wait while the agent uses Computer Use to observe that
   `lazybuddy@lazybuddy` is discovered. Do not install yet.
2. **Action 2 — install:** after a separate approval, enter
   `/plugin install lazybuddy@lazybuddy`, then wait while the agent observes the
   install result. Do not restart in the same action.
3. **Action 3 — restart and observe:** as a later action, start a fresh
   CodeBuddy session, then let the agent inspect one real Skill/command plus all
   six MCP connections.

Do not combine these actions, pre-approve trust, or claim host readiness from
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

Do not run a full plugin route and the `manual-skills-mcp-fallback` together;
coexistence is unsupported and may duplicate Skills or MCP processes. To
switch, stop the session, remove only LazyBuddy's old plugin/Skills entry and
six connectors through the host UI, choose one route, start a fresh session,
then verify that route. Each step is a separate approved action.

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
