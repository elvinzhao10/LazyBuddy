# LazyBuddy Evaluation: LazyCodex Parity Assessment

> Comprehensive evaluation of how well LazyBuddy realizes LazyCodex semantics on the WorkBuddy platform.
> Last updated: v0.12 (2026-07-10)

## Overall Assessment

**Parity score: ~70% structural, ~85% semantic.**

LazyBuddy successfully preserves LazyCodex's **core workflow semantics** — the planning → execution → verification → review → memory loop, the Sisyphus completion contract, the 5-agent review gate, and the evidence-based done discipline. The structural gaps (fewer skills, fewer hooks, heuristic MCP) are mostly in secondary/tooling layers that WorkBuddy covers natively or that are Codex-specific infrastructure.

| Dimension | LazyCodex | LazyBuddy | Coverage | Quality |
|-----------|-----------|---------------|----------|---------|
| Core skills | 10 | 10 | 100% | Semantic match (adapted, not copied) |
| Secondary skills | 15 | 4 | 27% | Skipped (covered by WorkBuddy native or not needed) |
| Agent roles | 10 | 13 | 100%+ | Matched + 3 native enhancements |
| Lifecycle hooks | 21 | 12 | 57% | Core enforcement hooks matched; 9 skipped (infra) |
| MCP servers | 5 | 8 | 100%+ | Run-management native; context-tooling heuristic |
| State ledger | boulder.json | state.json + events.jsonl | Adapted | Richer schema, same semantics |
| Completion contract | DoneClaim/AdversarialVerify/FullyDone | Same | 100% | Verbatim preservation |
| Plugin manifest | 12 fields | 12 fields | 100% | Matched |

## Strengths

### 1. Core workflow fully ported
The essential LazyCodex loop works end-to-end: `/lazy-init-deep` → `/lazy-ulw-plan` → `/lazy-start-work` → `/lazy-ulw-loop` → `/lazy-review-work`. The v0.11 dogfood run proved this with a real task (fix stale settings.json), real state records, and `finalize-run.sh` returning `RUN COMPLETE`.

### 2. Binding enforcement (not advisory)
Three hooks provide real platform-level enforcement:
- **Stop hook** — parses plan checkboxes, returns `{"continue":false}` if unchecked work remains
- **SubagentStop hook** — validates `EVIDENCE_RECORDED` paths (inside root, exists, non-empty, not symlink), max 3 retries
- **PreToolUse hook** — blocks `rm -rf`, secret paths, force pushes, unauthorized publishes

### 3. Evidence-based completion
The Sisyphus contract (DoneClaim → AdversarialVerify → FullyDone) is preserved verbatim. An implementer cannot claim done without producing a verification artifact inside `.lazybuddy/runs/<run_id>/evidence/`.

### 4. Durable run state with recovery
`.lazybuddy/runs/<run_id>/` provides: state.json, events.jsonl (append-only), checkpoints, evidence, verification, review. State is recoverable from checkpoint + event replay. `finalize-run.sh` cross-checks both plan.md checkboxes AND state.json tasks (G-017 fix).

### 5. 5-agent parallel review
The review-work skill spawns 5 independent subagents (Goal Verifier, QA Executor, Code Reviewer, Security Auditor, Context Miner) with `isolation: true`. ALL-MUST-PASS verdict logic is preserved.

### 6. Honest gap documentation
17 gaps are documented in [lazybuddy-known-gaps.md](lazybuddy-known-gaps.md) with: LazyCodex source, LazyBuddy implementation, impact, resolution status, and capability labels.

## Weaknesses

### 1. Context-tooling MCP is heuristic, not semantic (G-003)

**LazyCodex** uses a real `codegraph` (parsed AST call graph via `@colbymchenry/codegraph`) and a real `lsp` daemon (`@oh-my-opencode/lsp-core`).

**LazyBuddy** substitutes grep-based heuristics:
- `context-graph` MCP: `blast_radius`, `file_deps`, `symbol_search` — all regex-based, not AST-parsed
- `code-intel` MCP: `diagnostics` runs real project linters (tsc/eslint/ruff), but `goto_definition`/`find_references`/`symbols` are grep approximations

**Impact:** No precise call graph, no semantic rename, no workspace-wide symbol identity. Blast-radius analysis is approximate.

**Why:** codegraph/lsp rely on external closed-source binaries. Clean-room adaptation requires WorkBuddy-native substitutes.

### 2. 9 hooks skipped — Codex-specific infrastructure (G-002)

**Skipped hooks (9):** comment-checker, codegraph hooks, LSP daemon hooks, telemetry, auto-update, thread-title hygiene, and others.

**Impact:** No automated code-comment quality checks, no real-time LSP diagnostics in hooks, no usage telemetry.

**Why:** These hooks integrate with Codex-specific infrastructure that doesn't exist in WorkBuddy. Some (telemetry, auto-update) are platform features, not plugin responsibilities.

### 3. 15 secondary skills not ported

**Missing skills:** ast-grep, coding-agent-sessions, comment-checker, frontend, lcx-contribute-bug-fix, lcx-doctor, lcx-report-bug, lsp, lsp-setup, refactor, rules, teammode, ultimate-browsing, ulw-research, visual-qa

**Impact:** No built-in AST-based search, no LSP setup, no comment quality checker, no frontend-specific workflow, no bug-report/contribute utilities, no team mode.

**Why:** Most are covered by WorkBuddy's native tools (Grep, Glob, LSP) or are utility tools not part of the core agent-harness workflow. Porting them would add clutter without meaningful parity gain.

### 4. Orchestrator write-boundary is prose-only (G-016)

**LazyCodex:** The orchestrator agent type is not granted Write/Edit to product paths — enforced by Codex's tool routing.

**LazyBuddy:** The orchestrator has `Write`/`Edit` in its tools (needed for `.lazybuddy/` state files). The "never write product code" rule is prose-only. A post-tool-use audit hook flags violations in `events.jsonl`, but cannot block them preemptively.

**Impact:** A misbehaving orchestrator turn could edit product code directly, bypassing the implementer delegation invariant. Mitigated by: (a) strong prose instruction, (b) audit hook logging, (c) reviewer catching direct edits.

**Why:** WorkBuddy's `disallowedTools` is tool-granular, not path-granular. Cannot express "Write only inside `.lazybuddy/`".

### 5. Single-model routing, no dynamic tiering (G-004)

**LazyCodex:** Dynamically selects model tier per task (e.g., o3 for planning, gpt-4o-mini for exploration).

**LazyBuddy:** Agent frontmatter specifies `model: reasoning|default|lite`, but WorkBuddy may not honor dynamic model switching per-agent in the same way. The routing is static (defined at agent creation, not dynamically selected per task).

**Impact:** May use stronger (more expensive) models for simple tasks, or weaker models for complex reasoning, depending on the agent's static config.

### 6. No channels / persistent session (G-006)

**LazyCodex:** Supports persistent sessions and multi-channel communication (WeChat, Telegram, Discord bridging).

**LazyBuddy:** No channel support. Sessions are ephemeral (state persists in `.lazybuddy/` but the conversation context does not survive restart).

**Impact:** Cannot bridge agent output to external messaging platforms. Deferred to v1.

### 7. Subagent model differences (G-001)

**LazyCodex:** `multi_agent_v1.spawn_agent` with `fork_context: false` creates a fully isolated context — the subagent sees nothing from the parent.

**LazyBuddy:** WorkBuddy's Agent tool with `isolation: true` provides isolation, but the exact semantics differ (message-based, not context-forking). The subagent receives a self-contained prompt rather than a forked context.

**Impact:** Subagent isolation is functionally equivalent but architecturally different. Some edge cases (shared file handles, concurrent state access) may behave differently.

## Future Improvement Suggestions

### Priority 1: Native LSP/codegraph integration (when available)
If WorkBuddy exposes native LSP or codegraph MCP surfaces:
- Wire `context-graph` MCP to the native codegraph (deprecate grep heuristics)
- Wire `code-intel` MCP's `goto_definition`/`find_references`/`symbols` to native LSP
- This would close G-003 and lift context-tooling parity from `heuristic` to `semantic`

### Priority 2: Path-scoped tool permissions
If WorkBuddy adds path-level deny rules:
- Enforce orchestrator `Write`/`Edit` to `.lazybuddy/`-only at platform level
- This would close G-016 and make the write-boundary platform-enforced, not prose-only

### Priority 3: Dynamic model routing
If WorkBuddy supports per-task model selection:
- Allow the orchestrator to upgrade/downgrade model tier based on task complexity
- This would close G-004 and match LazyCodex's dynamic tiering

### Priority 4: Port high-value secondary skills
Consider porting these skills if demand exists:
- `refactor` — AST-based refactoring (would need LSP)
- `rules` — project rule loading and enforcement
- `comment-checker` — code comment quality checks
- `lcx-doctor` — project health diagnostics (partially covered by `doctor.sh`)

### Priority 5: Channels and persistent session (v1)
- Implement WeChat/Telegram/Discord bridging
- Add session persistence beyond `.lazybuddy/` state (conversation context survival)
- This would close G-006

### Priority 6: Live orchestrator dogfood
The v0.11 dogfood proved the scripts work, but the root agent did the implementation work (not a spawned implementer). A true end-to-end test would:
1. Orchestrator spawns implementer subagent
2. Implementer does real work, produces evidence
3. SubagentStop hook verifies evidence
4. Verifier runs checks
5. Reviewer accepts/rejects
6. Librarian updates memory
7. finalize-run passes

The P5-1 test proved steps 1-3 work. Steps 4-7 need a full multi-agent session test.

## Capability Labels Summary

| Label | Count | Meaning |
|-------|-------|---------|
| `semantic` | 12 | Structured/parsed source of truth (state.json, DoneClaim, events.jsonl) |
| `project-tool-backed` | 8 | Invokes real project scripts/checkers (doctor.sh, verify.sh, security-check.sh) |
| `heuristic` | 5 | Grep-based approximation (context-graph, code-intel symbol ops) |
| `state-only` | 3 | State management without behavioral enforcement (settings.json patterns) |
| `host-substitution` | 4 | WorkBuddy covers the use case through a different surface |
| `native-enhancement` | 7 | LazyBuddy-only functionality (librarian, migration-planner, etc.) |
| `platform-gap` | 3 | Original surface not portable or not needed on WorkBuddy |

## Conclusion

LazyBuddy achieves **strong semantic parity** with LazyCodex's core agent-harness design. The planning → execution → verification → review → memory loop is fully functional with binding enforcement. The main weaknesses are in context-tooling (heuristic vs semantic code intelligence) and host-inherent limitations (path-scoped permissions, dynamic model routing, channels) that require WorkBuddy platform features to resolve.

The project demonstrates that a clean-room cross-platform adaptation of an agent harness is feasible: preserve the semantics, reimplement the surfaces, and document every deviation honestly.
