# Lazyworkbuddy Parity Ledger

> Living ledger tracking Lazyworkbuddy vs LazyCodex parity.
> Updated by the Librarian after every accepted change.
>
> Status: `matched` (confirmed equivalent) | `adapted` (semantics preserved, implementation differs) | `skipped` (intentionally not ported) | `added` (Lazyworkbuddy-only)

## Initial Method Map (v0.2 baseline)

Derived from the method map in `AGENTS.md` and the v0.1 architecture plan. All statuses are initial assessments — they will be refined as each version is implemented.

### Core Workflows

| LazyCodex Method | LazyCodex Source | Lazyworkbuddy Implementation | Status | Notes |
|-----------------|------------------|------------------------------|--------|-------|
| Deep init (`$init-deep`) | [init-deep/SKILL.md](../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md) | `/init-deep` command + `init-deep` Skill + context indexer | **adapted** | Hierarchical memory generation; output target changed from AGENTS.md to workbuddy.md |
| Planning (`$ulw-plan`) | [ulw-plan/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md) | WorkBuddy Plan Mode + `/ulw-plan` command + planner agent | **adapted** | Prometheus semantics preserved; WorkBuddy Plan Mode replaces Codex-specific plan mode |
| Execution (`$start-work`) | [start-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) | `/start-work` command + orchestrator agent + bounded executor | **adapted** | Orchestrator-delegate pattern preserved; WorkBuddy Agent tool replaces `multi_agent_v1` |
| Verified loop (`$ulw-loop`) | [ulw-loop/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md) | `/ulw-loop` command + run ledger + hooks | **adapted** | Goal-evidence loop preserved; `.lazyworkbuddy/` replaces `.omo/` |
| Ultrawork mode | [ultrawork/SKILL.md](../reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md) | `/ultrawork` command + `ultrawork` Skill | **adapted** | Tier triage, Manual-QA channels, bootstrap — all preserved |
| 5-agent review | [review-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) | `/review-work` command + WorkBuddy subagents | **adapted** | 5 independent lanes preserved; WorkBuddy Agent tool replaces Codex task spawning |
| Project memory | AGENTS.md (root + subdirs) | `workbuddy.md` + `.workbuddy/rules/` | **adapted** | Root file renamed; hierarchical subdir approach preserved in concept |
| Boulder progress | `.omo/boulder.json` | `.lazyworkbuddy/runs/<run_id>/state.json` | **adapted** | Schema expanded with checkpoints and explicit progress tracking |
| Evidence ledger | `.omo/start-work/ledger.jsonl` | `.lazyworkbuddy/runs/<run_id>/events.jsonl` | **adapted** | Format preserved; additional event types added |
| Sisyphus completion contract | DoneClaim/AdversarialVerify/FullyDone | Same names, same transitions | **matched** | Exact semantic match — the three-state contract is preserved verbatim |

### Agent Roles

| LazyCodex Role | LazyCodex Source | Lazyworkbuddy Agent | Status | Notes |
|---------------|------------------|---------------------|--------|-------|
| Orchestrator (Sisyphus) | [start-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) | `orchestrator` agent | **adapted** | Never-implements-directly rule preserved |
| Planner (Prometheus) | [ulw-plan/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md) | `planner` agent | **adapted** | Never-writes-product-code rule preserved |
| Explorer | Installed to `~/.codex/agents/` | `explorer` agent | **adapted** | Read-only exploration; same role semantics |
| Librarian | Installed to `~/.codex/agents/` | `librarian` agent | **adapted** | Memory/index/parity maintenance |
| Oracle (Verifier) | Referenced in start-work + review-work | `verifier` agent + `gate-reviewer` agent | **adapted** | Split into two agents for cleaner responsibility |
| Reviewer (Momus/Metis) | Installed to `~/.codex/agents/` | `reviewer` agent | **adapted** | Combined into single agent with 5 review dimensions |
| QA Executor | Installed to `~/.codex/agents/` | `qa-executor` agent | **adapted** | Same hands-on QA execution role |
| Code Reviewer | Installed to `~/.codex/agents/` | Integrated into `reviewer` agent | **adapted** | Merged into multi-dimensional reviewer |
| Implementation Worker | Spawned dynamically | `implementer` agent | **adapted** | Same scoped-file-access pattern |

### Hooks

| LazyCodex Hook | LazyCodex Source | Lazyworkbuddy Hook | Status | Notes |
|---------------|------------------|--------------------|--------|-------|
| Session rules loading | [session-start-loading-project-rules.json](../reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json) | `SessionStart` | **adapted** | Same purpose; WorkBuddy native event |
| Ultrawork trigger | [user-prompt-submit-checking-ultrawork-trigger.json](../reference/lazycodex/plugins/omo/hooks/user-prompt-submit-checking-ultrawork-trigger.json) | `UserPromptSubmit` | **adapted** | Keyword detection preserved |
| Loop steering | [user-prompt-submit-checking-ulw-loop-steering.json](../reference/lazycodex/plugins/omo/hooks/user-prompt-submit-checking-ulw-loop-steering.json) | `UserPromptSubmit` | **adapted** | Merged into single UserPromptSubmit hook |
| Prompt-time rule loading | [user-prompt-submit-loading-project-rules.json](../reference/lazycodex/plugins/omo/hooks/user-prompt-submit-loading-project-rules.json) | `UserPromptSubmit` | **adapted** | Project rules loaded on prompt submit; merged with SessionStart loading |
| Budget enforcement | [pre-tool-use-enforcing-unlimited-goal-budget.json](../reference/lazycodex/plugins/omo/hooks/pre-tool-use-enforcing-unlimited-goal-budget.json) | `PreToolUse` | **adapted** | Budget enforcement preserved |
| Comment checking | [post-tool-use-checking-comments.json](../reference/lazycodex/plugins/omo/hooks/post-tool-use-checking-comments.json) | `PostToolUse` | **adapted** | Diagnostics checking merged into PostToolUse |
| LSP diagnostics | [post-tool-use-checking-lsp-diagnostics.json](../reference/lazycodex/plugins/omo/hooks/post-tool-use-checking-lsp-diagnostics.json) | WorkBuddy native LSP | **skipped** | WorkBuddy has native LSP integration — no hook needed |
| Rule matching | [post-tool-use-matching-project-rules.json](../reference/lazycodex/plugins/omo/hooks/post-tool-use-matching-project-rules.json) | `PostToolUse` | **adapted** | Merged into PostToolUse |
| Start-work continuation (Stop) | [stop-checking-start-work-continuation.json](../reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json) | `Stop` | **adapted** | Continuation re-injection preserved |
| Start-work continuation (SubagentStop) | [subagent-stop-checking-start-work-continuation.json](../reference/lazycodex/plugins/omo/hooks/subagent-stop-checking-start-work-continuation.json) | `SubagentStop` | **adapted** | Same behavior; merged with evidence verification |
| Executor evidence verify | [subagent-stop-verifying-lazycodex-executor-evidence.json](../reference/lazycodex/plugins/omo/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json) | `SubagentStop` | **adapted** | Evidence verification preserved; matcher pattern adapted |
| Bootstrap provisioning | [session-start-checking-bootstrap-provisioning.json](../reference/lazycodex/plugins/omo/hooks/session-start-checking-bootstrap-provisioning.json) | `SessionStart` | **adapted** | Merged into SessionStart |
| Auto-update check | [session-start-checking-auto-update.json](../reference/lazycodex/plugins/omo/hooks/session-start-checking-auto-update.json) | (none) | **skipped** | WorkBuddy plugin update mechanism differs |
| Codegraph bootstrap | [session-start-checking-codegraph-bootstrap.json](../reference/lazycodex/plugins/omo/hooks/session-start-checking-codegraph-bootstrap.json) | (none) | **skipped** | Codegraph is Codex-specific; not applicable to WorkBuddy |
| Telemetry recording | [session-start-recording-session-telemetry.json](../reference/lazycodex/plugins/omo/hooks/session-start-recording-session-telemetry.json) | (none) | **skipped** | Telemetry handled differently in WorkBuddy |
| Git Bash MCP recommend | [pre-tool-use-recommending-git-bash-mcp.json](../reference/lazycodex/plugins/omo/hooks/pre-tool-use-recommending-git-bash-mcp.json) | `PreToolUse` | **adapted** | Tool recommendation merged |
| Post-compact resets (all 3) | Various | `PreCompact` | **adapted** | All cache resets merged into single PreCompact |
| Thread title hygiene | [post-tool-use-checking-thread-title-hygiene.json](../reference/lazycodex/plugins/omo/hooks/post-tool-use-checking-thread-title-hygiene.json) | (none) | **skipped** | WorkBuddy thread management differs |
| Codegraph init guidance | [post-tool-use-checking-codegraph-init-guidance.json](../reference/lazycodex/plugins/omo/hooks/post-tool-use-checking-codegraph-init-guidance.json) | (none) | **skipped** | Not applicable |

### Lazyworkbuddy-Only Additions

| Addition | Description | Status | Justification |
|----------|-------------|--------|---------------|
| `PostToolUseFailure` hook | Log tool failures to run ledger | **added** | Enhances LazyCodex: durable failure tracking for autonomous recovery |
| `StopFailure` hook | Attempt recovery on stop failure | **added** | Enhances LazyCodex: graceful degradation in edge cases |
| `SubagentStart` hook | Track subagent lifecycle | **added** | Enhances LazyCodex: explicit subagent lifecycle for debugging |
| `TaskCreated` hook | Run ledger entry on task creation | **added** | Enhances LazyCodex: task-level tracking in state ledger |
| `TaskCompleted` hook | Progress update on task completion | **added** | Enhances LazyCodex: explicit task lifecycle events |
| `run-ledger` MCP | Structured run state access | **added** | WorkBuddy-native advantage over file-only access |
| `verification` MCP | Structured verification test runner | **added** | WorkBuddy-native advantage |
| `parity-dashboard` MCP | Compare Lazyworkbuddy vs LazyCodex behavior | **added** | WorkBuddy-native advantage; parity visualization |
| Checkpoint protocol | Periodic state snapshots | **added** | Enhances LazyCodex: explicit crash recovery (not in original) |
| Migration planner Skill | Reusable cross-platform adapter | **added** | Generalizes our adaptation methodology |
| `state.json` progress tracking | Explicit completion_percentage | **added** | Enhances LazyCodex: explicit progress (LazyCodex's boulder.json is implicit) |
| `state.json` iteration tracking | Iteration count + cap | **added** | Enhances LazyCodex: explicit loop management |

## Parity Summary

| Category | Total LazyCodex Methods | Matched | Adapted | Skipped | Added |
|----------|------------------------|---------|---------|---------|-------|
| Core Workflows | 10 | 1 | 9 | 0 | 0 |
| Agent Roles | 9 | 0 | 9 | 0 | 0 |
| Hooks | 21 | 0 | 14 | 7 | 5 |
| MCP Servers | 5 | 0 | 1 | 4 | 3 |
| State/Durability | 3 | 0 | 3 | 0 | 4 |
| **TOTAL** | **48** | **1** | **36** | **11** | **12** |

**Parity Health:** 🔧 Early stage — architecture is designed, behavior is semantically preserved. v0.3 plugin scaffold is built. Expect matched/adapted ratios to shift as each version is implemented.

## v0.3 Update — Plugin Scaffold (2026-07-09)

The plugin scaffold (`lazyworkbuddy-plugin/`) is now structurally complete:

- `.workbuddy-plugin/plugin.json` — valid manifest with all required fields (name, version, skills, commands, agents, hooks, mcpServers, interface)
- 8 placeholder commands + 8 placeholder skills (stubs for v0.4+)
- `hooks/hooks.json` — 12 event types with empty arrays
- `.mcp.json` — empty `mcpServers: {}`
- 4 validation scripts (doctor, smoke-test, docs-check, parity-check)
- README.md, CHANGELOG.md

**Status shifts from v0.2:**
- Plugin packaging: `adapted` → `scaffolded` (manifest exists, components are placeholders)
- All 8 core command/skill entries: remain `adapted` (structure exists; semantics not yet implemented)
- Hook scaffold: new `added` entry (hooks.json structure exists; logic not yet implemented)

## v0.4 Update — Skills & Commands Ported (2026-07-09)

14 skills ported from LazyCodex with full WorkBuddy-native adaptation:

**Skills with preserved LazyCodex semantics:**
- `init-deep` — hierarchical project memory generation (workbuddy.md + `.lazyworkbuddy/context/`)
- `ulw-plan` — decision-complete work planning (Prometheus planner)
- `start-work` — Sisyphus orchestrator with evidence verification
- `ulw-loop` — verified completion loop with binding success criteria
- `ultrawork` — tier triage, Manual-QA channels, bootstrap
- `review-work` — 5-agent parallel post-implementation review
- `programming` — strict coding discipline (7 axioms, TDD, 250 LOC ceiling)
- `remove-ai-slops` — behavior-preserving cleanup with regression tests
- `git-master` — git workflow discipline (COMMIT/REBASE/HISTORY/STATUS modes)
- `debugging` — hypothesis-driven debugger (2 disciplines, 11-phase loop, 8 safety invariants)
- `verifier` — independent evidence verification (AdversarialVerify)
- `reviewer` — multi-dimensional review (Momus/Metis framework)
- `librarian` — memory/index/parity maintenance
- `migration-planner` — cross-platform migration workflow

**8 command files written** replacing v0.3 placeholders. Each command includes usage syntax, inputs, outputs, success criteria, link to skill, and link to constitution.

**Status shifts from v0.3:**
- 14 skills: `adapted` → `implemented` (full WorkBuddy-native SKILL.md with semantic preservation)
- 8 commands: `scaffolded` → `implemented` (full command definitions replacing placeholders)
- 6 core commands: `adapted` → `implemented` in command index

**Tool translations applied across all ported files:**
- `multi_agent_v1` / `multi_agent_v1.spawn_agent` → WorkBuddy Agent tool
- `.omo/` → `.lazyworkbuddy/`
- `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`
- `AGENTS.md` → `workbuddy.md`
- Codex task spawning → WorkBuddy subagent invocation with `isolation: true`



---

_This ledger is authoritative. Every parity claim must be verified against `reference/lazycodex/` before updating. Updated by the Librarian (v0.9+) and manually until then._
