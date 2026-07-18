# AGENTS.md — LazyBuddy local onboarding

This is the reusable `v1.0.2` consumer template, not a claim that a host loaded
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
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. None is current host proof until observed.

## CodeBuddy CLI local marketplace

Use the absolute release root containing `.codebuddy-plugin/marketplace.json`:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

Enter the add command, wait for discovery, then enter the install command only
after separate approval and wait again. Start a fresh session as the next
action. The interactive `/plugin` menu is equivalent. `--plugin-dir
<absolute-local-LazyBuddy-path>` is development/testing only, never persistent.

`.codebuddy/settings.json` is shareable non-secret project scope.
`.codebuddy/settings.local.json` is ignored local/machine scope and must remain
unstaged; secrets must never be committed.

## IDE and WorkBuddy fallback

CodeBuddy IDE's public fallback and WorkBuddy's supported local fallback import
`lazybuddy-plugin/skills/` and configure six local MCP connectors manually:
`run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`,
and `docs`. This route excludes commands, agents, and hooks. A package file,
manifest, or load-check never proves those capabilities or MCP loaded.

Do not run a full plugin route and the `manual-skills-mcp-fallback` together;
coexistence is unsupported. To switch, stop the session, remove only old
LazyBuddy entries through the host UI, choose one route, start a fresh session,
and verify it. Each host mutation is separately approved.

Read the root `workbuddy.md` when present; a nearer child `workbuddy.md` refines
that guidance.
Optional remote, browser, and architecture capabilities retain their own
approval lifecycle and are never enabled by onboarding.
