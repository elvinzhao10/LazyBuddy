# LazyBuddy Plugin Changelog

## v0.15.0-alpha.2 — Host Contract and Release Metadata Audit (2026-07-11)

- Clarified CodeBuddy plugin loading, WorkBuddy marketplace/session verification, and the verified local Skill-import/manual-MCP fallback.
- Corrected CodeBuddy command namespace examples to `/lazybuddy:lazy-<command>`.
- Updated manifest, marketplace, MCP server, and release metadata to `0.15.0-alpha.2`.

## v0.15.0-alpha.1 — Fresh Workspace Load Check (2026-07-11)

- Added an exact 14-skill, 14-command, 13-agent, 12-hook, and 6-MCP readiness check.
- Run the check during onboarding and from the host-executed SessionStart hook, so a newly opened repository reports partial plugin loading immediately.

## v0.12.0 — Release Hardening (2026-07-09)

- **Added** final release docs package: root README, quickstart, and final parity report.
- **Recorded** non-trivial v0.12 dogfood replay evidence under `.lazybuddy/runs/dogfood-v0.12/` and `.omo/evidence/task-5-diagnosis-v0-12-lazybuddy.txt`.
- **Verified** release gates in Todo 6: doctor 50/50, aggregate verify `all_pass:true`, MCP smoke 22/22, hook pipeline 16/16, docs check passing, and plugin metadata version `0.12.0`.
- **Documented** honest parity posture: context tooling is a WorkBuddy host substitution, not full LazyCodex codegraph/LSP/Context7 semantic parity.
- **Bumped** installable plugin metadata to `0.12.0`.

## v0.11.0 — Dogfood Run (2026-07-09)

- **Dogfood run completed** — full lifecycle (init-deep → ulw-plan → start-work → verify → review → finalize) on a real task
- **Fixed** stale plugin description in `.workbuddy/settings.json` (suggested enabling plugin when already enabled)
- **Created** `docs/lazybuddy-dogfood-run.md` — comprehensive dogfood report with UX problems, parity gaps, and suggested fixes
- **Discovered G-016** — plan checkbox / state.json task inconsistency (two representations can diverge)
- **Identified 5 v0.12 improvements** — plan sync script, CHANGELOG auto-update, verify auto-events, plan-task sync, finalize cross-check
- **4 events recorded** in events.jsonl: run_created → task_updated → verification_passed → run_completed
- All verification: doctor 47/47, smoke-test 105/105, verify.sh all_pass:true

## v0.10.0 — Migration Planner (2026-07-09)

- **Hardened** `migration-planner` Skill with the 9-step migration workflow + 11 disciplines
- **Created** `lazybuddy-migration-planner` agent
- **Created** 7 migration templates + 3 docs (migration-planner, self-adapter, migration-examples)
- Self-adapter cites 24 source paths and references all known gaps for honesty

## v0.9.0 — Hardening (2026-07-09)

- **Resolved** known gaps G-007 through G-015 (all marked fixed)
- **Hardened** `start-work`: worktree discipline, debugging runtime audit, full DoneClaim/AdversarialVerify JSON schema
- **Hardened** `ulw-loop`: 3-level iteration caps (5/goal, 3/failure, 500/100 total), dynamic steering (7 types), final quality gate, ATLAS delegation model
- **Hardened** `ultrawork`: subagent transition barriers, GREEN-step PR/branch refresh, atomic commits
- **Hardened** `verifier` + `reviewer` + `librarian` (protocols, dimensions, update triggers)
- **Created** `lazybuddy-context-miner` agent (G-015 fix)
- **Created** 4 verification check scripts + 4 protocol docs

## v0.8.0 — MCP Servers & Dashboard (2026-07-09)

- **Implemented** 5 MCP servers (30 tools): `run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`
- **Populated** `.mcp.json` with all 5 servers (bash command, `required: false`)
- **Created** 5 MCP prompt commands + dashboard mockup + 4 MCP docs
- Note: these servers are WorkBuddy-native (run state, parity, verification) — NOT LazyCodex's context servers (context7/codegraph/lsp/git_bash/grep_app). Context-tooling parity is a tracked gap (G-003, P2).

## v0.7.0 — State Ledger & Autonomous Loop (2026-07-09)

- **Created** `.lazybuddy/runs/<run_id>/` state tree (state.json, events.jsonl, checkpoints, evidence, verification, review, agent_outputs, artifacts, memory_updates)
- **Implemented** 10 state scripts + 5 loop scripts (create-run, load-run, update-task, append-event, checkpoint, recover-run, summarize-run, validate-state, list-runs, latest-run; next-task, run-cycle, classify-failure, create-repair-task, finalize-run)
- **Created** 5 docs (loop-protocol, checkpoint-format, runbook, state-schema, run-log-example)
- **Updated** 5 skills with State Ledger Integration sections
- End-to-end ledger test verified (create → plan/tasks → next-task → checkpoint → stop-gate blocks → finalize refuses → events populated)

## v0.6.0 — Hooks & Safety Gates (2026-07-09)

- **Implemented** 12 lifecycle hooks with real enforcement logic (3 enforcement + 9 advisory)
- Enforcement: `Stop` (stop-gate blocks premature completion), `SubagentStop` (evidence verification, max 3 retries), `PreToolUse` (denies secrets/destructive ops)
- Advisory: SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, PreCompact, StopFailure, TaskCreated, TaskCompleted, SubagentStart
- All 12 hook scripts executable; manual test plan passed

## v0.5.0 — Subagents & Orchestration (2026-07-09)

- **Created** 13 agent role definitions (8 LazyCodex-mapped + 5 WorkBuddy-native)
- Valid YAML frontmatter (model, effort, maxTurns, tools, disallowedTools, isolation) on all agents
- Read-only enforcement on verifier/reviewer/gate-reviewer/security-auditor; `disallowedTools:[Agent]` on implementer
- Created 4 orchestration docs (agent-inventory, agent-orchestration, handoff-protocol, parallelism-policy)

## v0.4.0 — Skills & Commands (2026-07-09)

- **Ported** 14 skills from LazyCodex with full WorkBuddy-native adaptation (init-deep, ulw-plan, start-work, ulw-loop, ultrawork, review-work, programming, remove-ai-slops, git-master, debugging, verifier, reviewer, librarian, migration-planner)
- **Wrote** 8 command files replacing v0.3 placeholders
- Tool translation applied across all files (multi_agent_v1 → Agent tool, .omo/ → .lazybuddy/, ${PLUGIN_ROOT} → ${CODEBUDDY_PLUGIN_ROOT}, AGENTS.md → workbuddy.md)

## v0.3.0 — Plugin Scaffold (2026-07-09)

- **Created** plugin structure: `.codebuddy-plugin/plugin.json`, component directories
- **Created** 8 placeholder commands + 8 placeholder skills (stubs for v0.4)
- **Created** hooks scaffold (`hooks/hooks.json`) — 12 event types (populated with real commands in v0.6)
- **Created** MCP scaffold (`.mcp.json`) — `mcpServers` populated with 5 servers in v0.8
- **Created** validation scripts: plugin-doctor, smoke-test, docs-check, parity-check
- _Note: at v0.3, components were placeholders. Real runtime behavior arrived in v0.4+._

---

_Versioning follows the v0.N convention: this is a pre-1.0 build. The plugin version tracks the latest evidence-backed release-hardening phase._
