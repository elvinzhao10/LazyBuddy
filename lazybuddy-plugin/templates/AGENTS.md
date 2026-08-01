# AGENTS.md — LazyBuddy local onboarding

This is the reusable `v1.0.3` consumer template, not a claim that a host loaded
the plugin. Explicit user instructions and nearer project instructions take
precedence.

## When the user types `onboard`

Require **Node.js LTS 20 or newer** and **Git**. Bootstrap `onboard` only from
`https://github.com/elvinzhao10/LazyBuddy.git`, then use
`node "<install-root>/LazyBuddy/launcher.js"` for `update`, `status`,
`recover-bootstrap-lock`, and plan-first `offboard`. The exact durable tree is
`LazyBuddy/{active.json,launcher.js,releases/,receipts/,rollback/,staging/,locks/}`.
The source checkout may be deleted after promotion. Never install in a
temporary or cache directory.

If lifecycle state collides with an existing path, preserve the caller
workspace. Only an explicitly verified lifecycle-owned sibling bootstrap lock
or product `staging/`/`locks/` artifact is recoverable; never remove or replace
caller workspace files.

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
v5.2.6 on macOS and reported full-plugin behavior after undocumented
host-internal changes. That feedback is historical observation only, not an
installation route. The GUI flows failed in that tested build. A current
unsupported build remains **HOST READINESS: PENDING**.

## CodeBuddy CLI local marketplace

Run durable `status --route codebuddy-marketplace` and use its active durable
release root containing `.codebuddy-plugin/marketplace.json`:

```text
codebuddy plugin marketplace add "<active-durable-release-root>"
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
codebuddy plugin marketplace add "<active-durable-release-root>"
codebuddy plugin install lazybuddy@lazybuddy
```

Fully restart the IDE as a later action and verify one real Skill/command plus
all six MCP servers. The supplied GUI Add local directory flow failed; use it only
as an observed-build alternative when the CLI is unavailable. If any GUI
control is unavailable, record the host version/build and exact error, keep
host readiness pending, and select the fallback only as a later action.

## WorkBuddy observed-build boundary

The supplied WorkBuddy build did **not** complete through its GUI Install
action: it hung in an orphaned `plugin validate`. Do not click that action or
direct a user to it.

Before asking for that approval, run this read-only preflight from the release
root:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh \
  --project-dir "<absolute-project-root>"
```

It prints `HOST_PREPARATION=not-applied`, `HOST_MUTATION=none`, and
`HOST_READINESS=pending`; `--apply` refuses. Do not reproduce undocumented host
state from historical QA. Use the Skills/manual-MCP fallback; it provides
Skills plus six connectors only and excludes commands, agents, and hooks.

If durable `status` reports `STALE_RUNTIME`, use a fresh verified checkout for
scoped `offboard` and re-onboard. Do not edit receipts. A moved same-version
ref requires `--confirm-revision <full-sha>`. Package success never upgrades
**HOST READINESS: PENDING** without observation.

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
