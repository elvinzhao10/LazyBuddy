# Lazyworkbuddy Known Gaps

> Documented deviations from original LazyCodex behavior.
> Each gap records: what LazyCodex does, what Lazyworkbuddy does, why the difference exists, and impact.
> Updated by the Librarian (v0.9+) after parity checks and version implementations.

## Current Gaps (v0.2 baseline)

*No implementations yet — all gaps are architectural design decisions from v0.1.*

### G-001: Subagent spawning model

- **LazyCodex:** Uses Codex `multi_agent_v1.spawn_agent` with `agent_type` routing, `fork_context`, `wait_agent`, `close_agent`, and mailbox signals for child process tracking.
- **Lazyworkbuddy:** Uses WorkBuddy `Agent` tool with different spawning, context, and wait semantics.
- **Why:** Platform difference — WorkBuddy does not have `multi_agent_v1`. The WorkBuddy Agent tool is the closest equivalent.
- **Impact:** Medium — parallel agent orchestration may have different performance characteristics. Mailbox/`WORKING:`/`BLOCKED:` signaling patterns may need adaptation.
- **Mitigation:** Investigated in v0.5 (subagents). If parallelism is degraded, fall back to sequential execution.

### G-002: Hook count (12 vs 21)

- **LazyCodex:** 21 hooks, including Codex-specific components (comment-checker, codegraph, LSP daemon, telemetry, auto-update, thread title hygiene).
- **Lazyworkbuddy:** 12 hooks — subset of lifecycle-critical events.
- **Why:** Codex-specific hooks have no WorkBuddy equivalent. WorkBuddy has native alternatives (LSP, telemetry, update mechanism).
- **Impact:** Low — the skipped hooks are either Codex-specific infrastructure or handled by WorkBuddy natively.
- **Mitigation:** 5 new hooks added (`PostToolUseFailure`, `StopFailure`, `SubagentStart`, `TaskCreated`, `TaskCompleted`) that enhance LazyCodex's design.

### G-003: MCP server count (3-5 vs 5)

- **LazyCodex:** 5 MCP servers: `grep_app`, `context7`, `codegraph`, `git_bash`, `lsp`.
- **Lazyworkbuddy:** 3-5 servers: `run-ledger`, `verification`, `parity-dashboard`, `git`, plus optional externals.
- **Why:** `codegraph` and `lsp` are Codex-specific. `grep_app` and `context7` are external services.
- **Impact:** Low — the 3 Lazyworkbuddy-specific MCP servers add capabilities LazyCodex doesn't have (structured run ledger, verification runner, parity dashboard).
- **Mitigation:** External services can be added as v0.13 add-ons.

### G-004: Model routing

- **LazyCodex:** Multi-model routing: `quick` → `gpt-5.4-mini`, `ultrabrain` → high-reasoning GPT, coding → Codex-tuned GPT. Task-category-based model selection.
- **Lazyworkbuddy:** Single model strategy for now. Agent `model` field may not support dynamic routing.
- **Why:** WorkBuddy's agent model configuration is simpler. LazyCodex's multi-model routing is a sophisticated optimization.
- **Impact:** Medium — may use more expensive model for simple tasks. No correctness impact (all tasks still complete; just less quota-efficient).
- **Mitigation:** Document as known gap. If multi-model routing becomes critical, investigate WorkBuddy model selection options.

### G-005: Codex marketplace installation

- **LazyCodex:** Installs via `npx lazycodex-ai install` or Codex marketplace. Auto-bootstrap on first session.
- **Lazyworkbuddy:** Installs via WorkBuddy plugin system (manual or marketplace). Bootstrap runs on SessionStart hook.
- **Why:** Different platform ecosystems.
- **Impact:** Low — install is a one-time operation. Both paths result in a working plugin.
- **Mitigation:** Document install steps clearly in plugin README (v0.3).

### G-006: Persistent session / Channels

- **LazyCodex:** Implicit session persistence through Codex's session management and Stop-hook continuation.
- **Lazyworkbuddy:** Session persistence through `.lazyworkbuddy/runs/` state. Channels (WeChat, Telegram) available but not integrated.
- **Why:** WorkBuddy session model differs. Channels are a WorkBuddy-native feature not present in LazyCodex.
- **Impact:** Low — core continuation loop (Stop hook → re-inject start-work) works identically.
- **Mitigation:** Channels can be added as v0.13 optional add-on.

---

## Gap Resolution Plan

| Gap | v0 Target | Resolution |
|-----|-----------|------------|
| G-001 (subagent model) | v0.5 | Thorough investigation; document exact mapping |
| G-002 (hook count) | v0.6 | Final hook configuration; verify all 12 work |
| G-003 (MCP servers) | v0.8 | Implement 3 servers; document external service availability |
| G-004 (model routing) | v0.12 | Document as permanent gap unless WorkBuddy adds support |
| G-005 (marketplace install) | v0.3 | Document install path; test on clean workspace |
| G-006 (persistent session) | v0.7 | State ledger provides equivalent durability |

## v0.4 Skill Porting Assessment (2026-07-09)

**Tool translation is complete** — all Codex-specific references in workflow instructions are replaced with WorkBuddy equivalents (residual Codex names appear only in "Adapted from..." citation footnotes). However, **semantic losses occurred during condensation** and are documented below for v0.9 hardening:

### G-007: start-work drops 9 adversarial class enumeration
- **LazyCodex:** `start-work` SKILL.md line 118 lists all 9 ultraqa adversarial classes with trigger facts
- **Lazyworkbuddy:** Initially referenced "the 9 adversarial classes" without listing them. **Fixed in review** — the 9 classes are now enumerated inline.
- **Impact:** Low (fixed). Target version: resolved.
- **Resolution (v0.9, 2026-07-09):** Confirmed fixed — 9 classes present at `start-work/SKILL.md` lines 70-79 with full trigger-fact descriptions (malformed_input, prompt_injection, cancel_resume, stale_state, dirty_worktree, hung_commands, flaky_tests, misleading_success_output, repeated_interruptions). Already resolved in v0.4 review.

### G-008: start-work drops worktree discipline
- **LazyCodex:** `start-work` Phase 2 (lines 71-92) requires `--worktree` for PR/branch work, `git worktree list --porcelain` verification, `worktree_path` in state; Hard Rule line 194: "No PR/branch implementation or review in the main worktree."
- **Lazyworkbuddy:** All worktree requirements dropped; `state.json` schema omits `worktree_path`.
- **Impact:** Medium — PR/branch work may pollute main worktree. Target version: v0.5 (subagents) or v0.9 (hardening).
- **Resolution (v0.9, 2026-07-09):** Added "## Worktree Discipline (v0.9 hardening)" section to `start-work/SKILL.md` with `git worktree add`, `git worktree list --porcelain` verification, `worktree_path` recording in `state.json`, and all-implementation-in-worktree rule.

### G-009: start-work drops debugging runtime audit
- **LazyCodex:** Completion phase (lines 176-184) requires a debugging-oriented runtime audit: name 3+ failure hypotheses, run distinguishing checks, append results.
- **Lazyworkbuddy:** Dropped — completion only runs the 5-agent review gate.
- **Impact:** Medium — missed runtime failure modes. Target version: v0.9.
- **Resolution (v0.9, 2026-07-09):** Added "## Debugging Runtime Audit (v0.9 hardening)" section to `start-work/SKILL.md` requiring 3+ failure hypotheses, distinguishing checks for each, and results appended to `events.jsonl` before `ORCHESTRATION COMPLETE`.

### G-010: start-work drops Sisyphus JSON schema detail
- **LazyCodex:** Lines 136-160 provide full DoneClaim/AdversarialVerify JSON schema with all fields and the adversarial-key probing requirement.
- **Lazyworkbuddy:** Summarized in 3 lines; schema fields and specific key-probing requirement omitted.
- **Impact:** Low-medium — the contract names are preserved; detail is in the verification rules. Target version: v0.9.
- **Resolution (v0.9, 2026-07-09):** Added "## DoneClaim/AdversarialVerify JSON Schema (v0.9 hardening)" section to `start-work/SKILL.md` with the full schema including all 9 adversarial class entries, field descriptions, verdict values, confidence range, and gap_analysis.

### G-011: ulw-loop iteration cap discrepancy
- **LazyCodex:** `full-workflow.md` line 144: "Cap at 5 cycles per goal. Cap identical same-criterion failures at 3." (per-goal and per-criterion granularity)
- **Lazyworkbuddy:** Uses 500 (ultrawork) / 100 (normal) total-iteration caps (from the README command description) — coarser granularity, missing the 5-cycles-per-goal and 3-same-failure limits.
- **Impact:** Medium — allows more iterations per goal than LazyCodex intends. Target version: v0.7 (run ledger) or v0.9.
- **Resolution (v0.9, 2026-07-09):** Updated `ulw-loop/SKILL.md` with all three cap levels: per-goal max 5 cycles, per-criterion max 3 same-failure before escalation, overall 500/100 cap. Updated execution loop, description, verification gates, failure behavior, and State Ledger Integration section to reflect all three levels.

### G-012: ulw-loop drops dynamic steering, final quality gate, delegation model
- **LazyCodex:** `full-workflow.md` defines 7 steering types (L206-220), a final quality gate with `--quality-gate-json` (L183-204), ATLAS-style delegation with work-sizing (L35-61), and wave-based parallelism (L136).
- **Lazyworkbuddy:** All dropped — the loop is condensed to core goal/evidence/checkpoint logic.
- **Impact:** Medium-high — steering and the final quality gate are significant LazyCodex features. Target version: v0.7 (run ledger) or v0.9.
- **Resolution (v0.9, 2026-07-09):** Added three new sections to `ulw-loop/SKILL.md`: "## Dynamic Steering (v0.9 hardening)" with 7 steering types and trigger conditions, "## Final Quality Gate (v0.9 hardening)" with re-run-verification, gate-reviewer approval, and evidence audit steps, and "## Delegation Model (v0.9)" with ATLAS-style XS/S/M/L/XL sizing and wave-based parallelism.

### G-013: ultrawork drops subagent dependency transition barriers
- **LazyCodex:** Lines 291-302: don't mark `update_plan` done while a subagent holds evidence; don't spawn plan-feedback before research returns; don't write final answer while subagents open; 2-silent-wait / 4-silent-check escalation.
- **Lazyworkbuddy:** Polling/fallback conditions preserved but all four transition-barrier rules dropped.
- **Impact:** Medium — orchestration discipline gap. Target version: v0.9.
- **Resolution (v0.9, 2026-07-09):** Added "## Subagent Transition Barriers (v0.9 hardening)" to `ultrawork/SKILL.md` with all four original barriers: don't mark plan done while subagent holds evidence, don't spawn plan-feedback before research returns, don't write final answer while subagents open, 2-silent-wait / escalation at 4 silent responses.

### G-014: ultrawork drops GREEN-step PR/branch refresh and Commits section
- **LazyCodex:** GREEN step (L226-230) requires refreshing branch/PR/issue state before dependent work; Commits section (L330-337) requires atomic conventional commits.
- **Lazyworkbuddy:** Both dropped (Commits arguably delegated to `git-master` skill).
- **Impact:** Low-medium. Target version: v0.9.
- **Resolution (v0.9, 2026-07-09):** Added two sections to `ultrawork/SKILL.md`: "## GREEN-step PR/Branch Refresh (v0.9)" with `git fetch`, `git status`, PR/issue comment checks, and "## Atomic Commits (v0.9)" with conventional commit format `type(scope): description` — one commit per completed checkbox.

### Tool translation table (confirmed complete)

| LazyCodex | WorkBuddy | Notes |
|-----------|-----------|-------|
| `multi_agent_v1` / `multi_agent_v1.spawn_agent` | WorkBuddy Agent tool | Subagent spawning with `isolation: true` preserves independent execution |
| `.omo/` | `.lazyworkbuddy/` | Run state directory renamed, no semantic change |
| `${PLUGIN_ROOT}` | `${CODEBUDDY_PLUGIN_ROOT}` | Environment variable renamed, same resolution semantics |
| `AGENTS.md` | `workbuddy.md` | Project memory file renamed, same hierarchical structure |
| Codex task spawning (`agent_type`, `fork_context`) | WorkBuddy subagent invocation | Same isolation semantics preserved |
| `update_plan` | `TaskCreate`/`TaskUpdate` | WorkBuddy-native task management replaces Codex plan updates |
| `codegraph_*`/`lsp_*` | Glob/Grep/LSP | WorkBuddy-native tools replace Codex-specific APIs |
| `load_skills=[...]` | Standard skill activation | WorkBuddy-native skill loading replaces Codex OMO loader |

Skills that are platform-agnostic (git-master: git commands only; debugging: phase loop and safety invariants; programming: language discipline axioms) required no adaptation beyond path and variable name translations.

### G-015: review-work "Context Miner" lane has no dedicated agent
- **LazyCodex:** `review-work` SKILL.md defines 5 review lanes; lane 5 ("Context Miner") mines git history, GitHub issues, and cross-references for missed context.
- **Lazyworkbuddy:** The `review-work` skill references this lane, and `docs/lazyworkbuddy-agent-orchestration.md` includes it in the review diagram, but there is no `lazyworkbuddy-context-miner.md` agent file. The `context-indexer` agent is a different role (init-deep repo layout indexing, not review-time context mining). The lane currently uses a generic autonomous agent.
- **Impact:** Low — the lane is functional via generic spawning; a named agent would improve routing clarity.
- **Target version:** v0.9 (hardening) — either create a dedicated `context-miner` agent or document that the lane reuses the `explorer` agent with a context-mining message.
- **Resolution (v0.9, 2026-07-09):** Created `lazyworkbuddy-plugin/agents/lazyworkbuddy-context-miner.md` with YAML frontmatter (model: default, effort: medium, maxTurns: 20), tools [Read, Grep, Glob, Bash, Git], disallowedTools [Write, Edit], skills [review-work], memory: false, isolation: true. Defines mission, allowed actions (git history mining, documentation mining, cross-reference mining, dependency inspection), forbidden actions, output format, and LazyCodex mapping.

---

_This file is updated by the Librarian after every accepted change that reveals new gaps, and after every version that resolves existing gaps._
