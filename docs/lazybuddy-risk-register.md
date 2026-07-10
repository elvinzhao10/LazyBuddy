# LazyBuddy Risk Register

> v0.1 — Ranked risks with mitigations
> Risks ordered by severity × likelihood

## Risk Scoring

Each risk is scored on two axes:
- **Severity (S):** 1 = minor inconvenience, 2 = workflow degraded, 3 = workflow broken, 4 = project at risk, 5 = catastrophic
- **Likelihood (L):** 1 = theoretical, 2 = unlikely, 3 = possible, 4 = likely, 5 = near-certain

**Risk Score = S × L** (range: 1-25). Scores ≥15 are CRITICAL, 10-14 are HIGH, 5-9 are MEDIUM, <5 are LOW.

---

## Architectural Risks

### [R1] WorkBuddy Subagent Model Divergence from LazyCodex

| Field | Detail |
|-------|--------|
| **Score** | 15 (CRITICAL): S=5, L=3 |
| **Description** | LazyCodex uses Codex `multi_agent_v1.spawn_agent` with `agent_type` routing, `fork_context`, `wait_agent`, `close_agent`. WorkBuddy uses `Agent` tool with different spawning, context, and wait semantics. The mapping may not support all LazyCodex orchestration patterns (parallel spawn, mailbox signals, child process tracking). |
| **Impact** | Orchesterator cannot reliably delegate work to subagents; start-work and ulw-loop break. |
| **Source** | [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Codex Harness Tool Compatibility table; [ulw-loop SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md) Codex Tool Mapping. |
| **Mitigation** | V0.5: thorough subagent model investigation before writing agent definitions. Document every divergence from LazyCodex agent model in known-gaps. If WorkBuddy subagents cannot match parallelism, fall back to sequential execution with explicit checkpointing. |
| **Contingency** | If subagents fundamentally incompatible: implement coordination logic within Skills instead of agent spawning; accept reduced parallelism. |
| **Monitoring** | v0.5 acceptance test: spawn 3+ agents in parallel, verify independent execution. |

### [R2] Hook Continuation Loop May Infinite-Loop

| Field | Detail |
|-------|--------|
| **Score** | 12 (HIGH): S=4, L=3 |
| **Description** | LazyCodex's Stop/SubagentStop hooks re-inject start-work when unchecked checkboxes remain. If state.json becomes corrupted or the loop logic fails to detect completion, the agent may re-inject indefinitely. |
| **Impact** | Agent consumes tokens without making progress; user must manually interrupt. |
| **Source** | [stop-checking-start-work-continuation.json](../dev/reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json); [subagent-stop-checking-start-work-continuation.json](../dev/reference/lazycodex/plugins/omo/hooks/subagent-stop-checking-start-work-continuation.json). |
| **Mitigation** | Hard iteration cap: maximum 50 re-injections per session (ultrawork: 500 per goal). Bail and print error if cap exceeded. State validation on every re-injection: if state.json is unreadable, bail. |
| **Contingency** | If loop detection is unreliable: add user-visible prompt "Continue work? (y/n)" after N re-injections instead of auto-continuing. |
| **Monitoring** | v0.6 acceptance test: simulate corrupted state.json → verify hook bails instead of looping. |

### [R3] LazyCodex Skill Semantics Lost in Adaptation

| Field | Detail |
|-------|--------|
| **Score** | 10 (HIGH): S=5, L=2 |
| **Description** | When porting LazyCodex SKILL.md to WorkBuddy SKILL.md, subtle semantic details may be lost: tier triage thresholds, evidence gate strictness, adversarial class probing, delegation discipline. The recreated system may "look right" but behave differently. |
| **Impact** | LazyBuddy workflows produce lower-quality results than LazyCodex; parity is superficial. |
| **Source** | All 25 LazyCodex skills under [dev/reference/lazycodex/plugins/omo/skills/](../dev/reference/lazycodex/plugins/omo/skills/). |
| **Mitigation** | V0.4: pair each Skill port with a semantic checklist derived from the source. V0.9 hardening: verifier false-positive/false-negative tests. V0.11 dogfood: real-world test. |
| **Contingency** | If semantic gap is large: create a "semantic gap" appendix to known-gaps; prioritize the most workflow-critical skills for deeper adaptation. |
| **Monitoring** | v0.4-v0.11: every Skill port passes semantic checklist before proceeding. |

### [R4] Plugin Install/Uninstall Reliability

| Field | Detail |
|-------|--------|
| **Score** | 8 (MEDIUM): S=4, L=2 |
| **Description** | LazyCodex has a mature install/uninstall story (`npx lazycodex-ai install/uninstall`, Codex marketplace). WorkBuddy's plugin install/uninstall story may differ, and our plugin may not reliably activate on installation. |
| **Impact** | Users cannot install LazyBuddy; project is unusable. |
| **Source** | [LazyCodex README.md](../dev/reference/lazycodex/README.md) Install/Uninstall sections. |
| **Mitigation** | V0.3: test plugin install on a clean WorkBuddy workspace. Document install steps clearly. V0.12: final install test before release. |
| **Contingency** | If WorkBuddy plugin system is unreliable: provide manual installation script that symlinks files into `.workbuddy/`. |
| **Monitoring** | v0.3, v0.12 acceptance tests: install → verify hooks active → uninstall → verify hooks removed. |

### [R5] Evidence Capture Reliability

| Field | Detail |
|-------|--------|
| **Score** | 8 (MEDIUM): S=4, L=2 |
| **Description** | LazyCodex's evidence gate is unforgiving: DoneClaim must be independently verified; AdversarialVerify must probe every applicable class; FullyDone only after both pass. Our implementation may miss edge cases in evidence capture (race conditions in events.jsonl writes, missing artifact paths, stale state). |
| **Impact** | Done claims accepted without real verification; quality bar drops below LazyCodex standard. |
| **Source** | [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phase 4, Sisyphus completion contract. |
| **Mitigation** | Atomic event writes (append-only, never overwrite). Verifier runs in isolated context (no shared state with executor). Manual-QA artifacts must be verified as readable files. |
| **Contingency** | If evidence capture is unreliable: add human-in-the-loop gate for acceptance; require user confirmation for each checkbox before mark-complete. |
| **Monitoring** | v0.7 acceptance test: complete 3 checkboxes → verify all DoneClaim + AdversarialVerify entries are complete and correct. |

### [R6] Multi-Agent Orchestration Complexity

| Field | Detail |
|-------|--------|
| **Score** | 8 (MEDIUM): S=3, L=3 |
| **Description** | LazyCodex's orchestrator spawns, waits, and manages multiple parallel subagents with mailbox signals. WorkBuddy's Agent tool may not support the same mailbox/wait/signal patterns. Coordinating parallel agents with dependencies without the Codex-native primitives may be brittle. |
| **Impact** | Orchestrator cannot manage parallel work; performance degrades to sequential; review-work 5-agent review may deadlock. |
| **Source** | [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phase 3 delegate-everything rule; [review-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) Phase 1-2. |
| **Mitigation** | V0.5: start with sequential subagent execution; add parallelism only after sequential is stable. V0.9: review-work lanes can run sequentially if parallel fails. |
| **Contingency** | If parallelism is fundamentally limited: accept degraded performance; document as known gap. |
| **Monitoring** | v0.5 acceptance test: spawn 2+ agents → verify all complete → collect results. |

### [R7] Project Memory Staleness

| Field | Detail |
|-------|--------|
| **Score** | 6 (MEDIUM): S=3, L=2 |
| **Description** | `.workbuddy/workbuddy.md` is generated once by init-deep but must stay current as the codebase changes. Without automated updates (Librarian), it drifts and agents use stale context. |
| **Impact** | Agents make decisions based on outdated project understanding; init-deep must be re-run manually. |
| **Source** | [init-deep SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md) update mode. |
| **Mitigation** | V0.9 Librarian: auto-update workbuddy.md after accepted changes that add new directories or change conventions. Update mode in init-deep: modify existing + create new where warranted. |
| **Contingency** | If automated updates are unreliable: add `workbuddy.md` staleness check to SessionStart hook; warn user if >7 days old. |
| **Monitoring** | v0.9 acceptance test: make a change that adds a new directory → verify Librarian updates workbuddy.md. |

### [R8] MCP Server Unavailability

| Field | Detail |
|-------|--------|
| **Score** | 6 (MEDIUM): S=2, L=3 |
| **Description** | MCP servers (run-ledger, verification, parity-dashboard) may not start or may crash during operation. Skills that depend on MCP will fail if MCP is unavailable. |
| **Impact** | Run ledger queries fail; verification cannot run; parity check blocked. |
| **Source** | [.mcp.json](../dev/reference/lazycodex/plugins/omo/.mcp.json) with `codegraph` using `"required": false` pattern. |
| **Mitigation** | V0.8: all Skills have fallback paths (direct file read/write) when MCP is unavailable. MCP servers marked as `required: false` following LazyCodex pattern. |
| **Contingency** | If MCP is completely unavailable: remove MCP dependency; use file-based operations exclusively. |
| **Monitoring** | v0.8 acceptance test: stop MCP server → verify Skills fall back to file access without error. |

### [R9] Clean-Room Boundary Violation

| Field | Detail |
|-------|--------|
| **Score** | 10 (HIGH): S=5, L=2 |
| **Description** | Despite clean-room discipline, an agent may inadvertently reproduce LazyCodex source verbatim — especially when porting Skills where the source is actively read during adaptation. |
| **Impact** | License violation (MIT license requires attribution; verbatim copy without attribution violates terms). Project credibility damage. |
| **Source** | AGENTS.md (removed — see project memory in README) Core Rule #8 (no secrets) and clean-room adaptation requirement. |
| **Mitigation** | All ported Skills must be semantically equivalent, not textually equivalent. Grep for LazyCodex-specific phrases in all written files. Document adaptation decisions in each Skill's comments. |
| **Contingency** | If verbatim copies are found: re-express the same semantics in different language. |
| **Monitoring** | v0.4 acceptance test: diff each ported Skill against LazyCodex source → no identical blocks >50 chars. |

---

## Implementation Risks (Per-Version)

| Version | Risk | Score | Mitigation |
|---------|------|-------|------------|
| v0.2 | `workbuddy.md` too generic | 4 (LOW) | Follow init-deep quality gates; test with fresh agent |
| v0.3 | Plugin format incompatible | 6 (MEDIUM) | Follow verified WorkBuddy plugin spec; test install |
| v0.4 | Skill semantics lost | 10 (HIGH) | Semantic checklist per Skill; diff against source |
| v0.5 | Agent tool restrictions don't match | 8 (MEDIUM) | Document gaps; Skill-level enforcement fallback |
| v0.6 | Hook scripts timeout | 6 (MEDIUM) | Keep hooks fast; background heavy work |
| v0.7 | State file corruption | 8 (MEDIUM) | Atomic writes; validation on read; checkpoints |
| v0.8 | MCP servers don't start | 6 (MEDIUM) | Fallback to file access; mark as required: false |
| v0.9 | Librarian overwrites human edits | 4 (LOW) | Diff before write; append-only; human sections preserved |
| v0.10 | Migration planner too abstract | 4 (LOW) | Concrete example: port a simple Skill |
| v0.11 | Dogfood reveals fundamental issues | 8 (MEDIUM) | Time-box; document issues; fix in v0.12 if minor |
| v0.12 | Parity gaps too large | 8 (MEDIUM) | Prioritize; document workarounds; plan v0.13 |

---

## Risk Mitigation Schedule

| Version | Risks Mitigated |
|---------|----------------|
| v0.1 | R3 (semantic loss), R9 (clean-room) — architectural decisions documented |
| v0.2 | R7 (staleness) — init-deep established |
| v0.3 | R4 (install/uninstall) — plugin scaffold tested |
| v0.4 | R3 (semantics), R9 (clean-room) — Skill ports diff-checked |
| v0.5 | R1 (subagent model), R6 (orchestration) — agent model tested |
| v0.6 | R2 (loop) — continuation loop tested |
| v0.7 | R5 (evidence capture) — state ledger tested |
| v0.8 | R8 (MCP unavailability) — fallbacks implemented |
| v0.9 | R7 (staleness) — Librarian activated |
| v0.10 | R3 (semantics) — migration methodology generalized |
| v0.11 | All remaining — dogfood exercises all paths |
| v0.12 | R4 (install), parity gaps — final verification |

---

_All risks trace to specific LazyCodex source files in `dev/reference/lazycodex/`. Mitigations follow WorkBuddy-native patterns verified against official docs._
