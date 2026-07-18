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
**pending**.

| Host route | Safe package artifact | Required host observation |
| --- | --- | --- |
| **CodeBuddy IDE** | Copied package, manifest, local checks, and six local MCP declarations. | After approval, use the host plugin flow. In a new session observe one `/lazybuddy:lazy-<command>` or Skill and all six MCP connections: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, and `docs`. |
| **CodeBuddy CLI** | Absolute release-root marketplace metadata and package validation. The nested `lazybuddy-plugin/` path is not the marketplace root. | Use the two separate actions below. After installation and a fresh session observe one real Skill/command plus all six MCP connections. |
| **WorkBuddy Skills fallback** | Import/copy `lazybuddy-plugin/skills/` only, then configure each of six local MCP connectors manually. | After approval, observe one imported Skill and each manual connector in Settings. Files and load-check output do not prove WorkBuddy commands, agents, hooks, or MCP. |
| **WorkBuddy full plugin** | A full plugin/marketplace artifact is conditional; compatibility metadata alone is package evidence. | Only a real loaded WorkBuddy session can prove broader plugin behavior. Do not rely on it until that proof is observed. |

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

The CodeBuddy handoff has two separate future user actions:

1. **Discover:** after approval, add the absolute release root and wait while
   the agent uses Computer Use to observe discovery of `lazybuddy@lazybuddy`.
   Do not install yet.
2. **Install and observe:** after a separate approval, install
   `lazybuddy@lazybuddy`, start a fresh CodeBuddy session, and inspect one real
   Skill/command plus all six MCP connections.

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

## Package boundary and removal

`lazybuddy-load-check.sh`, `lazybuddy-plugin-doctor.sh`, and local metadata
validation establish package readiness only. They do not prove plugin
discovery, marketplace activation, SessionStart, hook execution, a running
session, or MCP connection. Use the host's own plugin/Skills removal flow and
remove only connectors the user added. Never scan or guess host paths; report
package removal separately from the user-observed host result.
