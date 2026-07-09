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
| `parity` MCP | Compare Lazyworkbuddy vs LazyCodex behavior | **added** | WorkBuddy-native advantage; parity visualization |
| `source-map` MCP | Index/search LazyCodex source evidence | **added** | WorkBuddy-native advantage; traceability to reference repo |
| `status-dashboard` MCP | Aggregate run/task/verification/parity status | **added** | WorkBuddy-native advantage; unified status view |
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
| MCP Servers | 5 | 0 | 0 | 5 | 5 |
| State/Durability | 3 | 0 | 3 | 0 | 4 |
| **TOTAL** | **48** | **1** | **35** | **12** | **14** |

**Parity Health:** ✅ v0.10 — architecture designed, behavior semantically preserved, all phases through v0.10 implemented. MCP servers are WorkBuddy-native (run-ledger/parity/verification/source-map/status-dashboard); LazyCodex's 5 context servers (context7/codegraph/lsp/git_bash/grep_app) are NOT ported — tracked as gap G-003 and P2 in the full problem list.

## v0.3 Update — Plugin Scaffold (2026-07-09)

The plugin scaffold (`lazyworkbuddy-plugin/`) is now structurally complete:

- `.workbuddy-plugin/plugin.json` — valid manifest with all required fields (name, version, skills, commands, agents, hooks, mcpServers, interface)
- 8 placeholder commands + 8 placeholder skills (stubs for v0.4+)
- `hooks/hooks.json` — 12 event types with empty arrays (populated with real commands in v0.6)
- `.mcp.json` — empty `mcpServers: {}` (populated with 5 WorkBuddy-native servers in v0.8 — see v0.8 Update below)
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

## v0.5 Update — Subagents & Orchestration (2026-07-09)

12 agent role definitions created in `lazyworkbuddy-plugin/agents/`:

**LazyCodex-mapped agents (8):**
- `lazyworkbuddy-orchestrator.md` — Sisyphus orchestrator (source: start-work/SKILL.md)
- `lazyworkbuddy-planner.md` — Prometheus planner (source: ulw-plan/SKILL.md)
- `lazyworkbuddy-explorer.md` — Codebase explorer (source: explorer.toml)
- `lazyworkbuddy-implementer.md` — Implementation executor (source: lazycodex-executor.toml)
- `lazyworkbuddy-verifier.md` — Oracle verifier (source: lazycodex-gate-reviewer.toml)
- `lazyworkbuddy-reviewer.md` — Momus+Metis reviewer (source: momus.toml + metis.toml)
- `lazyworkbuddy-qa-executor.md` — QA executor (source: lazycodex-qa-executor.toml)
- `lazyworkbuddy-gate-reviewer.md` — Final gate Oracle (source: lazycodex-gate-reviewer.toml)

**WorkBuddy-native agents (4):**
- `lazyworkbuddy-librarian.md` — Memory maintenance (source: librarian.toml)
- `lazyworkbuddy-migration-planner.md` — Host-adapter planning (Lazyworkbuddy innovation)
- `lazyworkbuddy-context-indexer.md` — Repo structure indexing (source: init-deep skill Phase 1)
- `lazyworkbuddy-security-auditor.md` — Security review (source: review-work Agent 4)

**Status shifts from v0.4:**
- All 12 agents: `planned` → `implemented` (valid YAML frontmatter with model, tools, disallowedTools)
- Agent roles section of initial method map: `adapted` → `implemented`
- 4 orchestration docs created: agent-inventory, agent-orchestration, handoff-protocol, parallelism-policy

## v0.6 Update — Hooks & Safety Gates (2026-07-09)

12 lifecycle hooks implemented with real enforcement logic:

**Enforcement hooks (3):**
- `Stop` — `stop-gate.sh` — prevents premature completion when unchecked work remains (state.json → plan checkbox parsing). Respects `stop_hook_active` and context pressure. LazyCodex source: [start-work-continuation/src/codex-hook.ts](../reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts)
- `SubagentStop` — `subagent-stop.sh` — verifies implementer evidence (`EVIDENCE_RECORDED: <path>` validation: inside root, exists, non-empty, not symlink). Max 3 retries. LazyCodex source: [lazycodex-executor-verify/src/codex-hook.ts](../reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/src/codex-hook.ts)
- `PreToolUse` — `pre-tool-use.sh` — blocks secret access, destructive deletes, force pushes, unauthorized publishes. Returns `permissionDecision: deny`. Complements `.workbuddy/settings.json`.

**Advisory hooks (9):**
- `SessionStart` — detect active run, load summary, warn if workbuddy.md missing
- `UserPromptSubmit` — detect command intent, warn on pasted secrets
- `PostToolUse` — append tool-use event to events.jsonl (redacted)
- `PostToolUseFailure` — append failure event with retry/fallback classification
- `PreCompact` — save run checkpoint to checkpoints/
- `StopFailure` — write failure record + recovery suggestion
- `TaskCreated` / `TaskCompleted` — mirror tasks to events.jsonl
- `SubagentStart` — record subagent lifecycle in events.jsonl

**Status shifts from v0.5:**
- All 12 hooks: `planned` → `implemented` (real commands + scripts)
- hooks.json populated with production-level hook configurations
- 4 docs created: hooks.md, permission-policy.md, safety-gates.md, hook-test-plan.md
- `hooks/hooks.json` replaced empty scaffold with real ${CODEBUDDY_PLUGIN_ROOT} commands

**Manual test verification:**
- Stop gate: blocks with 2 remaining tasks ✓, allows on stop_hook_active ✓
- PreToolUse: denies rm -rf ✓, denies .env access ✓, allows safe commands ✓
- SubagentStop: allows valid evidence ✓, blocks missing evidence ✓

## v0.7 Update — State Ledger & Autonomous Loop (2026-07-09)

State ledger infrastructure created:

- **.lazyworkbuddy/ directory:** context/, runs/<run_id>/{state.json, events.jsonl, plan.md, checkpoints/, evidence/, verification/, review/, agent_outputs/, artifacts/, memory_updates/, final_report.md}
- **10 state scripts:** create-run.sh, load-run.sh, update-task.sh, append-event.sh, checkpoint.sh, recover-run.sh, summarize-run.sh, validate-state.sh, list-runs.sh, latest-run.sh
- **5 loop scripts:** next-task.sh, run-cycle.sh, classify-failure.sh, create-repair-task.sh, finalize-run.sh
- **5 docs:** loop-protocol.md, checkpoint-format.md, runbook.md, state-schema.md, run-log-example.md
- **5 skills updated** with State Ledger Integration sections (start-work, ulw-loop, verifier, reviewer, librarian)
- **Hook compatibility:** stop-gate.sh updated to accept full lifecycle status values (created|planning|executing|blocked|verifying|reviewing) as active states

**Status shifts from v0.6:**
- Boulder progress (`.omo/boulder.json`): `adapted` → `implemented` (state.json + events.jsonl)
- Evidence ledger (`.omo/start-work/ledger.jsonl`): `adapted` → `implemented` (events.jsonl)
- Checkpoint protocol: `added` → `implemented`
- Run state durability: `added` → `implemented`

**End-to-end test verified:** create → add plan/tasks → next-task → update-task → checkpoint → stop-gate blocks → finalize refuses → classify-failure → events.jsonl populated (3 events)

_This ledger is authoritative. Every parity claim must be verified against `reference/lazycodex/` before updating. Updated by the Librarian (v0.9+) and manually until then._

## v0.8 Update — MCP Servers & Dashboard (2026-07-09)

5 MCP servers implemented providing 30 structured tools:

- **run-ledger** (9 tools): wraps v0.7 state scripts — create_run, list_runs, latest_run, read_state, summarize_run, append_event, update_task, create_checkpoint, recover_run
- **parity** (5 tools): reads parity-ledger.md + known-gaps.md — read_canonical_method_map, list_methods, compare_method_status, update_parity_ledger, generate_gap_report
- **verification** (6 tools): wraps v0.7 loop scripts + verification-matrix.md — discover_checks, run_check, record_gate_result, list_gate_results, create_repair_task, summarize_verification
- **source-map** (5 tools): reads reference/lazycodex/ + .lazyworkbuddy/context/ — index_repo, search_method_evidence, read_evidence_excerpt, list_source_paths, compute_file_hash
- **status-dashboard** (5 tools): aggregates from all other servers — show_run_status, show_task_graph, show_verification_matrix, show_parity_coverage, show_pending_approvals

**Additional v0.8 deliverables:**
- Dashboard mockup (dashboard.html) — static HTML with placeholder data; interactive MCP integration deferred to v0.9
- 5 MCP prompt commands: /lazyworkbuddy:status, :new-run, :resume, :verify, :parity-report
- 4 docs: mcp-and-tools.md, mcp-security.md, dashboard-design.md, enhancement-log.md
- .mcp.json populated with all 5 servers (bash command, required: false)

**Design decisions:**
- Shell + python3 for JSON-RPC (no Node.js dependency)
- All servers required: false (graceful degradation — skills fall back to direct v0.7 script calls)
- Run-ledger tools use v0.7 state scripts directly (thin wrapper, not reimplementation)

**Status shifts from v0.7:**
- MCP Servers: planned → implemented (5 servers, 30 tools)
- state.json progress tracking: matched (same schema as v0.7)
