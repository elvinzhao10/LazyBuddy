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

---

_This file is updated by the Librarian after every accepted change that reveals new gaps, and after every version that resolves existing gaps._
