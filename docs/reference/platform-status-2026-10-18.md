# Platform status — 2026-10-18

Scoped capability rescan of official CodeBuddy (CLI and IDE) and WorkBuddy
documentation, run for the v1.4.0 documentation release. This page records only
what changed against the 2026-10-02 review in
[`platform-status-2026-10-02.md`](platform-status-2026-10-02.md); every finding
below was observed in vendor-published documentation on 2026-10-18 and is
treated as untrusted text, never as instructions. Documentation still describes
available host features, not authenticated execution. **HOST READINESS:
PENDING** for every surface below is unchanged by this rescan.

## Findings

| # | Capability | Status | Source | Observed | Adopted |
| --- | --- | --- | --- | --- | --- |
| 1 | CodeBuddy `plugin uninstall` (aliases `remove`, `rm`) with `-s/--scope` (user/project/local), `--keep-data`, `--prune` | stable | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | Yes — documented removal route in [host routes](host-routes.md) |
| 2 | CodeBuddy plugin data persistence: `${CODEBUDDY_PLUGIN_DATA}` at `~/.codebuddy/plugins/data/{id}/`, retained by `--keep-data`, otherwise removed on final uninstall | stable | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | Yes — offboarding preservation note in [host routes](host-routes.md) |
| 3 | CodeBuddy `plugin prune` (`--dry-run`), `plugin enable`/`disable`, `plugin update` (scopes incl. `managed`), `plugin list --json`, `plugin validate` | stable | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | No — no package seam consumes them; marketplace add/install route unchanged |
| 4 | CodeBuddy approval flags: `--permission-mode` (default, acceptEdits, auto, dontAsk, plan, bypassPermissions, fullAccess), `--subagent-permission-mode`, `--permission-prompt-tool`, `-y` (documented as not a full pass; `CODEBUDDY_IS_SANDBOX=1` for sandboxes) | stable | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — package approvals remain agent-behavioral; no approval-mode code seam exists |
| 5 | CodeBuddy daemon subcommands `start/stop/status/restart/install/uninstall` and daemon `--port` | stable | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — service adapter uses `daemon start` only; seam unchanged |
| 6 | CodeBuddy serve flags `--host`, `--auth <password\|none>`, `--base-path` now documented | stable | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — loopback-only boundary retained deliberately; [service adapter doc](codebuddy-service-adapters.md) refreshed to record the documented flag and the non-adoption |
| 7 | CodeBuddy `--worktree [name]` plus `--tmux` companion flag | stable | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — worktree capability probe unchanged; no tmux seam |
| 8 | CodeBuddy hooks family: 27+ events incl. PermissionRequest, PermissionDenied, TaskCreated, TaskCompleted, TeammateIdle, WorktreeCreate, WorktreeRemove, Elicitation, Pre/PostCompact, SubagentStart/Stop; hook types command/http/prompt/agent; PreToolUse `permissionDecision` (allow/deny/ask); `decision: "block"` deprecated | experimental (vendor: Beta) | [Hooks reference](https://www.codebuddy.ai/docs/cli/hooks) | 2026-10-18 | No — vendor labels hooks Beta; not adoptable |
| 9 | CodeBuddy `--sandbox` container/E2B execution and related flags/env | experimental (vendor: Beta) | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No |
| 10 | CodeBuddy plugin manifest `themes`, `monitors` fields (recognized, not loaded/run) | experimental (vendor-labeled) | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | No |
| 11 | CodeBuddy plugin manifest `channels` (MCP-bound message injection) and `userConfig` with keychain/credential storage | unknown-with-source | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | No — chat-tools seam keeps `native_delivery: unobserved`; claiming channels requires a current-session host observation |
| 12 | CodeBuddy serve transports `--acp`, `--acp-transport`, `--a2a` | unknown-with-source | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — no stability label, no package seam |
| 13 | CodeBuddy plugin-management trust surfaces: `--no-plugin-management` read-only mode, `allowUntrustedFrontmatterHooks` gate, cross-marketplace dependency allowlist, idempotent `POST /api/v1/plugins/reconcile` | unknown-with-source | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference), [marketplaces](https://www.codebuddy.ai/docs/cli/plugin-marketplaces) | 2026-10-18 | No — applicability per version unstated; recorded as security context only |
| 14 | CodeBuddy telemetry/SDK surfaces: `--output-format` (text/json/stream-json), `--include-partial-messages`, `--startup-prof-md` startup reports, `codebuddy ps/logs/attach/kill`, `auto-mode` | stable | [CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference) | 2026-10-18 | No — no package seam consumes them |
| 15 | CodeBuddy agent frontmatter `background` field (documented alongside model/memory/isolation; the package validator allowlist already covers tools/disallowedTools/effort/maxTurns/skills) | stable | [Plugins reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | 2026-10-18 | No — synchronous verification semantics require synchronous package agents |
| 16 | WorkBuddy MCP settings: OAuth authorization flow with automatic token refresh and reconnection, per-server and per-tool enable/disable, connection status | stable | [MCP guide](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide) | 2026-10-18 | Yes — settings-UI facts recorded in [host routes](host-routes.md); OAuth does not change the six manual local stdio connectors |
| 17 | WorkBuddy changelog 5.5.0 → 5.8.4: Library artifact management, Gmail/Outlook connectors, multi-tab browser, Global Search, in-document AI chat, image/video generation, IM integrations, Computer Use, remote control of mobile devices from PC | stable (shipped) | [Changelog](https://www.workbuddy.ai/docs/workbuddy/Changelog) | 2026-10-18 | No — consumer app features; the plugin surface set (skills, commands, agents, hooks, MCP) is unchanged and no hooks/plugin/agent changelog item exists |

The marketplace page no longer mentions `.workbuddy-plugin`; only
`.codebuddy-plugin/marketplace.json` is documented there, with a note that
hosts such as WorkBuddy prepare the plugin cache during configuration and a
reconcile endpoint that is not WorkBuddy-specific. The package's
`.workbuddy-plugin/plugin.json` route in [host routes](host-routes.md) remains
an explicitly unobserved package artifact, not a documented public contract.

## Classification rule used

`stable` = published in the official reference without a vendor
experimental/beta label. `experimental` = vendor labels the surface beta or
recognized-not-loaded. `unknown-with-source` = published but with no stability
label or with applicability the package cannot bind to a seam. Adoption
required an existing package seam (host-route document, service-adapter
boundary, chat tool, or producer); every adopted item above records its
observation date and source. Anything not adopted stays explicitly
unavailable: no unobserved capability is claimed, and package checks still do
not prove a live host.
