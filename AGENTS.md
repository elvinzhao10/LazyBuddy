# AGENTS.md — Lazyworkbuddy project memory

> Project memory for any agent working in this workspace. Read this first.

## What this project is

**Lazyworkbuddy** is a WorkBuddy-native recreation of [LazyCodex](https://github.com/code-yeongyu/lazycodex) — the OmO agent harness packaged for Codex. The goal is to rebuild LazyCodex's core workflows (deep init, planning, autonomous execution, verification loops, review, memory) using WorkBuddy's native extension mechanisms: Skills, Agents, Hooks, MCP, and plugin structure.

This is a **clean-room adaptation**, not a copy. Preserve LazyCodex semantics and behavior; reimplement them on WorkBuddy-native surfaces. Do not copy source code, prompts, or protected material unless the license explicitly allows it.

The original LazyCodex repo is cloned under `reference/lazycodex/` and is the **canonical source of truth** for LazyCodex behavior. Inspect it directly before planning implementation — never guess from memory.

## Versioning

This is a **version 0 build** (pre-1.0). Every phase is numbered `v0.N`, not `vN`:

- `v0.0` discovery → `v0.1` architecture → ... → `v0.12` release
- `v0.13` optional add-ons, `v0.14` evaluation rubric
- The MVP is v0.0–v0.7; the strong benchmark is v0.0–v0.12

## Directory layout

```
lazyworkbuddy/
├── AGENTS.md                # this file — project memory
├── plan/                    # versioned implementation plan (one md per version)
│   ├── README.md            # index + benchmark contract + surface map
│   ├── v0.0-discovery.md    # ... through v0.14-evaluation-rubric.md
├── reference/
│   └── lazycodex/           # canonical LazyCodex repo (read-only reference)
├── scripts/
│   └── migrate-plan.py      # plan migration utility
└── .workbuddy/              # WorkBuddy workspace config (memory, skills, etc.)
```

Planned build artifacts (created in later versions):
- `lazyworkbuddy-plugin/` — the installable WorkBuddy plugin (`.workbuddy-plugin/plugin.json` + `skills/`, `commands/`, `agents/`, `hooks/`, `mcp/`, `scripts/`)
- `.lazyworkbuddy/` — durable run state (`runs/<run_id>/state.json`, `events.jsonl`, `checkpoints/`)
- `docs/` — method maps, parity ledger, architecture docs

## WorkBuddy extension model (verified against official docs)

Confirmed via [CodeBuddy plugin reference](https://staging-codebuddy.tencent.com/docs/cli/plugins-reference) and [hooks reference](https://www.codebuddy.cn/docs/cli/hooks):

| Surface | Location | Notes |
| --- | --- | --- |
| Plugin manifest | `.workbuddy-plugin/plugin.json` | Supported as compat fallback to `.codebuddy-plugin/`. Only `name` is required. |
| Skills | `skills/<name>/SKILL.md` | Reusable workflow capabilities. New code should use Skills, not commands. |
| Commands | `commands/*.md` | Legacy slash commands (plain markdown). |
| Agents | `agents/*.md` | Subagents with YAML frontmatter: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `isolation`. |
| Hooks | `hooks/hooks.json` | 26 event types. Plugin hooks are active when plugin is enabled (not gated by `allowUntrustedFrontmatterHooks`). |
| MCP | `.mcp.json` | Use `${CODEBUDDY_PLUGIN_ROOT}` for plugin-bundled scripts, `${CODEBUDDY_PLUGIN_DATA}` for persistent state. |
| LSP | `.lsp.json` | Optional code intelligence. |
| Project rules | `.workbuddy/rules/*.md` | Fired via `InstructionsLoaded` hook. |
| Project memory | `workbuddy.md` / `.workbuddy/workbuddy.md` | This AGENTS.md is the compatibility layer. |

**Hook events used by Lazyworkbuddy** (all confirmed real): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `Stop`, `StopFailure`, `TaskCreated`, `TaskCompleted`, `SubagentStart`, `SubagentStop`.

## Core rules (non-negotiable)

1. **Always inspect before editing.** Read the relevant files — both in this repo and in `reference/lazycodex/` — before making changes.
2. **Never guess LazyCodex behavior from memory.** Trace every claim to a source file path in `reference/lazycodex/`.
3. **Plan before multi-file changes.** Use Plan Mode or the `ulw-plan` workflow.
4. **Verify after implementation.** No completion claim without evidence (commands run, tests passed, artifacts produced).
5. **Review after verification.** A separate reviewer agent must accept before work is considered done.
6. **Update memory after accepted changes.** Keep this file, the parity ledger, and command index current.
7. **Never claim parity without evidence.** Log deviations from original LazyCodex behavior in `docs/lazyworkbuddy-known-gaps.md`.
8. **No secrets in memory or logs.** Redact tokens, credentials, PII before writing any file.
9. **For destructive actions, ask first.**
10. **Use `${CODEBUDDY_PLUGIN_ROOT}` / `${CODEBUDDY_PLUGIN_DATA}`** in plugin configs (the official env vars), not ad-hoc names.

## LazyCodex → Lazyworkbuddy method map (summary)

| LazyCodex behavior | WorkBuddy-native implementation |
| --- | --- |
| Deep init (`$init-deep`) | `/init-deep` command + `init-deep` Skill + context indexer agent |
| AGENTS.md project memory | `workbuddy.md` + `.workbuddy/rules/` + this `AGENTS.md` |
| Planning (`$ulw-plan`) | WorkBuddy Plan Mode + `/ulw-plan` command + planner subagent |
| Autonomous work (`$start-work`) | `/start-work` command + coordinator agent + bounded executor |
| Verification loop (`$ulw-loop`) | `/ulw-loop` command + durable run ledger + Stop/SubagentStop hooks |
| Reviewer / Verifier | Separate subagents with accept/reject/revise decisions |
| Librarian | Memory-updating Skill that maintains parity ledger |
| Subagent roles | WorkBuddy `agents/*.md` with scoped tool access |
| Hooks (21 in LazyCodex) | `hooks/hooks.json` with the 12+ lifecycle events above |
| Durable progress (`.omo/`) | `.lazyworkbuddy/runs/<run_id>/` state ledger |

Full detail lives in `plan/v0.0-discovery.md` (method map) and `plan/v0.1-architecture.md`.

## Per-version output format

Every version's work must report:
- What I inspected
- What I found
- What I changed
- How to run it
- Verification performed
- Remaining gaps
- Next prompt to paste
