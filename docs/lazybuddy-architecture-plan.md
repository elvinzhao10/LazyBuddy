# LazyBuddy Architecture Plan

> v0.1 — Full WorkBuddy-native architecture design
> Traces every claim to [dev/reference/lazycodex/](../dev/reference/lazycodex/)

## Table of Contents

1. [Overview](#overview)
2. [Layer Model](#layer-model)
3. [Component Map](#component-map)
4. [Data Flow](#data-flow)
5. [LazyCodex → LazyBuddy Method Trace](#lazycodex--lazybuddy-method-trace)
6. [Design Decisions](#design-decisions)

## Overview

LazyBuddy is a three-layer system that recreates the LazyCodex/OmO agent harness inside WorkBuddy:

| Layer | Location | Purpose | Lifecycle |
|-------|----------|---------|-----------|
| **Plugin** | `lazybuddy-plugin/` | Reusable, installable behavior (Skills, Agents, Hooks, MCP) | Installed once; active across all workspaces |
| **Project Memory** | `.workbuddy/` | Repo-local behavior, rules, settings, local skills/agents | Per-repo; travels with git |
| **Run State** | `.lazybuddy/` | Durable per-run progress, checkpoints, evidence | Per-run; ephemeral after completion |

This mirrors LazyCodex's architecture:
- The `omo` plugin (= Plugin layer) provides installable Skills, Hooks, MCP servers — traced to `dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json`
- `AGENTS.md` + `.codex/` config (= Project Memory layer) provides repo-local context — traced to `dev/reference/lazycodex/README.md` (Section "Use the built-in workflows")
- `.omo/` directory (= Run State layer) provides durable progress — traced to `dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md` (Phase 2: Boulder state)

## Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│                    LAZYBUDDY PLUGIN                      │
│  lazybuddy-plugin/                                       │
│  ├── .codebuddy-plugin/plugin.json     ← manifest            │
│  ├── skills/                           ← 25+ Skills          │
│  ├── commands/                         ← slash commands       │
│  ├── agents/                           ← 9+ subagents         │
│  ├── hooks/hooks.json                  ← 12 lifecycle hooks   │
│  ├── .mcp.json                         ← 3-5 MCP servers      │
│  └── scripts/                          ← verification utils   │
├─────────────────────────────────────────────────────────────┤
│                  PROJECT MEMORY (.workbuddy/)                 │
│  .workbuddy/                                                 │
│  ├── workbuddy.md                      ← AGENTS.md compat    │
│  ├── rules/lazybuddy.md            ← project rules        │
│  ├── settings.json                     ← project settings     │
│  ├── skills/                           ← local Skills         │
│  ├── commands/                         ← local commands       │
│  └── agents/                           ← local subagents      │
├─────────────────────────────────────────────────────────────┤
│                  RUN STATE (.lazybuddy/)                  │
│  .lazybuddy/                                              │
│  ├── runs/<run_id>/                                             │
│  │   ├── state.json                    ← boulder.json equiv   │
│  │   ├── events.jsonl                  ← ledger.jsonl equiv   │
│  │   ├── checkpoints/                  ← snapshot state       │
│  │   └── evidence/                     ← QA artifacts         │
│  └── plans/                            ← .omo/plans/ equiv    │
└─────────────────────────────────────────────────────────────┘
```

## Component Map

### Plugin Components (from lazybuddy-plugin/)

| LazyCodex Source | WorkBuddy Implementation | Rationale |
|-----------------|-------------------------|-----------|
| `skills/init-deep/` ([source](../dev/reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md)) | `skills/init-deep/SKILL.md` | WorkBuddy Skill replaces Codex skill; same hierarchical AGENTS.md generation logic |
| `skills/ulw-plan/` ([source](../dev/reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md)) | `skills/ulw-plan/SKILL.md` | Prometheus planner; WorkBuddy Plan Mode integration |
| `skills/start-work/` ([source](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md)) | `skills/start-work/SKILL.md` | Orchestrator; spawns WorkBuddy subagents instead of Codex `multi_agent_v1` |
| `skills/ulw-loop/` ([source](../dev/reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md)) | `skills/ulw-loop/SKILL.md` | Verified completion loop; .lazybuddy/ state instead of .omo/ |
| `skills/ultrawork/` ([source](../dev/reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md)) | `skills/ultrawork/SKILL.md` | Binding ultrawork directive; tier triage (LIGHT/HEAVY) |
| `skills/review-work/` ([source](../dev/reference/lazycodex/plugins/omo/skills/review-work/SKILL.md)) | `skills/review-work/SKILL.md` | 5-agent parallel review; WorkBuddy subagent equivalents |
| `hooks/` (21 hooks) ([source](../dev/reference/lazycodex/plugins/omo/hooks/)) | `hooks/hooks.json` (12 hooks) | WorkBuddy-native hook events; subset mapped to LazyCodex semantics |
| `.mcp.json` (5 servers) ([source](../dev/reference/lazycodex/plugins/omo/.mcp.json)) | `.mcp.json` (3-5 servers) | Run ledger, verification, optional git/codegraph |

### Project Memory Components (from .workbuddy/)

| Purpose | File | LazyCodex Equivalent |
|---------|------|---------------------|
| Project knowledge base | `.workbuddy/workbuddy.md` | `AGENTS.md` (root) — traced to `init-deep` skill Phase 3 |
| Project rules | `.workbuddy/rules/lazybuddy.md` | `.codex/rules/` — traced to `rules` skill |
| Settings | `.workbuddy/settings.json` | `.codex/config.toml` sections |
| Local skills | `.workbuddy/skills/` | Project-specific skill overrides |
| Local commands | `.workbuddy/commands/` | Custom slash commands |
| Local agents | `.workbuddy/agents/` | `~/.codex/agents/` roles |

### Run State Components (from .lazybuddy/)

| Purpose | File | LazyCodex Equivalent |
|---------|------|---------------------|
| Active work state | `.lazybuddy/runs/<run_id>/state.json` | `.omo/boulder.json` — traced to `start-work` Skill Phase 2 |
| Evidence ledger | `.lazybuddy/runs/<run_id>/events.jsonl` | `.omo/start-work/ledger.jsonl` — traced to Phase 4 |
| Checkpoints | `.lazybuddy/runs/<run_id>/checkpoints/` | No direct equivalent (new capability) |
| Plan cache | `.lazybuddy/plans/` | `.omo/plans/` — traced to `ulw-plan` Skill |
| Context index | `.lazybuddy/context/` | Generated by `init-deep` |

## Data Flow

### Core Workflow (happy path)

```
User types "/lazy-ulw-plan build a login page"
  │
  ├─► WorkBuddy loads ulw-plan Skill from plugin
  │     └─► Reads .workbuddy/workbuddy.md for project context
  │     └─► Spawns planner subagent (explorer role)
  │     └─► Writes plan to .lazybuddy/plans/<slug>.md
  │     └─► Returns approval gate
  │
  ├─► User approves; types "/lazy-start-work <slug>"
  │     └─► WorkBuddy loads start-work Skill
  │     └─► Creates run state in .lazybuddy/runs/<run_id>/state.json
  │     └─► Decomposes plan into atomic sub-tasks
  │     └─► Spawns worker subagents (implementer, QA, reviewer)
  │     └─► Appends evidence to events.jsonl
  │     │
  │     └─► Stop hook fires (SubagentStop → check continuation)
  │           └─► If unchecked work remains → re-inject start-work
  │
  ├─► All checkboxes done
  │     └─► Run review-work Skill (5-agent review)
  │     └─► All 5 lanes PASS → mark run completed
  │     └─► Print "ORCHESTRATION COMPLETE"
```

### Hook Flow

```
SessionStart
  ├─► Load project rules from .workbuddy/rules/
  ├─► Check bootstrap provisioning
  └─► Initialize run state tracking

UserPromptSubmit
  ├─► Check for ultrawork trigger keywords
  ├─► Check for ulw-loop steering commands
  └─► Inject applicable skill directives

PreToolUse
  ├─► Enforce budget/iteration limits
  └─► Recommend appropriate tools

PostToolUse
  ├─► Check comments/diagnostics
  ├─► Match project rules
  └─► Update run state

PostToolUseFailure
  └─► Log failure to run ledger; trigger repair flow

PreCompact
  ├─► Reset caches (rules, diagnostics, git reminders)
  └─► Preserve active run state

Stop / SubagentStop
  ├─► Check start-work continuation (unchecked checkboxes → re-inject)
  ├─► Verify executor evidence (done claims checked by verifier)
  └─► Update boulder state

TaskCreated / TaskCompleted
  └─► Track task lifecycle in run ledger
```

## LazyCodex → LazyBuddy Method Trace

Every claim traces to a specific file in `dev/reference/lazycodex/`:

| LazyCodex Method | Source File | LazyBuddy Implementation |
|-----------------|-------------|------------------------------|
| Plugin packaging | `plugins/omo/.codex-plugin/plugin.json` | `.codebuddy-plugin/plugin.json` |
| Hierarchical AGENTS.md | `plugins/omo/skills/init-deep/SKILL.md` | `init-deep` Skill → `.workbuddy/workbuddy.md` |
| Prometheus planning | `plugins/omo/skills/ulw-plan/SKILL.md` | `ulw-plan` Skill + WorkBuddy Plan Mode |
| Boulder progress | `plugins/omo/skills/start-work/SKILL.md` Phase 2 | `.lazybuddy/runs/<run_id>/state.json` |
| Orchestrator delegate | `plugins/omo/skills/start-work/SKILL.md` Phase 3 | WorkBuddy subagent spawning (Agent tool) |
| Evidence ledger | `plugins/omo/skills/start-work/SKILL.md` Phase 4 | `.lazybuddy/runs/<run_id>/events.jsonl` |
| Sisyphus completion contract | `plugins/omo/skills/start-work/SKILL.md` Phase 4 (DoneClaim/AdversarialVerify) | Verifier subagent + state machine |
| 5-agent review | `plugins/omo/skills/review-work/SKILL.md` | `review-work` Skill + 5 WorkBuddy subagents |
| Ultrawork tier triage | `plugins/omo/skills/ultrawork/SKILL.md` | `ultrawork` Skill (LIGHT/HEAVY) |
| UWL loop | `plugins/omo/skills/ulw-loop/SKILL.md` | `ulw-loop` Skill + run ledger loop |
| Stop continuation | `plugins/omo/hooks/stop-checking-start-work-continuation.json` | WorkBuddy `Stop` hook |
| Subagent evidence verify | `plugins/omo/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json` | WorkBuddy `SubagentStop` hook with matcher |
| Session rules loading | `plugins/omo/hooks/session-start-loading-project-rules.json` | WorkBuddy `SessionStart` hook |
| MCP tools (5 servers) | `plugins/omo/.mcp.json` | `lazybuddy-plugin/.mcp.json` |
| Agent roles (9) | Installed to `~/.codex/agents/` | `agents/*.md` with YAML frontmatter |

## Design Decisions

### Why three layers?

LazyCodex has three layers too: the `omo` plugin, `AGENTS.md`/`.codex/`, and `.omo/`. We preserve this separation because:
- **Plugin** = shareable, versionable, installable (like the `omo` plugin)
- **Project memory** = repo-local, travels with git (like `AGENTS.md`)
- **Run state** = ephemeral, per-run, should not be committed (like `.omo/`)

### Why Skills + Agents instead of monolithic commands?

LazyCodex's `start-work` is an orchestrator that spawns subagents for implementation, QA, and review. WorkBuddy's subagent model (with `tools`, `disallowedTools`, `skills`, `memory`, `isolation` YAML frontmatter) is a closer match to LazyCodex's `agent_type` routing than monolithic commands. Skills provide the workflow knowledge; Agents provide the isolated execution contexts.

### Why 12 hooks instead of 21?

LazyCodex uses 21 hooks, but many are Codex-specific (e.g., `post-tool-use-checking-comments` for comment-checker, `*codegraph*` hooks). WorkBuddy's 26 hook events map cleanly to the 12 lifecycle events we need: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `Stop`, `StopFailure`, `TaskCreated`, `TaskCompleted`, `SubagentStart`, `SubagentStop`. The remaining LazyCodex hooks are either Codex-specific surface details or can be embedded within Skill logic.

### Why `.lazybuddy/` instead of `.omo/`?

Clean-room adaptation: we preserve the durable run state concept but use a WorkBuddy-branded directory name. The schema (state.json, events.jsonl, checkpoints/) is semantically equivalent to LazyCodex's boulder.json + ledger.jsonl.

### Why MCP for run ledger, not just files?

LazyCodex uses a CLI (`omo ulw-loop`) to manage `.omo/` state. WorkBuddy MCP servers provide structured tool access to the run ledger, making it queryable, appendable, and inspectable from both Skills and external tooling. This is a creative WorkBuddy-native advantage over file-only access.

### Why `${CODEBUDDY_PLUGIN_ROOT}` in paths?

Confirmed via [CodeBuddy plugin reference](https://staging-codebuddy.tencent.com/docs/cli/plugins-reference): this is the official env var for plugin-bundled scripts. LazyCodex uses `${PLUGIN_ROOT}` equivalently in its hooks (traced to `hooks/stop-checking-start-work-continuation.json` line 7).

---

_All LazyCodex behavior claims trace to file paths in `dev/reference/lazycodex/`. WorkBuddy capability claims trace to [CodeBuddy docs](https://www.codebuddy.cn/docs/cli/hooks) and [plugin reference](https://staging-codebuddy.tencent.com/docs/cli/plugins-reference)._
