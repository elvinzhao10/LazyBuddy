# Host routes

Start with the pinned `v1.0.2` release in a permanent folder. Open or link it
in the selected host, give the agent
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`. The agent
detects or asks for the host, runs package checks and safe local setup, then
reports **package readiness** separately from **host readiness**.

Before a marketplace, plugin, Skills, connector, account, or credential change,
the agent asks for explicit approval. It then gives exactly one GUI/host action
and waits. After the response it inspects the app with Computer Use. A reload
or new session is a later one-action handoff. Verify one real Skill/command and
every expected MCP connection; without that observation, host readiness is
**pending**. If Computer Use is unavailable, a user-pasted verbatim status or
screenshot is observed evidence; otherwise **HOST READINESS: PENDING**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route and the preferred CodeBuddy IDE route whenever the CodeBuddy CLI is
available**. CodeBuddy IDE GUI loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. These labels never prove the current build.
The supplied macOS QA dated 2026-07-18 observed CodeBuddy IDE full-plugin
loading through the CLI-backed user-scope marketplace route. It inspected
WorkBuddy v5.2.6 on macOS and observed full-plugin loading only after approved
cache preparation and the durable GUI `+` binding. The GUI Add local
directory/Install flows failed in that tested build; the CodeBuddy exact host
version/build was not recorded. A different or unsupported build remains
**HOST READINESS: PENDING**.

Public contract references: CodeBuddy documents [local plugin
marketplaces](https://www.codebuddy.ai/docs/cli/plugin-marketplaces),
[project settings scopes](https://www.codebuddy.ai/docs/cli/codebuddy-dir),
[IDE Skills](https://www.codebuddy.ai/docs/ide/Features/Skills), and [IDE MCP
JSON](https://www.codebuddy.ai/docs/ide/User-guide/MCP). WorkBuddy publicly
documents its [MCP settings UI](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide), not universal
directory-marketplace compatibility.

| Host route | Safe package artifact | Required host observation |
| --- | --- | --- |
| **CodeBuddy IDE** | When the CLI is available (`codebuddy`), use the same user-scope release-root marketplace route as CodeBuddy CLI. The desktop GUI route is only an observed-build alternative; the supplied GUI Add local directory flow failed. | Use the CLI marketplace route below and inspect the IDE's fresh session. If the CLI is unavailable, record that limitation and choose the Skills/manual-MCP fallback explicitly. |
| **CodeBuddy CLI** | Absolute release-root marketplace metadata and package validation. The nested `lazybuddy-plugin/` path is not the marketplace root. | Use the three separate actions below. After installation and a fresh session observe one real Skill/command plus all six MCP connections. |
| **WorkBuddy Skills fallback** | Import/copy `lazybuddy-plugin/skills/` only, then configure each of six local MCP connectors manually. | After approval, observe one imported Skill and each manual connector in Settings. Files and load-check output do not prove WorkBuddy commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | The supplied build required user-approved cache preparation with absolute MCP launchers, followed by one user GUI `+` binding. This is build-specific evidence, not a public compatibility promise. | Only after current schema inspection, a validated additive merge plan, and explicit approval may that build-specific preparation be considered. Otherwise use the fallback; never use the broken GUI Install action. |

## CodeBuddy IDE GUI alternative (observed-build only)

This route is conditional for CodeBuddy IDE only, when the CodeBuddy CLI route
is unavailable and the current app visibly offers a local-directory
marketplace. It is not the documented CLI route and must not be inferred from
the presence of a manifest. The supplied build's GUI Add local directory flow
failed, so do not send users here by default. Perform one action, wait, and
inspect before the next:

1. After approval, open the host's **Plugins / Marketplace → Add local
   directory** GUI, choose the absolute release root containing
   `.codebuddy-plugin/marketplace.json`, and wait.
2. Inspect discovery of `lazybuddy@lazybuddy` version `1.0.2`; do not install in
   the discovery action. If the control or marketplace is absent, record the
   current host version/build and exact error as `UNAVAILABLE`, leave **HOST
   READINESS: PENDING**, and select the fallback only as a later action.
3. After separate approval, click **Install** for `lazybuddy@lazybuddy`, then
   wait and inspect the installation result.
4. Fully quit the host, then wait.
5. Reopen the host, then wait.
6. Start a fresh session for `<project-root>`, then wait for inspection.
7. Verify one real loaded Skill or command and make a live call through each of
   `run-ledger`, `verification`, `status-dashboard`, `context-graph`,
   `code-intel`, and `docs`. A marketplace row, cache, or connector-panel count
   is not live proof.

## WorkBuddy observed-build full-plugin route

The supplied macOS WorkBuddy build did **not** complete through its GUI Install
action: it hung in an orphaned `plugin validate` and did not create
the durable cache registration. Do not click the GUI Install action or direct
a user to it. Do not hand-edit `known_marketplaces.json`; entries added there were
dropped on restart.

Before requesting permission for this host-managed, build-specific procedure,
run this read-only preflight from the permanent release root:

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
action:

> In WorkBuddy, open **Skills → Plugins**, find `lazybuddy`, and click **+**.
> Wait for inspection.

That `+` binding persisted across restarts in the supplied build. As separate
later actions, ask the user to fully restart/open a fresh project session, then
inspect one real Skill or command, 14 commands, 13 agents, 12 hooks, and live
connections to `run-ledger`, `verification`, `status-dashboard`,
`context-graph`, `code-intel`, and `docs` (31 live tools were observed in that
build). If `+` is unavailable after restart, use the Skills/manual-MCP
fallback, which provides Skills plus six MCP connectors only and never
commands, agents, or hooks. The fallback excludes commands, agents, and hooks.

## CodeBuddy local marketplace

Pass the absolute **release root** containing `.codebuddy-plugin/marketplace.json`
to the local marketplace:

```text
codebuddy plugin marketplace add <absolute-release-root>
codebuddy plugin install lazybuddy@lazybuddy
```

Inside a CodeBuddy session, the interactive `/plugin` menu is equivalent; do
not use the slash forms as terminal commands. `--plugin-dir
<absolute-release-root>` is for development/testing only, never
persistent, and is not a marketplace install. Do not automate trust or
installation.

The CodeBuddy handoff has three separate future user actions:

1. **Discover:** after approval, add the absolute release root and wait while
   the agent uses Computer Use to observe discovery of `lazybuddy@lazybuddy`.
   Do not install yet.
2. **Install:** after a separate approval, install `lazybuddy@lazybuddy`, wait,
   and inspect the install result. Do not restart in the same action.
3. **Restart and observe:** as a later action, start a fresh CodeBuddy session,
   then inspect one real Skill/command plus all six MCP connections.

Do not combine these actions or claim host readiness from marketplace JSON.
`.codebuddy/settings.json` is the shareable non-secret project scope;
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Repeating safe package checks
preserves both files and does not write host configuration.

## Manual connector specification

This is the non-mutating, paste-ready source for the CodeBuddy IDE and
WorkBuddy Skills/manual-MCP fallback. Replace both placeholders with permanent
absolute paths before asking to change host settings. Do not edit the shipped
`lazybuddy-plugin/.mcp.json`.

```json
{
  "mcpServers": {
    "run-ledger": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/run-ledger/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    },
    "verification": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/verification/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    },
    "status-dashboard": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/status-dashboard/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    },
    "context-graph": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/context-graph/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    },
    "code-intel": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/code-intel/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    },
    "docs": {
      "command": "bash",
      "args": ["<release-root>/lazybuddy-plugin/mcp/docs/server.sh"],
      "cwd": "<project-root>",
      "env": {"CWD": "<project-root>", "CODEBUDDY_PROJECT_DIR": "<project-root>"}
    }
  }
}
```

Every entry uses `bash`, its absolute release-local `server.sh`, and explicit
consumer-project context in both `cwd` and the `CWD` /
`CODEBUDDY_PROJECT_DIR` environment. Never fall back to the package directory
or caller shell directory. After approval, add exactly one named connector,
wait; handle a trust prompt as a separate action, wait; then inspect that
connector before proceeding to the next one.

## CodeBuddy IDE / WorkBuddy Skills/manual-MCP boundary

The supported copied-repository route is Skills-only import/copy from
`lazybuddy-plugin/skills/` plus six individual manual local MCP connectors in
Settings. A package file, manifest, or `lazybuddy-load-check.sh` result must
never be described as loading commands, Agents, hooks, or MCP. The fallback
explicitly excludes commands, Agents, and hooks. Use the full-plugin route only
when the current loaded host proves it; otherwise retain **HOST READINESS:
PENDING** for unsupported capabilities.

### Route coexistence and migration

The full plugin route and the Skills/manual-MCP fallback are mutually exclusive
and unsupported together for a project. Do not import the fallback Skills or add its six manual MCP
connectors while a full LazyBuddy plugin session is active; the routes can
double-load Skills or MCP processes, and package checks cannot declare that
both routes are live.

To switch routes safely:

1. Stop the current host session.
2. Remove only LazyBuddy's old plugin/Skills entry and its six connectors using
   the host's own UI. Do not scan or edit host-private files.
3. Choose exactly one route: full plugin installation, or Skills import plus
   manual MCP connectors.
4. Start a fresh session and verify the selected route's required Skill or
   command and all six expected MCP connections.

The package result remains `readiness_scope=package-ready`; the fallback is the
`manual-skills-mcp-fallback` scope, while an observed build route or live host
proof must be recorded separately.

## Troubleshooting the handoff

- **Marketplace entry missing:** confirm the absolute path is the release root
  containing `.codebuddy-plugin/marketplace.json`, wait after the add action,
  and start a new session only as a later action. Do not substitute persistent
  `--plugin-dir`; it remains development/testing only, never persistent.
- **IDE plugin route unavailable:** use the documented Skills import and manual
  MCP JSON fallback. Do not claim commands, agents, or hooks on that route.
- **WorkBuddy shows duplicate Skills or MCP processes:** stop the session and
  follow the migration checklist above. Never keep plugin and manual routes
  active together.
- **Connector panel and live calls disagree:** record both as build-specific
  observations. Package checks and a panel count alone do not prove a live
  connection; verify each expected MCP through the current host surface.
- **MCP starts in the wrong project:** each manual connector must use the
  absolute release-owned launcher and explicit consumer project context. Stop
  rather than falling back to the package directory or caller shell directory.

## Minimal live-test prompt

After the approved setup and required fresh session, send:

> Use one loaded LazyBuddy Skill or command appropriate to this route for a
> harmless read-only project check. Then test `run-ledger`, `verification`,
> `status-dashboard`, `context-graph`, `code-intel`, and `docs`. Report the
> host/build and each capability as observed or unavailable with the exact
> error; keep package readiness separate from host readiness. Do not infer from
> files or connector counts.

## Package boundary and removal

`lazybuddy-load-check.sh`, `lazybuddy-plugin-doctor.sh`, and local metadata
validation establish package readiness only. They do not prove plugin
discovery, marketplace activation, SessionStart, hook execution, a running
session, or MCP connection. Use the host's own plugin/Skills removal flow and
remove only connectors the user added. Never scan or guess host paths; report
package removal separately from the user-observed host result.
