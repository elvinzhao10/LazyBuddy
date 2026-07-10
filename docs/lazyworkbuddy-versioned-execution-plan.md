# Lazyworkbuddy Versioned Execution Plan

> v0.1 — Per-version plan for v0.2 through v0.12
> Traces version boundaries to [plan/README.md](../plan/README.md) benchmark contract

## Overview

The execution plan maps LazyCodex concepts to WorkBuddy-native implementations version by version. Each version has: **objective**, **files to create/modify**, **implementation steps**, **verification steps**, **success criteria**, **rollback strategy**, **known risks**, and **acceptance criteria**.

Version boundary source: [plan/README.md](../plan/README.md) Version Sequence Overview, and [plan/v0.1-architecture.md](../plan/v0.1-architecture.md) Required Output Files.

---

## v0.2 — Project Memory, Rules, and Command Constitution

### Objective
Establish the `.workbuddy/` foundation: project memory (`workbuddy.md`), project rules, and the command constitution that mirrors LazyCodex's `AGENTS.md` + rule-loading hooks.

**LazyCodex source:** `init-deep` skill ([reference](../dev/reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md)), rules skill, and `session-start-loading-project-rules` hook ([reference](../dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json)).

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `.workbuddy/workbuddy.md` | Root project memory (AGENTS.md equivalent) |
| CREATE | `.workbuddy/rules/lazyworkbuddy.md` | Project rules that guide agent behavior |
| CREATE | `.workbuddy/commands/init-deep.md` | Slash command: deep project initialization |
| CREATE | `.workbuddy/commands/ulw-plan.md` | Slash command: planning entry point |
| CREATE | `.workbuddy/commands/start-work.md` | Slash command: execution entry point |
| CREATE | `.workbuddy/commands/ulw-loop.md` | Slash command: verified loop entry point |
| CREATE | `.workbuddy/rules/AGENTS.md` | Compatibility alias for AGENTS.md conventions |

### Implementation Steps
1. Run init-deep equivalent: explore repo structure, score directories, generate `workbuddy.md`
2. Populate `workbuddy.md` with project overview, structure, conventions, anti-patterns, commands
3. Create `lazyworkbuddy.md` rules: LazyCodex-derived conventions, non-negotiables, verification discipline
4. Create command markdown files that describe each workflow's entry point
5. Verify all files reference each other correctly

### Verification Steps
1. `workbuddy.md` exists and is 50-150 lines (following init-deep quality gates)
2. `rules/lazyworkbuddy.md` lists at least 5 enforceable rules
3. Each command file has: description, usage, expected behavior, stop condition
4. All file references resolve (no broken links)

### Success Criteria
- Reading `workbuddy.md` gives a new agent sufficient context to understand the project
- `rules/lazyworkbuddy.md` is specific to this project (not generic advice)
- Commands are invocable and load the correct Skill

### Rollback Strategy
Delete all created files. No existing files are modified — this is a pure creation phase.

### Known Risks
- **Risk:** `workbuddy.md` may become stale if not maintained. **Mitigation:** Created by systematic init-deep; updated by librarian Skill in v0.9.
- **Risk:** Rules may conflict with WorkBuddy's built-in rules system. **Mitigation:** Test each rule against common workflows.

### Acceptance Criteria Before Proceeding
- [ ] `workbuddy.md` passes init-deep quality gates (50-150 lines, no generic content)
- [ ] All command files invoke without error
- [ ] Rules file reviewed and approved against LazyCodex conventions in source

---

## v0.3 — Plugin Scaffold

### Objective
Create the installable `lazyworkbuddy-plugin/` shell with a valid `.workbuddy-plugin/plugin.json` manifest, empty component directories, and a working install/uninstall story.

**LazyCodex source:** `plugins/omo/.codex-plugin/plugin.json` ([reference](../dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json)) — the omo plugin manifest (21 hooks, 5 MCP servers, 25 skills).

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` | Plugin manifest |
| CREATE | `lazyworkbuddy-plugin/skills/` | Skills directory (empty for now) |
| CREATE | `lazyworkbuddy-plugin/commands/` | Commands directory (empty for now) |
| CREATE | `lazyworkbuddy-plugin/agents/` | Agents directory (empty for now) |
| CREATE | `lazyworkbuddy-plugin/hooks/hooks.json` | Empty hooks scaffold |
| CREATE | `lazyworkbuddy-plugin/scripts/` | Scripts directory |
| CREATE | `lazyworkbuddy-plugin/README.md` | Plugin documentation |

### Implementation Steps
1. Create directory structure matching WorkBuddy plugin layout
2. Write `plugin.json` with: name, version (0.3.0), description, skills path, hooks path, MCP path
3. Fill `interface` block: displayName, shortDescription, category, capabilities
4. Test: does WorkBuddy recognize the plugin structure?
5. Document install/uninstall story in README

### Verification Steps
1. `plugin.json` validates as well-formed JSON with required fields
2. All referenced directories exist
3. Plugin install procedure is documented and testable
4. Plugin loads without errors in a test workspace

### Success Criteria
- Plugin scaffold is structurally valid per WorkBuddy plugin spec
- README documents install/uninstall clearly
- Empty directories ready for v0.4 content

### Rollback Strategy
Delete the `lazyworkbuddy-plugin/` directory. No other files affected.

### Known Risks
- **Risk:** WorkBuddy plugin format may diverge from Codex format. **Mitigation:** Follow verified WorkBuddy plugin spec from AGENTS.md.
- **Risk:** `workbuddy-plugin/plugin.json` vs `.codebuddy-plugin/plugin.json` naming. **Mitigation:** Use `.workbuddy-plugin/plugin.json` as documented compat fallback.

### Acceptance Criteria Before Proceeding
- [ ] `plugin.json` has valid `name`, `version`, `skills`, `hooks`, `mcpServers` fields
- [ ] Plugin directory structure matches WorkBuddy convention
- [ ] Install/uninstall story is documented

---

## v0.4 — Skills and Command Workflows

### Objective
Port the core LazyCodex skills into WorkBuddy-native SKILL.md format: `init-deep`, `ulw-plan`, `start-work`, `ulw-loop`, `ultrawork`, `review-work`.

**LazyCodex source:**
- `skills/init-deep/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md))
- `skills/ulw-plan/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md))
- `skills/start-work/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md))
- `skills/ulw-loop/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md))
- `skills/ultrawork/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md))
- `skills/review-work/SKILL.md` ([reference](../dev/reference/lazycodex/plugins/omo/skills/review-work/SKILL.md))

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/skills/init-deep/SKILL.md` | Deep project initialization |
| CREATE | `lazyworkbuddy-plugin/skills/ulw-plan/SKILL.md` | Prometheus planning |
| CREATE | `lazyworkbuddy-plugin/skills/start-work/SKILL.md` | Orchestrated execution |
| CREATE | `lazyworkbuddy-plugin/skills/ulw-loop/SKILL.md` | Verified completion loop |
| CREATE | `lazyworkbuddy-plugin/skills/ultrawork/SKILL.md` | Binding ultrawork directive |
| CREATE | `lazyworkbuddy-plugin/skills/review-work/SKILL.md` | 5-agent parallel review |
| CREATE | `lazyworkbuddy-plugin/skills/programming/SKILL.md` | Strict coding discipline |
| CREATE | `lazyworkbuddy-plugin/skills/remove-ai-slops/SKILL.md` | AI-looking code cleanup |
| CREATE | `lazyworkbuddy-plugin/skills/git-master/SKILL.md` | Git workflow discipline |
| CREATE | `lazyworkbuddy-plugin/skills/debugging/SKILL.md` | Systematic debugging |
| CREATE | `lazyworkbuddy-plugin/commands/init-deep.md` | Command wrapper |
| CREATE | `lazyworkbuddy-plugin/commands/ulw-plan.md` | Command wrapper |
| CREATE | `lazyworkbuddy-plugin/commands/start-work.md` | Command wrapper |
| CREATE | `lazyworkbuddy-plugin/commands/ulw-loop.md` | Command wrapper |
| CREATE | `lazyworkbuddy-plugin/commands/review-work.md` | Command wrapper |

### Implementation Steps
1. For each LazyCodex skill: read source SKILL.md, extract semantics, adapt to WorkBuddy-native format
2. Replace Codex-specific tool references (`multi_agent_v1`, `background_output`) with WorkBuddy equivalents (`Agent` tool, subagent spawning)
3. Replace `.omo/` path references with `.lazyworkbuddy/` equivalents
4. Preserve all method semantics (tier triage, evidence gates, delegate-only orchestration)
5. Create command wrappers that load the corresponding Skill
6. Test: does loading each Skill produce correct behavior descriptions?

### Verification Steps
1. Each SKILL.md has valid YAML frontmatter with `name` and `description`
2. Each command file has valid Markdown with usage examples
3. Cross-reference: every LazyCodex skill has a corresponding WorkBuddy skill
4. Test: load `ulw-plan` Skill in a test conversation — does it describe the correct workflow?

### Success Criteria
- 10+ Skills ported from LazyCodex with semantic fidelity
- All Codex-specific tool references replaced with WorkBuddy equivalents
- `.omo/` paths replaced with `.lazyworkbuddy/`
- Each Skill loads without errors

### Rollback Strategy
Delete created skill and command files from `lazyworkbuddy-plugin/`.

### Known Risks
- **Risk:** WorkBuddy subagent spawning differs from Codex `multi_agent_v1`. **Mitigation:** Map spawn/wait/close to WorkBuddy Agent tool; document differences.
- **Risk:** Some LazyCodex skills reference CLI tools (`omo ulw-loop`). **Mitigation:** Replace with MCP tool calls or inline logic.
- **Risk:** Skill semantics may lose fidelity in adaptation. **Mitigation:** Record all deviations in known-gaps doc.

### Acceptance Criteria Before Proceeding
- [ ] All 10+ SKILL.md files created with complete frontmatter
- [ ] All Codex tool references replaced with WorkBuddy tools
- [ ] Skills pass a smoke test (load, describe, stop)

---

## v0.5 — Subagents and Orchestration

### Objective
Create WorkBuddy agent definitions for the 9 LazyCodex agent roles: planner, implementer, verifier, reviewer, librarian, explorer, QA executor, gate reviewer, orchestrator.

**LazyCodex source:** Agent roles installed to `~/.codex/agents/`: `explorer`, `librarian`, `plan`, `momus`, `metis`, `lazycodex-code-reviewer`, `lazycodex-qa-executor`, `lazycodex-gate-reviewer` — traced via `start-work` skill Codex mapping table ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) lines 17-19) and `review-work` skill ([reference](../dev/reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) line 20).

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/agents/planner.md` | Planning subagent (Prometheus) |
| CREATE | `lazyworkbuddy-plugin/agents/explorer.md` | Codebase exploration |
| CREATE | `lazyworkbuddy-plugin/agents/implementer.md` | Implementation worker |
| CREATE | `lazyworkbuddy-plugin/agents/verifier.md` | Evidence verification (Oracle) |
| CREATE | `lazyworkbuddy-plugin/agents/reviewer.md` | Multi-angle code review |
| CREATE | `lazyworkbuddy-plugin/agents/librarian.md` | Memory/index/parity maintenance |
| CREATE | `lazyworkbuddy-plugin/agents/qa-executor.md` | Hands-on QA execution |
| CREATE | `lazyworkbuddy-plugin/agents/gate-reviewer.md` | Final gate approval |
| CREATE | `lazyworkbuddy-plugin/agents/orchestrator.md` | Root orchestrator (Sisyphus) |

### Implementation Steps
1. For each agent role: define YAML frontmatter (`name`, `description`, `model`, `tools`, `disallowedTools`, `skills`, `memory`, `isolation`)
2. Planner: read-only tools only; Plan Mode enforced; never writes product code
3. Implementer: write tools; bounded scope; no orchestrator-level decisions
4. Verifier: read-only tools; independent context; accept/reject/revise decisions
5. Reviewer: 5-lane parallel review as described in `review-work` Skill
6. Librarian: memory write tools; maintains parity ledger
7. Orchestrator: full tool access; spawns subagents; never implements directly
8. Test: can each agent be spawned with correct tool restrictions?

### Verification Steps
1. Each agent.md has valid YAML frontmatter
2. Tool restrictions match role semantics (planner = read-only, implementer = write, etc.)
3. `isolation` field set correctly per role
4. All 9 roles correspond to LazyCodex agent roles
5. Test: spawn planner — confirm it refuses to write product code

### Success Criteria
- 9 agent definitions created with correct tool scoping
- Planner cannot write product code (verified by test)
- Implementer cannot spawn subagents (orchestrator-only)
- Verifier runs with isolated context

### Rollback Strategy
Delete created agent files.

### Known Risks
- **Risk:** WorkBuddy subagent tool restrictions may not perfectly match LazyCodex capabilities. **Mitigation:** Document gaps; use Skill-level enforcement as fallback.
- **Risk:** Agent `model` field may not support LazyCodex's multi-model routing. **Mitigation:** Use a single strong model; document lack of dynamic model routing as a known gap.

### Acceptance Criteria Before Proceeding
- [ ] All 9 agent definitions have correct YAML frontmatter
- [ ] Tool restriction test passes for planner (read-only) and implementer (write-scoped)
- [ ] Agent spawning works from orchestrator context

---

## v0.6 — Hooks, Permissions, and Safety Gates

### Objective
Implement the 12 lifecycle hooks that enforce deterministic behavior: continuation, evidence verification, rule loading, budget enforcement, and cache management.

**LazyCodex source:** 21 hooks in `plugins/omo/hooks/` — subset mapped to WorkBuddy's 26 event types. Key hooks:
- `stop-checking-start-work-continuation.json` ([reference](../dev/reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json))
- `subagent-stop-verifying-lazycodex-executor-evidence.json` ([reference](../dev/reference/lazycodex/plugins/omo/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json))
- `session-start-loading-project-rules.json` ([reference](../dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json))

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/hooks/hooks.json` | Complete hooks configuration |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-session-start.sh` | SessionStart: load rules, check bootstrap |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-user-prompt-submit.sh` | UserPromptSubmit: ultrawork/loop detection |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-pre-tool-use.sh` | PreToolUse: budget enforcement |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-post-tool-use.sh` | PostToolUse: diagnostics, rule matching |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-post-tool-use-failure.sh` | PostToolUseFailure: ledger logging |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-pre-compact.sh` | PreCompact: cache reset, state preservation |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-stop.sh` | Stop: continuation check |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-stop-failure.sh` | StopFailure: recovery attempt |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-subagent-stop.sh` | SubagentStop: evidence verify + continuation |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-task-created.sh` | TaskCreated: ledger entry |
| CREATE | `lazyworkbuddy-plugin/scripts/hook-task-completed.sh` | TaskCompleted: progress update |

### Implementation Steps
1. Map all 12 hook events to shell scripts using `${CODEBUDDY_PLUGIN_ROOT}`
2. SessionStart: load rules from `.workbuddy/rules/`, check bootstrap state
3. UserPromptSubmit: scan for `ultrawork`, `ulw-loop`, `ulw-plan`, `start-work` keywords; inject skill directives
4. PreToolUse: check iteration budget against run state; warn if exceeding
5. PostToolUse: run diagnostics check; match `.workbuddy/rules/`
6. PostToolUseFailure: log to run ledger
7. PreCompact: preserve active run state; reset caches
8. Stop/SubagentStop: read `.lazyworkbuddy/runs/<run_id>/state.json`; if unchecked work, signal continuation
9. SubagentStop matcher: `lazycodex-executor-verify` equivalent → run evidence verification
10. TaskCreated/TaskCompleted: append to run ledger

### Verification Steps
1. `hooks.json` has valid structure for all 12 events
2. Each hook script is executable and uses `${CODEBUDDY_PLUGIN_ROOT}`
3. `Stop` hook re-injects `start-work` when state.json has unchecked checkboxes
4. `SubagentStop` hook with matcher runs evidence verification
5. `SessionStart` hook loads `.workbuddy/rules/` correctly
6. All hooks have status messages following LazyCodex convention: `(Lazyworkbuddy): ...`

### Success Criteria
- 12 hooks configured and functional
- Stop/SubagentStop continuation loop works: unchecked work → re-injection
- Evidence verification triggers on executor subagent stop
- Rule loading works on session start

### Rollback Strategy
Delete hooks.json and all hook scripts. Behavior falls back to no hooks.

### Known Risks
- **Risk:** Hook scripts may timeout (LazyCodex uses 10s timeout). **Mitigation:** Keep hooks fast; heavy work goes to background processes.
- **Risk:** Continuation loop may infinite-loop if state is corrupted. **Mitigation:** Maximum continuation depth check; bail after N re-injections.
- **Risk:** `${CODEBUDDY_PLUGIN_ROOT}` may not be set in all environments. **Mitigation:** Graceful fallback; log warning.

### Acceptance Criteria Before Proceeding
- [ ] 12 hooks configured in hooks.json
- [ ] Stop continuation loop test: create run state with unchecked work → Stop → verify re-injection
- [ ] SubagentStop evidence verification test: executor claims done → verifier checks → reject/accept
- [ ] SessionStart loads rules without error

---

## v0.7 — Durable Run Ledger and Autonomous Loop

### Objective
Implement the `.lazyworkbuddy/runs/<run_id>/` schema: state.json, events.jsonl, checkpoints, and the loop protocol that enables resumable autonomous runs.

**LazyCodex source:**
- `.omo/boulder.json` schema: `start-work` Skill Phase 2 ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) lines 72-90)
- `.omo/start-work/ledger.jsonl`: Phase 4 ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) lines 128-130)
- Sisyphus completion contract: DoneClaim/AdversarialVerify/FullyDone ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) lines 132-161)

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/scripts/ledger-init.sh` | Initialize run state |
| CREATE | `lazyworkbuddy-plugin/scripts/ledger-append.sh` | Append event to ledger |
| CREATE | `lazyworkbuddy-plugin/scripts/ledger-checkpoint.sh` | Create checkpoint snapshot |
| CREATE | `lazyworkbuddy-plugin/scripts/ledger-restore.sh` | Restore from checkpoint |
| CREATE | `lazyworkbuddy-plugin/scripts/loop-monitor.sh` | Loop health monitoring |
| CREATE | `docs/lazyworkbuddy-state-ledger-design.md` | Schema documentation |
| MODIFY | `lazyworkbuddy-plugin/skills/start-work/SKILL.md` | Update Phase 2/4/5 for .lazyworkbuddy/ paths |
| MODIFY | `lazyworkbuddy-plugin/skills/ulw-loop/SKILL.md` | Update for .lazyworkbuddy/ state |

### Implementation Steps
1. Define `state.json` schema (schema version, active work, session IDs, plan reference, status, checkpoints)
2. Define `events.jsonl` format (one JSON per line: event type, timestamp, plan, task, session_id, evidence)
3. Implement checkpoint logic: snapshot state.json + plan reference at key milestones
4. Implement restore: read checkpoint, resume from last completed checkbox
5. Implement loop monitor: track iteration count, detect stalls, enforce 500/100 iteration caps (matching LazyCodex ultrawork/normal caps in `ulw-loop` skill)
6. Wire into `start-work` Skill: Phase 2 creates state, Phase 4 appends events, Phase 5 updates checkboxes
7. Wire into `ulw-loop` Skill: goal creation, evidence recording, loop continuation

### Verification Steps
1. Create a run → verify state.json has correct schema
2. Execute a plan checkbox → verify events.jsonl has evidence entry
3. Create checkpoint → verify checkpoint directory contains snapshot
4. Simulate crash → restore from checkpoint → verify resume from correct checkbox
5. Loop monitor test: 500 iterations → verify cap enforced
6. End-to-end: plan 3 checkboxes → execute all 3 → verify state.json shows completed, events.jsonl has all evidence

### Success Criteria
- Run state can be created, updated, checkpointed, and restored
- Evidence ledger captures all verification artifacts
- Loop respects iteration caps (500 ultrawork, 100 normal)
- Crash recovery works: resume from last checkpoint

### Rollback Strategy
Since state files are under `.lazyworkbuddy/` (not committed), errors do not affect repo. Delete corrupted state and restart run.

### Known Risks
- **Risk:** events.jsonl may grow large on long runs. **Mitigation:** Rotate by run; compress completed runs.
- **Risk:** Checkpoint frequency vs. overhead tradeoff. **Mitigation:** Checkpoint on every N checkboxes (configurable, default 5).
- **Risk:** Concurrent writes to state.json (multiple subagents). **Mitigation:** Orchestrator is sole writer; subagents report via mailbox (matching LazyCodex pattern in start-work Skill).

### Acceptance Criteria Before Proceeding
- [ ] Run state CRUD works end-to-end
- [ ] Crash recovery test passes
- [ ] Loop iteration cap enforced
- [ ] Evidence ledger captures all verification data

---

## v0.8 — MCP/Tool Layer and Optional Dashboard

### Objective
Create MCP servers for run ledger access, verification tools, and an optional dashboard. Port LazyCodex's 5 MCP servers to equivalents.

**LazyCodex source:** `plugins/omo/.mcp.json` ([reference](../dev/reference/lazycodex/plugins/omo/.mcp.json)) — 5 servers: `grep_app`, `context7`, `codegraph`, `git_bash`, `lsp`.

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/.mcp.json` | MCP server configuration |
| CREATE | `lazyworkbuddy-plugin/mcp/run-ledger/server.js` | MCP: query/append run state |
| CREATE | `lazyworkbuddy-plugin/mcp/verification/server.js` | MCP: run verification checks |
| CREATE | `lazyworkbuddy-plugin/mcp/parity-dashboard/server.js` | MCP: parity tracking (optional) |
| CREATE | `lazyworkbuddy-plugin/scripts/parity-check.sh` | CLI: compare Lazyworkbuddy vs LazyCodex behavior |
| MODIFY | `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` | Add `mcpServers` field |

### Implementation Steps
1. Port `git_bash` MCP: git operations with WorkBuddy-native git tools (prefer built-in over MCP where equivalent)
2. Port `lsp` MCP to WorkBuddy LSP integration (`.lsp.json`) or skip if native features cover it
3. Create `run-ledger` MCP: tools for querying events, checking run status, listing checkpoints
4. Create `verification` MCP: tools for running verification scripts and collecting results
5. Create optional `parity-dashboard` MCP: compare Lazyworkbuddy behavior against LazyCodex source
6. Write `.mcp.json` with proper `${CODEBUDDY_PLUGIN_ROOT}` paths
7. Skip `grep_app` and `context7` (external services) — document as optional add-ons
8. Skip `codegraph` (Codex-specific) — document as not applicable to WorkBuddy

### Verification Steps
1. `.mcp.json` validates as well-formed JSON
2. `run-ledger` MCP: query a completed run → returns correct events
3. `verification` MCP: run verification → returns test results
4. All paths use `${CODEBUDDY_PLUGIN_ROOT}` (not hardcoded)
5. `parity-check.sh` runs and produces a diff report

### Success Criteria
- 3-5 MCP servers configured
- Run ledger MCP works (query + append)
- Verification MCP runs tests and returns results
- Parity check script produces actionable report

### Rollback Strategy
Delete `.mcp.json` and MCP server files. Skills fall back to direct file access.

### Known Risks
- **Risk:** MCP servers may not be available on all WorkBuddy platforms. **Mitigation:** Skills fall back to file read/write when MCP is unavailable.
- **Risk:** MCP server execution overhead may slow workflows. **Mitigation:** Direct file access for simple reads; MCP for structured queries only.
- **Risk:** WorkBuddy MCP format may differ from Codex `.mcp.json`. **Mitigation:** Follow verified WorkBuddy MCP docs.

### Acceptance Criteria Before Proceeding
- [ ] `.mcp.json` configured with 3+ servers
- [ ] Run ledger MCP query/append functional
- [ ] Verification MCP returns test results
- [ ] Parity check produces diff report

---

## v0.9 — Verifier/Reviewer/Librarian Hardening

### Objective
Harden the verification, review, and memory maintenance workflows: verifier false-positive rate reduction, reviewer consistency, and librarian automated memory updates.

**LazyCodex source:**
- Verifier: Sisyphus completion contract in `start-work` Skill ([reference](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) lines 132-161)
- Reviewer: `review-work` Skill 5-agent review ([reference](../dev/reference/lazycodex/plugins/omo/skills/review-work/SKILL.md))
- Librarian: Implied in `init-deep` update mode and parity ledger maintenance

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `lazyworkbuddy-plugin/agents/verifier.md` | Strengthen evidence checking rules |
| MODIFY | `lazyworkbuddy-plugin/agents/reviewer.md` | Add consistency checks across 5 lanes |
| CREATE | `lazyworkbuddy-plugin/agents/librarian.md` | Memory/index/parity maintenance agent |
| CREATE | `lazyworkbuddy-plugin/skills/librarian/SKILL.md` | Librarian workflow |
| CREATE | `lazyworkbuddy-plugin/scripts/memory-update.sh` | Automated memory update script |
| CREATE | `docs/lazyworkbuddy-known-gaps.md` | Parity gap ledger |
| MODIFY | `lazyworkbuddy-plugin/skills/start-work/SKILL.md` | Update Phase 4 verification gates |
| MODIFY | `lazyworkbuddy-plugin/skills/review-work/SKILL.md` | Harden review lane criteria |

### Implementation Steps
1. Hardening — Verifier:
   - Add adversarial class probing: stale state, dirty worktree, misleading success output
   - Add reproducibility check: verifier must reproduce the executor's claim
   - Add confidence scoring: `confirmed` requires >0.8 confidence
2. Hardening — Reviewer:
   - Add cross-lane consistency: if Reviewer finds a bug that Verifier missed → flag
   - Add retry budget tracking: max 3 retries per lane before INCONCLUSIVE
   - Add lane completion order: preserve results even if another lane still runs
3. Hardening — Librarian:
   - After accepted changes: update `workbuddy.md`, parity ledger, command index
   - After parity changes: update `docs/lazyworkbuddy-known-gaps.md`
   - Periodic: prune old run states, rotate event logs

### Verification Steps
1. Verifier: false-positive test — feed a true claim → expect `confirmed` verdict
2. Verifier: false-negative test — feed a false claim → expect `needs-fix` verdict
3. Reviewer: cross-lane consistency test — introduce a bug missed by Verifier → Reviewer catches it
4. Librarian: after accepted work → verify `workbuddy.md` updated, parity ledger updated
5. End-to-end: execute work → verify → review → librarian update → check all artifacts

### Success Criteria
- Verifier false-positive rate near zero for known test cases
- Reviewer catches bugs Verifier misses
- Librarian updates project memory after accepted changes
- Parity ledger tracks all deviations from LazyCodex source

### Rollback Strategy
Revert modified files to v0.8 state.

### Known Risks
- **Risk:** Librarian may overwrite human edits to `workbuddy.md`. **Mitigation:** Diff before write; only append new sections; never delete human content.
- **Risk:** Verifier may become too strict, blocking valid work. **Mitigation:** Confidence threshold tuning; human override path.

### Acceptance Criteria Before Proceeding
- [ ] Verifier passes both true and false claim tests
- [ ] Reviewer cross-lane consistency test passes
- [ ] Librarian updates memory correctly after accepted work
- [ ] Parity ledger exists and has entries for each version

---

## v0.10 — Migration Planner and Host Adapters

### Objective
Create a reusable migration planner that can port LazyCodex semantics to any host platform, and the host adapter templates that make Lazyworkbuddy itself portable.

**LazyCodex source:** No direct equivalent — this is a Lazyworkbuddy innovation that generalizes our adaptation experience.

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `lazyworkbuddy-plugin/skills/migration-planner/SKILL.md` | Reusable migration workflow |
| CREATE | `lazyworkbuddy-plugin/agents/migration-planner.md` | Migration planner agent |
| CREATE | `docs/host-adapter-template.md` | Template for new host platforms |
| CREATE | `docs/workbuddy-host-adapter.md` | WorkBuddy-specific adapter doc |

### Implementation Steps
1. Extract the LazyCodex → Lazyworkbuddy adaptation methodology into a repeatable workflow
2. Create a SKILL.md that guides any agent through: inspect source → map methods → design architecture → version plan → implement → verify → parity report
3. Create host adapter template: what to fill in for each new host (tool mapping, agent model, hook events, file system)
4. Write the WorkBuddy adapter: how we mapped LazyCodex concepts to WorkBuddy surfaces
5. Test: can the migration planner guide a fresh agent through adapting a simple LazyCodex skill?

### Verification Steps
1. Migration planner SKILL.md describes a complete workflow with decision points
2. Host adapter template has clear fill-in sections
3. WorkBuddy adapter doc explains every mapping decision
4. Test: feed migration planner a LazyCodex skill → does it produce a correct adaptation plan?

### Success Criteria
- Migration planner is reusable for any host
- Host adapter template covers all required sections
- WorkBuddy adapter documents every mapping decision from v0.2-v0.9

### Rollback Strategy
Delete created files.

### Known Risks
- **Risk:** Migration planner may be too abstract to be useful. **Mitigation:** Concrete example: adapt a simple LazyCodex skill (like `remove-ai-slops`) to demonstrate the workflow.
- **Risk:** Host adapters may not generalize well. **Mitigation:** Include only verified patterns; mark speculative sections.

### Acceptance Criteria Before Proceeding
- [ ] Migration planner produces a correct adaptation plan for a test skill
- [ ] Host adapter template is complete with all required sections
- [ ] WorkBuddy adapter documents every mapping decision

---

## v0.11 — Dogfood Run (End-to-End Self-Test)

### Objective
Run Lazyworkbuddy on itself: use `/lazy-ulw-plan` to plan a feature, `/lazy-start-work` to execute it, `/lazy-ulw-loop` to verify completion, and `/lazy-review-work` to review. This is an end-to-end test that exercises every component.

**LazyCodex source:** No direct equivalent — this is a Lazyworkbuddy quality gate.

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `.lazyworkbuddy/runs/dogfood-v0.11/state.json` | Dogfood run state (generated) |
| CREATE | `.lazyworkbuddy/runs/dogfood-v0.11/events.jsonl` | Dogfood evidence (generated) |
| CREATE | `docs/dogfood-v0.11-report.md` | Dogfood results report |

### Implementation Steps
1. Choose a small but meaningful feature to implement (e.g., add a new Skill, fix a known gap)
2. Run `/lazy-ulw-plan`: inspect codebase, generate plan → verify plan quality
3. Run `/lazy-start-work`: execute plan with subagents → verify orchestration
4. Run `/lazy-ulw-loop`: run verification loop → verify evidence captures
5. Run `/lazy-review-work`: 5-agent review → verify all lanes pass
6. Run librarian update: verify memory updated
7. Document everything in the dogfood report

### Verification Steps
1. Plan generated with correct structure (TL;DR, Todos, Final Verification Wave)
2. All plan checkboxes completed by subagents (not root)
3. Evidence ledger has entries for every checkbox
4. 5-agent review passes all lanes
5. Librarian updates workbuddy.md with dogfood findings
6. End-to-end time documented

### Success Criteria
- Dogfood run exercises all 6 core Skills
- All plan checkboxes completed
- 5-agent review passes
- Evidence ledger is complete
- No critical bugs found (minor issues documented as known gaps)

### Rollback Strategy
Dogfood results are under `.lazyworkbuddy/` and `docs/` — no product code affected.

### Known Risks
- **Risk:** Dogfood may reveal fundamental architecture issues. **Mitigation:** Time-boxed; document issues and fix in v0.12 if minor.
- **Risk:** Multi-agent orchestration may fail under real load. **Mitigation:** Sequential fallback if parallel agents fail.

### Acceptance Criteria Before Proceeding
- [ ] Dogfood feature implemented and verified
- [ ] All 6 Skills exercised
- [ ] Dogfood report complete with findings and recommendations

---

## v0.12 — Final Release and Parity Report

### Objective
Produce the final release package: complete plugin, project memory, parity report, and known gaps documentation. This is the "LazyCodex reborn inside WorkBuddy" deliverable.

**LazyCodex source:** The entire `dev/reference/lazycodex/` repo — compare our recreation against it exhaustively.

### Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| CREATE | `docs/lazyworkbuddy-parity-report.md` | Final parity comparison |
| CREATE | `docs/lazyworkbuddy-release-notes.md` | Release notes for v0.12 |
| MODIFY | `docs/lazyworkbuddy-known-gaps.md` | Update with all remaining gaps |
| MODIFY | `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` | Bump version to 0.12.0 |
| MODIFY | `lazyworkbuddy-plugin/README.md` | Final release documentation |

### Implementation Steps
1. Run full parity check: compare every LazyCodex method against Lazyworkbuddy implementation
2. Generate parity report: what we matched, what we adapted, what we skipped, what we added
3. Update known gaps with any issues found during v0.11 dogfood
4. Polish plugin README with complete install/uninstall/usage docs
5. Bump plugin version to 0.12.0
6. Tag the release in git

### Verification Steps
1. Parity report covers all LazyCodex methods
2. Known gaps list is complete and honest (no hidden gaps)
3. README is clear enough for a first-time user to install and use
4. Plugin installs correctly on a clean WorkBuddy workspace
5. All acceptance criteria from v0.2-v0.11 have been met

### Success Criteria
- Parity report is complete and accurate
- Known gaps are documented with workarounds
- Plugin is installable and documented
- The system feels like "LazyCodex reborn inside WorkBuddy"

### Rollback Strategy
No rollback — this is the final version. Document any issues for future maintenance.

### Known Risks
- **Risk:** Parity gaps may be larger than expected. **Mitigation:** Prioritize gaps; document workarounds; plan for v0.13 add-ons.
- **Risk:** Integration issues discovered during final packaging. **Mitigation:** v0.13 reserved for add-ons and fixes.

### Acceptance Criteria Before Proceeding
- [ ] Parity report complete
- [ ] Known gaps documented
- [ ] Plugin installs cleanly
- [ ] README is user-ready
- [ ] `ORCHESTRATION COMPLETE` for Lazyworkbuddy v0.12

---

## Version Dependency Graph

```
v0.0 (discovery)
 │
 v0.1 (architecture) ← YOU ARE HERE
 │
 v0.2 (project memory)
 │
 v0.3 (plugin scaffold)
 │
 v0.4 (skills & commands)
 │
 v0.5 (subagents)
 │
 v0.6 (hooks & safety)
 │
 v0.7 (run ledger & loop)
 │
 v0.8 (MCP & dashboard)
 │
 v0.9 (hardening)
 │
 v0.10 (migration planner)
 │
 v0.11 (dogfood)
 │
 v0.12 (release)
 │
 v0.13 (add-ons, optional)
 │
 v0.14 (evaluation rubric)
```

---

_All version objectives trace to the benchmark contract in [plan/README.md](../plan/README.md) and the v0.1 spec in [plan/v0.1-architecture.md](../plan/v0.1-architecture.md)._
