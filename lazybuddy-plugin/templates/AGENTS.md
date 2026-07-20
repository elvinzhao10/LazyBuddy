# AGENTS.md — LazyBuddy local onboarding

This is the reusable `v1.0.3` consumer template, not a claim that a host loaded
the plugin. Explicit user instructions and nearer project instructions take
precedence.

## When the user types `onboard`

Keep the pinned release in a permanent folder. Open or link that folder in the
selected host, give the agent
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`.

1. Detect or ask for **CodeBuddy IDE**, **CodeBuddy CLI**, or **WorkBuddy**.
2. Resolve the absolute release/plugin root; never guess it from PATH or treat
   `--plugin-dir` as an installed route.
3. Run safe package checks only: from the release root, use
   `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` and
   `bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh`. Preserve project
   settings and do not change credentials, providers, or host settings.
4. Report **package readiness** separately. Files and declarations do not prove
   plugin discovery, commands, agents, hooks, SessionStart, or MCP connection.
5. Ask for explicit approval before marketplace trust/add, plugin install,
   Skills import, connector setup, account, credential, or provider changes.
6. After approval, give exactly one GUI/host action and wait. Discovery,
   install, reload/new session, and verification are separate actions.
7. Inspect the app with Computer Use after each response. If unavailable,
   accept a user-pasted verbatim status or screenshot as observed evidence.
8. Verify one real Skill/command appropriate to the selected route and all six
   MCP connections. Otherwise **HOST READINESS: PENDING**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route and the preferred CodeBuddy IDE route whenever the CodeBuddy CLI is
available**. CodeBuddy IDE GUI loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. None is current host proof until observed.

Supplied macOS QA dated 2026-07-18 observed CodeBuddy IDE full-plugin loading
through the CLI-backed user-scope marketplace route. It inspected WorkBuddy
v5.2.6 on macOS and observed full-plugin loading only after user-approved cache
preparation and the durable GUI `+` binding. The GUI Add local
directory/Install flows failed in that tested build; the CodeBuddy exact host
version/build was not recorded. A current unsupported build remains **HOST
READINESS: PENDING**.

## CodeBuddy CLI local marketplace

Use the absolute release root containing `.codebuddy-plugin/marketplace.json`:

```text
codebuddy plugin marketplace add <absolute-release-root>
codebuddy plugin install lazybuddy@lazybuddy
```

Enter the add command in the terminal, wait for discovery, then enter the
install command only after separate approval and wait again. Start a fresh
session as the next action. Inside a CodeBuddy session, the interactive
`/plugin` menu is equivalent; do not use the slash forms as terminal commands.
`--plugin-dir
<absolute-release-root>` is development/testing only, never persistent.

`.codebuddy/settings.json` is shareable non-secret project scope.
`.codebuddy/settings.local.json` is ignored local/machine scope and must remain
unstaged; secrets must never be committed.

## CodeBuddy IDE route

When the CLI is available (`codebuddy`), use the same release-root marketplace
route as CodeBuddy CLI:

```text
codebuddy plugin marketplace add <absolute-release-root>
codebuddy plugin install lazybuddy@lazybuddy
```

Fully restart the IDE as a later action and verify one real Skill/command plus
all six MCP servers. The supplied GUI Add local directory flow failed; use it only
as an observed-build alternative when the CLI is unavailable. If any GUI
control is unavailable, record the host version/build and exact error, keep
host readiness pending, and select the fallback only as a later action.

## WorkBuddy observed-build full-plugin route

The supplied WorkBuddy build did **not** complete through its GUI Install
action: it hung in an orphaned `plugin validate`. Do not click the GUI Install
action or direct a user to it. Do not hand-edit `known_marketplaces.json`; entries
added there were dropped on restart.

Before asking for that approval, run this read-only preflight from the release
root:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh \
  --project-dir <absolute-project-root>
```

It renders/checks the package inputs and six absolute MCP launchers, prints
`HOST_PREPARATION=not-applied`, `HOST_MUTATION=none`, and
`HOST_READINESS=pending`, and does not prepare the cache, register
`installed_plugins.json`, or prove host readiness. `--apply` refuses with no
host mutation because the WorkBuddy registry schema is private and unverified.
The supplied WorkBuddy v5.2.6 macOS QA observed the successful full-plugin route only after an agent
prepared a cache with the absolute MCP render and a registry update, followed
by the user's GUI `+` binding. Those artifacts are build-specific evidence, not
a generic filesystem recipe. Before any host-managed cache or registry
mutation, require both explicit user approval and current host-specific schema
inspection with a validated merge plan that preserves all existing user entries
and unknown fields. If that plan cannot be established, stop and use the
Skills/manual-MCP fallback. If it can be established and the user approves,
perform only that validated additive plan; never overwrite an unrecognized
registry or claim host readiness from the mutation. Then give exactly one GUI
action: open **Skills → Plugins**, find `lazybuddy`,
and click **+**; wait for inspection. That binding persisted across restarts in
the supplied build. Ask for a fresh session as a later action and inspect one
real Skill/command, 14 commands, 13 agents, 12 hooks, and all six MCP
connections. If `+` is unavailable after restart, use the Skills/manual-MCP
fallback; it provides Skills plus six MCP connectors only and never commands,
agents, or hooks. The fallback excludes commands, agents, and hooks.

## IDE and WorkBuddy fallback

CodeBuddy IDE's public fallback and WorkBuddy's supported local fallback import
`lazybuddy-plugin/skills/` and configure six local MCP connectors manually:
`run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`,
and `docs`. This route excludes commands, agents, and hooks. A package file,
manifest, or load-check never proves those capabilities or MCP loaded.

Prepare manual connector values without mutating the host: copy the six entries
from `lazybuddy-plugin/.mcp.json`, replace `${CODEBUDDY_PLUGIN_ROOT}` with the
absolute `<release-root>/lazybuddy-plugin`, and replace
`${CODEBUDDY_PROJECT_DIR}` with the absolute `<project-root>`. Each entry must
use `command: bash` and the absolute `args` path
`<release-root>/lazybuddy-plugin/mcp/<server>/server.sh`. Set `cwd` to
`<project-root>` and environment `CWD=<project-root>` plus
`CODEBUDDY_PROJECT_DIR=<project-root>`. The six servers are `run-ledger`,
`verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`.
Do not edit the shipped declaration. After approval add one connector, wait;
handle trust separately, wait; inspect it, then continue to the next server.

Do not run a full plugin route and the `manual-skills-mcp-fallback` together;
coexistence is unsupported. To switch, stop the session, remove only old
LazyBuddy entries through the host UI, choose one route, start a fresh session,
and verify it. Each host mutation is separately approved.

Read the root `workbuddy.md` when present; a nearer child `workbuddy.md` refines
that guidance.
Optional remote, browser, and architecture capabilities retain their own
approval lifecycle and are never enabled by onboarding.
