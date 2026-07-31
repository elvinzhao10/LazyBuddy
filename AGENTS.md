# AGENTS.md — LazyBuddy setup and removal guide

LazyBuddy supports CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy. It is verified
on macOS only. Package files, host settings, credentials, marketplace state,
and live sessions remain separate authorities.

## Durable onboarding (start here)

Require **Node.js LTS 20 or newer** and **Git**. Bootstrap `onboard` only from
the verified official origin `https://github.com/elvinzhao10/LazyBuddy.git`.
The source checkout is transport only and may be deleted after promotion.

The stable command is `node "<install-root>/LazyBuddy/launcher.js"`. The
default install root is `~/Library/Application Support/LazySeries` on macOS,
`${XDG_DATA_HOME:-~/.local/share}/lazyseries` on Linux, and
`%LOCALAPPDATA%\LazySeries` on Windows. The exact tree is
`LazyBuddy/{active.json,launcher.js,releases/,receipts/,rollback/,staging/,locks/}`.
Never install into a temporary/cache directory or treat package state as proof
that a host loaded it. Lifecycle commands are `onboard`, `update`, `status`,
`offboard`, and `recover-bootstrap-lock`.

If lifecycle state collides with an existing path, preserve the caller
workspace. Only an explicitly verified lifecycle-owned sibling bootstrap lock
or product `staging/`/`locks/` artifact is recoverable; never remove or replace
caller workspace files.

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
2. Run `status` through the durable `launcher.js`. If absent, use the verified
   source entrypoint to run `onboard`; if blocked, preserve the state and report
   the exact issue.
3. When upgrading from v1.0.2, inventory receipt-owned versus modified/unknown
   assets first. Preserve user changes and host settings until the new session
   is observed. Never infer host readiness from a PATH entry, `--plugin-dir`,
   file existence, or a load-check.
4. Run only safe package checks and local filesystem/command setup. From the
   release root, use `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh`
   and `bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh`; these validate
   package manifests, Skills, declarations, and local contracts without
   installing a host plugin, changing host settings, or contacting providers.
5. Report **package readiness** separately. Package checks do not prove plugin
   discovery, command/Skill loading, hooks, agents, SessionStart, or an MCP
   connection.
6. Before any host-managed mutation (marketplace trust/add, plugin install,
   Settings connector, account, credential, or remote provider), ask for
   explicit approval naming the exact action. Never automate trust or install.
7. After approval, give exactly one concrete GUI/host action and wait. Do not
   bundle discovery, installation, reload, and verification in one handoff.
8. After the user responds, inspect the corresponding app with Computer Use and
   record only what is visibly observed. If Computer Use is unavailable, a
   user-pasted verbatim status or screenshot counts as observed evidence. If a
   reload or new session is needed, issue the next single action, wait, and
   inspect again.
9. Verify one real Skill or command and every expected MCP connection for the
   selected route. Report the observed host result separately from package
   readiness; without observation, **HOST READINESS: PENDING** remains the only
   honest result.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route and the preferred CodeBuddy IDE route whenever the CodeBuddy CLI is
available**. CodeBuddy IDE GUI loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. None of those labels proves the current build:
without current observation, **HOST READINESS: PENDING**.

The supplied macOS QA dated 2026-07-18 observed CodeBuddy IDE full-plugin
loading through the CLI-backed user-scope marketplace route. It inspected
WorkBuddy v5.2.6 on macOS and recorded full-plugin loading only after
undocumented host-internal changes. That is historical observed behavior, not
an installation route. The GUI Add local directory/Install flows failed in
that tested build; the CodeBuddy exact host version/build was not recorded.

## Host artifact boundary

| Host | Safe package artifact | Host action and expected observation |
| --- | --- | --- |
| **CodeBuddy IDE** | When the CLI is available (`codebuddy`), use the same user-scope release-root marketplace route as CodeBuddy CLI. The desktop GUI route is only an observed-build alternative; the supplied GUI add-local-directory flow failed. | Use the CLI marketplace handoff below, then inspect the IDE's fresh session. If the CLI is unavailable, record that limitation and use the Skills/manual-MCP fallback. |
| **CodeBuddy CLI** | The release-root `.codebuddy-plugin/marketplace.json` and package checks. Use the exact local marketplace commands below; `--plugin-dir` is development/testing only and never persistent. | Use the three separate CodeBuddy handoff actions below. After installation and a fresh session inspect one real Skill/command and all six MCP connections. |
| **WorkBuddy fallback** | Skills import/copy from `lazybuddy-plugin/skills/` only, plus six individual manual local MCP connectors. | After approval, import Skills and add each connector manually in Settings. Observe one imported Skill and all six connector statuses. Unless a full plugin session is actually observed, do not claim that files or load-check output loaded commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | Historical observation only; no supported public installation contract was verified. | Do not reproduce undocumented host-internal changes. Use the Skills/manual-MCP fallback and keep unsupported capabilities pending. |

## CodeBuddy local marketplace handoff

The supported local route uses the **release root** (the directory containing
`.codebuddy-plugin/marketplace.json`) printed by durable
`status --route codebuddy-marketplace`, not a source checkout or the nested
`lazybuddy-plugin/` directory:

```text
codebuddy plugin marketplace add <active-durable-release-root>
codebuddy plugin install lazybuddy@lazybuddy
```

Run these terminal commands against the absolute release root. Inside a
CodeBuddy session, the interactive `/plugin` menu is equivalent; do not use the
slash forms as terminal commands. Do not automate marketplace trust or
installation, and do not treat `--plugin-dir <absolute-release-root>`
as persistence.

These are three separate future user actions:

1. **Action 1 — discover:** after approval, add the absolute release root with
   `codebuddy plugin marketplace add <active-durable-release-root>` (or the
   equivalent interactive `/plugin` menu inside CodeBuddy), then wait while the
   agent uses Computer Use to observe that
   `lazybuddy@lazybuddy` is discovered. Do not install yet.
2. **Action 2 — install:** after a separate approval, enter
   `codebuddy plugin install lazybuddy@lazybuddy`, then wait while the agent
   observes the install result. Do not restart in the same action.
3. **Action 3 — restart and observe:** as a later action, start a fresh
   CodeBuddy session, then let the agent inspect one real Skill/command plus all
   six MCP connections.

Do not combine these actions, pre-approve trust, or claim host readiness from
the marketplace JSON alone. Repeating safe package checks preserves existing
project configuration.

## CodeBuddy IDE GUI alternative (observed-build only)

Use this only when the current CodeBuddy IDE visibly offers a local-directory
marketplace **and the CodeBuddy CLI route is unavailable**. The supplied build's
GUI Add local directory flow failed, so do not send users here by default. Each
numbered item is a separate action:

1. After approval, use the host's **Plugins / Marketplace → Add local
   directory** GUI to select the absolute release root containing
   `.codebuddy-plugin/marketplace.json`; then wait for inspection.
2. Observe `lazybuddy@lazybuddy` version `1.0.3` in that marketplace. Do not
   install in the discovery action. If discovery is unavailable, record the
   host version/build and exact error, keep **HOST READINESS: PENDING**, and use
   the fallback below only after selecting it explicitly.
3. After separate approval, click the GUI **Install** action for
   `lazybuddy@lazybuddy`; then wait for the install result.
4. Fully quit the host; then wait.
5. Reopen the host; then wait.
6. Start a fresh project session; then wait for inspection.
7. In the fresh session, inspect one real LazyBuddy Skill or command and live
   calls to all six MCP servers. Files, cache entries, and connector counts are
   not substitutes for those calls.

## WorkBuddy observed-build boundary

The supplied macOS WorkBuddy build did **not** complete through its GUI Install
action: it hung in an orphaned `plugin validate`. Do not click that action or
direct a user to it.

The agent may render/check package inputs without changing WorkBuddy:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh \
  --project-dir <absolute-project-root>
```

This preflight is read-only and prints `HOST_PREPARATION=not-applied`,
`HOST_MUTATION=none`, and `HOST_READINESS=pending`; `--apply` refuses. The
supplied QA is feedback about one build, not authorization to reproduce
undocumented host state. Use the Skills/manual-MCP fallback. It provides Skills
plus six connectors only, never commands, agents, or hooks.

## CodeBuddy project-local configuration

`.codebuddy/settings.json` may hold shareable, non-secret project defaults.
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Package checks and repeated safe
setup preserve both files and do not write host configuration.

## CodeBuddy IDE / WorkBuddy Skills/manual-MCP fallback

Import only `lazybuddy-plugin/skills/` through the selected host's Skills UI or
its documented local import. Add each compatible local MCP connector manually in
Settings: `run-ledger`, `verification`, `status-dashboard`, `context-graph`,
`code-intel`, and `docs`. A package file, manifest, or `load-check` result is
not a live host session and must never be described as loading commands,
agents, hooks, or MCP. If the user supplies real full-plugin proof from a
loaded session, record that observation before relying on any broader surface.
This fallback explicitly excludes commands, Agents, and hooks.

Before changing host settings, prepare the connector values without mutation
from `lazybuddy-plugin/.mcp.json`: replace `${CODEBUDDY_PLUGIN_ROOT}` with the
absolute `<release-root>/lazybuddy-plugin` and `${CODEBUDDY_PROJECT_DIR}` with
the absolute `<project-root>`. Every entry must use `command: bash`, one
absolute `args` path
`<release-root>/lazybuddy-plugin/mcp/<server>/server.sh`, `cwd: <project-root>`,
and environment values `CWD=<project-root>` and
`CODEBUDDY_PROJECT_DIR=<project-root>`. The six `<server>` values are exactly
`run-ledger`, `verification`, `status-dashboard`, `context-graph`,
`code-intel`, and `docs`. Do not edit the shipped `.mcp.json`. The paste-ready
six-entry template is in [Host routes](docs/reference/host-routes.md#manual-connector-specification).
After approval, add one connector, handle any trust prompt as a separate
action, wait for inspection, and only then continue to the next server.

Do not run a full plugin route and the `manual-skills-mcp-fallback` together;
coexistence is unsupported and may duplicate Skills or MCP processes. To
switch, stop the session, remove only LazyBuddy's old plugin/Skills entry and
six connectors through the host UI, choose one route, start a fresh session,
then verify that route. Each step is a separate approved action.

## Safe package commands

```bash
# Run from the active durable release; these are package checks only.
node "<install-root>/LazyBuddy/launcher.js" status --project "<project-root>"
```

Do not enable optional remote, browser, or architecture capabilities during
onboarding. `--plugin-dir` is development/testing only, never persistent, and
does not replace the local marketplace route.

## `offboard` protocol

When the user types `offboard`, ask which host and whether CodeBuddy plugin
installation or WorkBuddy Skills/manual connectors are being removed. Run
durable `offboard` without `--yes`, present the exact product-root plan, and
repeat with `--yes` only after confirmation. Inspect
the selected package receipt first, remove only exact receipt-owned local
assets, and preserve unknown, modified, linked, caller-owned, project, and
host-managed paths. Use the host's own plugin/Skills removal flow for host
state. Report package result separately from the user-observed host result in a
new session; never scan or guess host directories and never remove another
host's settings. An upgrade rollback must likewise remove only v1.0.3
receipt-owned assets after approval; never overwrite user-modified v1.0.2
assets.
Recovery is limited to an explicitly verified lifecycle-owned sibling bootstrap
lock or product `staging/`/`locks/` artifact; the caller workspace is always
preserved.

If `status` reports `STALE_RUNTIME`, do not edit `active.json` or receipts.
Use a fresh checkout from the verified GitHub origin for scoped offboard and
re-onboard with the current Node.js LTS runtime. Treat `rollback/` as retained
recovery evidence, not a hand-edit surface. A moved same-version ref likewise
requires the printed full SHA and explicit `--confirm-revision <full-sha>`.
