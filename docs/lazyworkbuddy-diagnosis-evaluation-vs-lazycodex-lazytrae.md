# Lazyworkbuddy Working Replica Guide

Date: 2026-07-09

Goal: make Lazyworkbuddy a working WorkBuddy-native LazyCodex replica, using WorkBuddy-native plugin, skills, commands, agents, hooks, MCP, state, and project memory. This is a build guide for agents, not a scorecard.

## Current Read

Lazyworkbuddy is the closer current LazyCodex replica because WorkBuddy gives it stronger enforcement surfaces. The plugin is enabled, hooks are wired, state scripts exist, MCP servers exist, and there is a small dogfood run.

It is not finished. The current weak points are proof and productization: the dogfood task is too small, docs disagree on current version and MCP count, the orchestrator write boundary is still not hard-enforced, and installation is not as clean as LazyCodex `npx lazycodex-ai install` or LazyTrae's CLI package.

Target operating model: keep the WorkBuddy-native enforcement advantage, then make it reliable through a real doctor command, a harder dogfood run, a cleaner installer, and one authoritative status/parity taxonomy.

## Reference Targets

LazyCodex reference paths:

- `reference/lazycodex/plugins/omo/.codex-plugin/plugin.json`
- `reference/lazycodex/plugins/omo/.mcp.json`
- `reference/lazycodex/plugins/omo/components/ulw-loop/src/`
- `reference/lazycodex/plugins/omo/components/start-work-continuation/`
- `reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/`
- `reference/lazycodex/plugins/omo/components/rules/src/`
- `reference/lazycodex/plugins/omo/components/teammode/`
- `reference/lazycodex/plugins/omo/skills/start-work/SKILL.md`
- `reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md`

LazyTrae comparison paths:

- `../lazytrae/packages/cli/src/index.js`
- `../lazytrae/packages/cli/templates/`
- `../lazytrae/packages/mcp/src/tool-defs.js`
- `../lazytrae/packages/cli/src/commands/doctor.js`
- `../lazytrae/packages/cli/src/commands/team.js`

## Platform Strategy

| LazyCodex capability | WorkBuddy strategy |
| --- | --- |
| Blocking Stop continuation | Use `scripts/hooks/stop-gate.sh` with WorkBuddy `continue:false` |
| Executor evidence verification | Use `scripts/hooks/subagent-stop.sh` and verifier/gate-reviewer agents |
| PostCompact cache reset | Use WorkBuddy `PreCompact` hook and checkpoint scripts |
| MCP code/context tools | Use native MCP substitutes: run-ledger, parity, verification, source-map, status-dashboard, context-graph, code-intel, docs |
| Project memory | Use `workbuddy.md`, `.workbuddy/rules/`, `.workbuddy/memory/` |
| Dynamic model routing | Use static agent model/effort tiers; document remaining host gap |
| Install/doctor | Build a first-class Lazyworkbuddy CLI wrapper; do not leave setup as symlink-only |

## Workstream W0: Single Current Status Source

Purpose: stop status drift and give agents one truth source.

Files:

- `docs/lazyworkbuddy-current-status.md` (new)
- `lazyworkbuddy-plugin/README.md`
- `workbuddy.md`
- `.workbuddy/memory/MEMORY.md`
- `docs/lazyworkbuddy-parity-ledger.md`
- `docs/lazyworkbuddy-command-index.md`

TODO:

- [ ] Create `docs/lazyworkbuddy-current-status.md`.
- [ ] Record current version, enabled state, component counts, MCP server count, dogfood evidence, and open gaps.
- [ ] Update README/component map to match `.mcp.json` with 8 MCP entries.
- [ ] Link README, `workbuddy.md`, memory, parity ledger, and command index to the status file.
- [ ] Remove or mark stale "planned" claims where the feature already exists.
- [ ] Add status labels: `runtime-verified`, `implemented-unverified`, `prompt-only`, `heuristic-substitute`, `platform-gap`, `native-enhancement`.

Acceptance:

- Grepping for `v0.10`, `v0.11`, `5 MCP`, and `8 MCP` shows no contradictory current-state claims.
- The status file lists every open P0/P1 item and its owner doc/script.

## Workstream W1: Doctor As Operational Gate

Purpose: one command proves whether Lazyworkbuddy is usable.

Files:

- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh`
- `lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh`
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh`
- `lazyworkbuddy-plugin/hooks/hooks.json`
- `lazyworkbuddy-plugin/.mcp.json`

TODO:

- [ ] Validate plugin manifest and every referenced directory.
- [ ] Validate all 12 hook commands resolve and are executable.
- [ ] Run hook fixtures for Stop, PreToolUse, SubagentStop, PreCompact, PostToolUseFailure, StopFailure.
- [ ] Run MCP `tools/list` or smoke equivalent for all 8 MCP servers.
- [ ] Validate `.lazyworkbuddy/runs/*/state.json` and plan checkbox drift.
- [ ] Fail if any active/completed run has missing evidence paths.
- [ ] Fail if orchestrator boundary warnings exist in the active run.

Acceptance:

- `./lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` exits 0 only when hooks, MCP, state, and evidence gates are healthy.
- Breaking a hook path, MCP entry, state file, or evidence path makes doctor exit non-zero with a specific fix.

## Workstream W2: Non-Trivial Dogfood

Purpose: prove the replica works under realistic LazyCodex pressure.

Files:

- `.lazyworkbuddy/runs/`
- `docs/lazyworkbuddy-dogfood-run.md`
- `lazyworkbuddy-plugin/scripts/state/`
- `lazyworkbuddy-plugin/scripts/loop/`
- `lazyworkbuddy-plugin/scripts/hooks/`

TODO:

- [ ] Pick a real task with at least 3 independent subtasks.
- [ ] Run `/ulw-plan` and `/start-work` using Lazyworkbuddy surfaces.
- [ ] Force one subagent missing-evidence failure and verify SubagentStop catches it.
- [ ] Force one failed verification and create a repair task.
- [ ] Exercise checkpoint and recovery.
- [ ] Exercise plan/state sync by checking both plan checkboxes and `state.json`.
- [ ] Run final review and debugging audit.
- [ ] Store CLI output, hook output, MCP output, state diffs, and final verdict.

Acceptance:

- Dogfood run has at least 3 tasks, at least 1 repair cycle, and at least 1 checkpoint.
- Stop gate blocks before completion and allows after completion.
- Evidence is concrete enough for a new agent to replay the flow.

## Workstream W3: Orchestrator Boundary Enforcement

Purpose: make "orchestrator never writes product code" auditable and eventually enforceable.

Files:

- `lazyworkbuddy-plugin/agents/lazyworkbuddy-orchestrator.md`
- `lazyworkbuddy-plugin/scripts/hooks/pre-tool-use.sh`
- `lazyworkbuddy-plugin/scripts/hooks/post-tool-use.sh`
- `lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh`
- `docs/lazyworkbuddy-known-gaps.md`

TODO:

- [ ] Ensure orchestrator instructions say state-only writes are allowed and product writes are forbidden.
- [ ] Keep `boundary_warning` event for non-state Write/Edit.
- [ ] Add verifier check that fails any run where the orchestrator touched non-state files.
- [ ] Add doctor check for active-run boundary warnings.
- [ ] If WorkBuddy adds path-scoped permissions, move from audit to PreToolUse blocking.

Acceptance:

- A fixture event showing orchestrator product-file edit makes verify/doctor fail.
- Implementer product-file edits still pass when evidence and verification gates pass.

## Workstream W4: CLI Installer And Product Surface

Purpose: make Lazyworkbuddy easy to install, verify, and remove.

Files:

- `packages/cli/` or `bin/lazyworkbuddy` (new)
- `lazyworkbuddy-plugin/README.md`
- `.workbuddy/settings.json` template
- `lazyworkbuddy-plugin/scripts/`

TODO:

- [ ] Add `lazyworkbuddy install` to link/copy plugin and write required settings blocks.
- [ ] Add `lazyworkbuddy doctor` as a wrapper around plugin doctor.
- [ ] Add `lazyworkbuddy verify` as a wrapper around run verification.
- [ ] Add `lazyworkbuddy status` to show active run, hooks, MCP, and gaps.
- [ ] Add `lazyworkbuddy uninstall` to remove plugin link and managed settings blocks.
- [ ] Add `lazyworkbuddy sync` or `upgrade` if marketplace/update support exists.

Acceptance:

- A clean workspace can install, doctor, run status, and uninstall without hand-editing plugin paths.
- README quick start uses the CLI first and symlink install only as development fallback.

## Workstream W5: MCP Capability Labels And Schemas

Purpose: make MCP tools reliable and honest.

Files:

- `lazyworkbuddy-plugin/.mcp.json`
- `lazyworkbuddy-plugin/mcp/*/server.*`
- `docs/lazyworkbuddy-mcp-and-tools.md`
- `docs/lazyworkbuddy-known-gaps.md`

TODO:

- [ ] Publish a concise schema table for each MCP server and tool.
- [ ] Label each tool: `semantic`, `project-tool-backed`, `heuristic`, or `state-only`.
- [ ] Add smoke test for each MCP server.
- [ ] For `context-graph`, document grep/import limitations.
- [ ] For `code-intel`, document when diagnostics are real tool output vs heuristic search.
- [ ] For `docs`, document offline/local-first behavior and network fallback if any.

Acceptance:

- `lazyworkbuddy-mcp-test.sh` covers all 8 servers.
- Docs never imply heuristic code navigation equals LazyCodex codegraph/LSP parity.

## Workstream W6: Loop Runtime Parity

Purpose: close the remaining gap between script-based loop state and LazyCodex `ulw-loop` semantics.

Files:

- `lazyworkbuddy-plugin/scripts/loop/*.sh`
- `lazyworkbuddy-plugin/scripts/state/*.sh`
- `lazyworkbuddy-plugin/skills/ulw-loop/SKILL.md`
- `lazyworkbuddy-plugin/skills/start-work/SKILL.md`
- `.lazyworkbuddy/runs/<run_id>/`

TODO:

- [ ] Add explicit criteria coverage tracking.
- [ ] Add quality gate JSON or equivalent structured gate file.
- [ ] Add review blocker recording and follow-up task creation.
- [ ] Add steering operations: add, remove, split, merge, reorder, pause, resume.
- [ ] Ensure all state transitions append events.
- [ ] Ensure `finalize-run.sh` checks plan checkboxes, state tasks, evidence, review, and quality gate.

Acceptance:

- A fixture run cannot finalize until plan, state, evidence, review, and quality gate all agree.
- Steering and blocker events appear in `events.jsonl`.

## Workstream W7: Parity Taxonomy

Purpose: stop confusing "adapted" with "working".

Files:

- `docs/lazyworkbuddy-parity-ledger.md`
- `docs/lazyworkbuddy-known-gaps.md`
- `docs/lazyworkbuddy-command-index.md`
- `docs/lazyworkbuddy-current-status.md`

TODO:

- [ ] Replace broad statuses with precise labels.
- [ ] Separate `reference parity`, `host substitution`, and `native enhancement`.
- [ ] Add evidence path for every `runtime-verified` claim.
- [ ] Add platform reason for every `platform-gap`.
- [ ] Add next verification command for every `implemented-unverified` claim.

Acceptance:

- No feature is marked runtime-verified without command output, hook output, dogfood evidence, or a test path.
- A new agent can pick the next unverified item and know exactly how to verify it.

## Agent Checklist

Use this order:

1. W0 Current status.
2. W1 Doctor.
3. W2 Dogfood.
4. W3 Orchestrator boundary.
5. W5 MCP labels and smoke tests.
6. W6 Loop parity.
7. W4 CLI installer.
8. W7 Parity taxonomy cleanup.

This ordering makes the work safer: first establish truth, then proof, then harder runtime improvements.

## Done Definition

Lazyworkbuddy becomes a working LazyCodex replica when:

- Plugin install and doctor work from a clean workspace.
- All 12 hooks and all 8 MCP servers pass smoke checks.
- Stop and SubagentStop gates are proven in a dogfood run.
- A non-trivial run completes with repair-cycle evidence.
- Orchestrator product-file writes fail verification.
- Loop finalize requires plan, state, evidence, review, and quality gate agreement.
- Docs have one current status source and no contradictory parity claims.
