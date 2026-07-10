# LazyBuddy plan

This directory holds the versioned implementation plan for LazyBuddy — a WorkBuddy-native recreation of LazyCodex. The whole project is a **version 0 build** (pre-1.0), so every phase is numbered `v0.N`.

## Version index

| File | Phase | Purpose |
| --- | --- | --- |
| [v0.0-discovery.md](v0.0-discovery.md) | Discovery | Discover LazyCodex contract and WorkBuddy host surface |
| [v0.1-architecture.md](v0.1-architecture.md) | Architecture | Full WorkBuddy-native architecture plan |
| [v0.2-project-memory.md](v0.2-project-memory.md) | Project memory | Project memory, rules, command constitution |
| [v0.3-plugin-scaffold.md](v0.3-plugin-scaffold.md) | Plugin scaffold | Installable WorkBuddy plugin shell |
| [v0.4-skills-commands.md](v0.4-skills-commands.md) | Skills & commands | LazyCodex-style WorkBuddy workflows |
| [v0.5-subagents.md](v0.5-subagents.md) | Subagents | Planner, implementer, verifier, reviewer, librarian |
| [v0.6-hooks-safety.md](v0.6-hooks-safety.md) | Hooks & safety | Deterministic lifecycle enforcement |
| [v0.7-run-ledger.md](v0.7-run-ledger.md) | Run ledger & loop | Checkpoints, logs, resumable runs |
| [v0.8-mcp-dashboard.md](v0.8-mcp-dashboard.md) | MCP & dashboard | Tools, prompts, dashboard, source capture |
| [v0.9-hardening.md](v0.9-hardening.md) | Hardening | Quality gates and memory updates |
| [v0.10-migration.md](v0.10-migration.md) | Migration | Reusable cross-platform adapter system |
| [v0.11-dogfood.md](v0.11-dogfood.md) | Dogfood | End-to-end self-test |
| [v0.12-release.md](v0.12-release.md) | Diagnostics & release hardening | Diagnosis, fixes, release preparation |

> **v0.13** (release) is the final phase. Add-ons (automation runner, channels, MCP apps dashboard) are deferred to v1 (post-1.0).

## Implementation order

1. Paste the benchmark contract.
2. Paste v0.0 and wait for the discovery files.
3. Paste v0.1 and review the architecture.
4. Paste v0.2–v0.7 to get a real working core (the MVP).
5. Paste v0.8–v0.10 to add tools, dashboard, and migration capability.
6. Paste v0.11 to dogfood.
7. Paste v0.12 to finalize.
8. Use optional add-ons (v0.13) only after v0.7.

---

Yes — here is the full LazyBuddy plan, shaped like your LazyTrae/LazyBuddy prompt packs, but specifically for Tencent workbuddy / workbuddy Code.

The key design change is this:

LazyBuddy should be a workbuddy-native plugin plus a repo-local .workbuddy/ operating layer.
The plugin gives installable Skills, Agents, Hooks, MCP servers, and optional LSP/tooling. The repo-local .workbuddy/ layer gives project memory, rules, permissions, local command docs, and parity evidence.

That matches workbuddy’s official extension model: plugins can package Skills, Agents, Hooks, MCP servers, and LSP servers; plugin Skills live under skills/ or commands/; plugin Agents live under agents/; hooks use hooks/hooks.json; MCP servers can be bundled through .mcp.json or plugin.json; and plugin metadata lives in .codebuddy-plugin/plugin.json.

workbuddy also has exactly the host-native primitives this needs: workbuddy.md, .workbuddy/rules, project-level Skills, Commands, Agents, and settings; Skills are reusable workflow/domain capabilities, while slash commands are user-invoked shortcuts; subagents have separate context windows and configurable tool access; Plan Mode supports read-only planning; Hooks can intercept lifecycle/tool/session/task events; MCP connects external tools/data; Headless Mode and the HTTP API support automation; Channels can bridge sessions to WeChat, Telegram, and Discord; and the Agent SDK can run programmatic workflows with explicit permission/resource controls.

---

LazyBuddy benchmark contract

Use this as the first message in the LazyBuddy workspace before the version prompts.

You are participating in a platform benchmark.
Platform:
Tencent workbuddy / workbuddy Code.
Project name:
LazyBuddy.
Goal:
Recreate, migrate, or reinterpret the original LazyCodex project inside this workbuddy workspace using workbuddy-native mechanisms. The original LazyCodex repo is already present in this workspace and must be treated as the canonical source of truth.
Important constraints:
1. Do not invent LazyCodex behavior from memory.
2. Inspect the LazyCodex repo directly before planning implementation.
3. Preserve the original LazyCodex methods, command semantics, naming conventions, workflow phases, verification philosophy, and repo intent wherever possible.
4. You may adapt the implementation creatively to workbuddy’s native strengths.
5. Do not create a shallow copy. Build a real working workbuddy-native recreation.
6. Keep similar names when they communicate parity with LazyCodex, but add workbuddy-native names where useful.
7. Produce evidence at every version: files inspected, files changed, commands run, tests run, unresolved risks, and next steps.
8. Prefer implementation over discussion once a version plan is approved.
9. Always include verification gates.
10. The final result must be usable by a developer inside workbuddy without needing the original LazyCodex runtime.
11. Do not copy source code, prompts, assets, internal role text, or protected material unless the repo license and project owner explicitly allow it. When in doubt, preserve behavior semantically and document the clean-room adaptation.
12. Treat workbuddy official mechanisms as first-class implementation surfaces:
    - workbuddy.md
    - .workbuddy/rules
    - .workbuddy/settings.json
    - .workbuddy/agents
    - .workbuddy/skills
    - .workbuddy/commands
    - workbuddy plugin structure
    - Skills and SKILL.md
    - Slash commands
    - Subagents
    - Hooks
    - MCP servers
    - Plan Mode
    - Headless Mode
    - HTTP API / ACP if useful
    - Agent SDK if useful
    - Channels / Remote Control if useful
    - LSP/code-intelligence integration if useful
Primary deliverables:
- A LazyCodex canonical method map generated from the original repo.
- A workbuddy official capability map.
- A LazyCodex-to-LazyBuddy adaptation map.
- A workbuddy-native architecture plan.
- A versioned implementation plan.
- Working plugin files, project rules, skills, commands, agents, hooks, MCP configs, scripts, and verification checks.
- A durable autonomous-run ledger.
- A final parity report comparing original LazyCodex behavior to LazyBuddy behavior.
Canonical LazyCodex concepts to look for in the repo:
- Deep initialization / workspace understanding.
- Project memory such as AGENTS.md or equivalent.
- Planning workflow.
- Autonomous execution workflow.
- Long-running loop workflow.
- Reviewer / verifier behavior.
- Librarian / memory behavior.
- Migration planner behavior.
- Skill files or command files.
- Subagent or role prompts.
- MCP configuration or tool configuration templates.
- Hooks.
- Verification scripts.
- CLI commands, slash commands, shell wrappers, package scripts, or task runners.
- Any README, docs, examples, tests, or demos that define intended behavior.
workbuddy-native concepts to map into:
- Project memory: workbuddy.md and .workbuddy/workbuddy.md.
- Rules: .workbuddy/rules/*.md.
- Skills: .workbuddy/skills/<skill>/SKILL.md and plugin skills/<skill>/SKILL.md.
- Commands: .workbuddy/commands/*.md and plugin commands/*.md.
- Agents: .workbuddy/agents/*.md and plugin agents/*.md.
- Hooks: plugin hooks/hooks.json and project settings hooks if appropriate.
- MCP: plugin .mcp.json and/or mcpServers in plugin.json.
- Plugin: .codebuddy-plugin/plugin.json plus root-level skills/, commands/, agents/, hooks/, mcp/, scripts/.
- Automation: headless mode, HTTP API, Agent SDK, or channel bridge only where they improve host-native operation.
Output requirement for every phase:
Use this format:
- What I inspected
- What I found
- What I changed
- How to run it
- Verification performed
- Remaining gaps
- Next prompt to paste

---

LazyBuddy official surface map

Use this table as the planning baseline.

LazyCodex behavior	LazyBuddy host-native implementation
Deep init / repo understanding	/init-deep command + init-deep Skill + context indexer agent + .lazybuddy/context/ evidence
AGENTS.md project memory	workbuddy.md, .workbuddy/workbuddy.md, .workbuddy/rules/lazybuddy.md, optional compatibility AGENTS.md
Planning workflow	workbuddy Plan Mode plus /ulw-plan command and planner subagent
Autonomous work start	/start-work command + coordinator agent + bounded task executor
Long-running loop	/ulw-loop command + durable run ledger + hooks + verification/repair loop
Reviewer	workbuddy reviewer subagent + reviewer Skill
Verifier	verifier Skill + deterministic scripts + test discovery
Librarian	librarian Skill that updates memory, command index, parity ledger, and known gaps
Migration planner	migration-planner Skill and host-adapter templates
Subagents / role prompts	workbuddy project/plugin agents with YAML frontmatter and restricted tool access
Skills	workbuddy Skills under plugin skills/ and project .workbuddy/skills/
Commands	workbuddy slash command Markdown files under plugin commands/ and project .workbuddy/commands/
Hooks	SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, Stop, StopFailure, TaskCreated, TaskCompleted, SubagentStart, SubagentStop
MCP tools	Plugin .mcp.json with LazyBuddy run-ledger, source-map, verification, git, test, and dashboard tools
Parallel agents	workbuddy subagents and optional team/task mechanisms; use read-only parallelism and coordinator-only merges
Durable progress	.lazybuddy/runs/<run_id>/state.json, events.jsonl, checkpoints/, agent_outputs/
Remote/async UX	Headless mode, HTTP API, Channels, or persistent session bridge
Visual status	Optional MCP Apps dashboard for run state, parity ledger, approvals, and verification
Code intelligence	Optional LSP plugin config and project test discovery

---

Version sequence overview

Version	Purpose	Main output
v0.0	Discover LazyCodex contract and workbuddy host surface	Method map + capability map
v0.1	Architecture and implementation design	Versioned execution plan
v0.2	Project memory, rules, command constitution	.workbuddy/ foundation
v0.3	Plugin scaffold	Installable LazyBuddy plugin shell
v0.4	Skills and slash commands	LazyCodex-style workbuddy workflows
v0.5	Subagents and orchestration	Planner, implementer, verifier, reviewer, librarian, orchestrator
v0.6	Hooks, permissions, and safety gates	Deterministic lifecycle enforcement
v0.7	Durable run ledger and autonomous loop	Checkpoints, logs, resumable runs
v0.8	MCP/tool layer and optional dashboard	Tools, prompts, dashboard, source capture
v0.9	Verifier/reviewer/librarian hardening	Quality gates and memory updates
v0.10	Migration planner and host adapters	Reusable cross-platform adapter system
v0.11	Dogfood run	End-to-end self-test
v0.12	Final release and parity report	Usable LazyBuddy package

---

Recommended implementation order

Use this sequence exactly:

1. Paste the benchmark contract.
2. Paste v0.0 and wait for the discovery files.
3. Paste v0.1 and review the architecture.
4. Paste v0.2–v0.7 to get a real working core.
5. Paste v0.8–v0.10 to add tools, dashboard, and migration capability.
6. Paste v0.11 to dogfood.
7. Paste v0.12 to finalize.
8. Use optional add-ons only after v0.7:
    * automation runner
    * remote/channel status
    * MCP Apps dashboard

The MVP is v0.0–v7. The strong benchmark version is v0.0–v12.

---
