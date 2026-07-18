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
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. These labels never prove the current build.

Public contract references: CodeBuddy documents [local plugin
marketplaces](https://www.codebuddy.ai/docs/cli/plugin-marketplaces),
[project settings scopes](https://www.codebuddy.ai/docs/cli/codebuddy-dir),
[IDE Skills](https://www.codebuddy.ai/docs/ide/Features/Skills), and [IDE MCP
JSON](https://www.codebuddy.ai/docs/ide/User-guide/MCP). WorkBuddy publicly
documents its [MCP settings UI](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide), not universal
directory-marketplace compatibility.

| Host route | Safe package artifact | Required host observation |
| --- | --- | --- |
| **CodeBuddy IDE** | Public guidance supports Skills import and MCP JSON. Plugin loading is an observed-build route, not a public marketplace guarantee. | Use the plugin route only after current discovery; otherwise import `lazybuddy-plugin/skills/` plus six manual connectors. In a new session observe one real Skill/command appropriate to the chosen route and all six MCP connections. |
| **CodeBuddy CLI** | Absolute release-root marketplace metadata and package validation. The nested `lazybuddy-plugin/` path is not the marketplace root. | Use the three separate actions below. After installation and a fresh session observe one real Skill/command plus all six MCP connections. |
| **WorkBuddy Skills fallback** | Import/copy `lazybuddy-plugin/skills/` only, then configure each of six local MCP connectors manually. | After approval, observe one imported Skill and each manual connector in Settings. Files and load-check output do not prove WorkBuddy commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | The supplied prerelease build exposed this observed-build route; compatibility metadata alone remains package evidence, not a public compatibility promise. | Only a real loaded WorkBuddy session can prove broader plugin behavior. Do not rely on it until that proof is observed. |

## CodeBuddy local marketplace

Pass the absolute **release root** containing `.codebuddy-plugin/marketplace.json`
to the local marketplace:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

The interactive `/plugin` menu is equivalent. `--plugin-dir
<absolute-local-LazyBuddy-path>` is for development/testing only, never
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

## WorkBuddy Skills/manual-MCP boundary

The supported copied-repository route is Skills-only import/copy from
`lazybuddy-plugin/skills/` plus six individual manual local MCP connectors in
Settings. A package file, manifest, or `lazybuddy-load-check.sh` result must
never be described as loading WorkBuddy commands, agents, hooks, or MCP. A full
plugin/marketplace route may be documented only after a real loaded host
session proves it; until then use the Skills/manual-MCP fallback.

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
