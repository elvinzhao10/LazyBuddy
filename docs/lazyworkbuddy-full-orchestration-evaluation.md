# Lazyworkbuddy → LazyCodex / OmO full-orchestration evaluation

> Source-traced evaluation. Every claim below is anchored to a file in `reference/lazycodex/` (the OmO plugin, v4.16.0) or to a file in this repo. Read-only analysis — no plugin code changed.
> Companion to `docs/lazyworkbuddy-evaluation-vs-lazytrae-lazycodex.md`.

## 0. Correction to the prior evaluation (important)

The earlier evaluation stated "`v0.8` was reverted and `.mcp.json` is still empty." A fresh file inspection disproves that:

- `lazyworkbuddy-plugin/.mcp.json` defines **5 real MCP servers** (`run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`), each pointing at an executable `mcp/<name>/server.sh`. MCP **infrastructure is built**.
- `docs/lazyworkbuddy-known-gaps.md` marks G-007 → G-015 as **"已补 / v0.9 已补"** (supplemented), including the `context-miner` agent (G-015) and the `ulw-loop` iteration caps / dynamic steering / final quality gate (G-011, G-012).
- `docs/lazyworkbuddy-parity-ledger.md` carries a v0.8 section claiming MCP + agents + hooks + state/loop are implemented.

So the repo is **ahead of the prior-turn memory log**. The accurate picture: v0.0–v0.7 (MVP) + v0.8 (MCP) + v0.9-style hardening are all present on disk. The remaining gaps are **context-tooling parity, model routing, hook richness, and activation** — not "missing files."

> Residual doc bugs to fix later: `plugin.json` version is still `0.3.0`; `.workbuddy/settings.json:73` version `0.3.0`; `parity-ledger.md` v0.3 paragraph still says `.mcp.json` is empty (false); `CHANGELOG.md` still claims "placeholder / no runtime behavior" (false).

## 1. Overall score (full orchestration)

| Lens | Score | Note |
| --- | --- | --- |
| LazyCodex / OmO full orchestration | 100 | Goal / source of truth |
| **Lazyworkbuddy — MVP core logic** | **~80** | Plan→execute→verify→review→loop, all adapted |
| **Lazyworkbuddy — FULL orchestration** | **~63** | Weighted across all OmO capabilities |
| LazyTrae | ~73 (inferred) | No artifact exists |

**Why full (63) < MVP-core (80):** the MVP definition does not demand context tooling, multi-model routing, or 21-hook richness. The *full* OmO orchestration leans heavily on `codegraph` (blast-radius), `context7` (doc injection), `lsp` (symbol edits + diagnostics gate), `git_bash` (auditable git), `grep_app` (GitHub search), and tiered model routing. Lazyworkbuddy consciously adapted/skipped those, so full-orchestration fidelity drops ~17 points below MVP-core.

## 2. Ten-dimension scorecard (full orchestration)

| # | Dimension | Score | Band | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Orchestration logic (plan→exec→verify→review→loop) | 95 | strong | 14 real skills; Sisyphus contract; `ulw-loop` with caps/steering/recovery |
| 2 | Verification discipline (evidence gates, 5-gate, Sisyphus) | 88 | strong | `subagent-stop.sh` evidence check; 5 review lanes; `verifier`/`reviewer` read-only |
| 3 | Traceability / durable state | 90 | strong | `events.jsonl`, `state.json`, run-ledger MCP (native advantage) |
| 4 | Subagent architecture (13 agents) | 72 | medium | Agents exist + scoped; single-model; no mailbox signals (G-001) |
| 5 | Lifecycle hooks (12 of 21) | 70 | medium | 3 enforcement hooks present; 9 advisory skipped |
| 6 | **MCP context tooling (vs goal's 5)** | **18** | weak | Lazyworkbuddy's 5 MCP are native, not `context7/codegraph/lsp/git_bash/grep_app` |
| 7 | Multi-model routing (tiered) | 35 | weak | Single model; no enforced `reasoning_effort` tiers (G-004) |
| 8 | Context management (compaction, codegraph, miner) | 62 | medium | Pass-through + resume + `context-miner` agent; no codegraph |
| 9 | Host-native extras (telemetry, LSP, auto-update…) | 30 | weak | Mostly skipped by design |
| 10 | Activation / operability | 50 | medium | `settings.json:72` `enabled:false`; stale version; contradictory docs |

Weighted ≈ **63/100**.

## 3. What OmO's full orchestration actually has (the bar we're scoring against)

Mapped from `reference/lazycodex/plugins/omo/`:

- **21 lifecycle hooks** — 4 enforcement (goal-budget `PreToolUse`, `Stop` auto-continuation, `SubagentStop` continuation, `SubagentStop` executor-evidence gate) + 17 advisory (LSP diagnostics gate, codegraph bootstrap, comment checker, telemetry, auto-update, thread-title hygiene, project-rules engine, 3× `post-compact` cache reset, etc.).
- **5 MCP servers** — `grep_app` (GitHub search), `context7` (just-in-time docs), `codegraph` (call-graph blast-radius/centrality), `git_bash` (auditable git over MCP), `lsp` (symbol edits + diagnostics).
- **10 agent roles with tiered models** — planners/reviewers on `gpt-5.5`/`xhigh`; `explorer`/`librarian` deliberately dropped to `gpt-5.4-mini`/`low`/`fast`.
- **Autonomous loop** — `ulw-loop`: 5 cycles/goal cap, 3 consecutive failures/criterion cap, compaction-safe resume (re-read `brief+goals+ledger`), structured dynamic steering (`OMO_ULW_LOOP_STEER:`), final 5-gate quality JSON (`codeReview`/`manualQa`/`gateReview`/`iteration`/`criteriaCoverage`).
- **5-agent parallel review** (`review-work`) — Goal Verifier (Oracle), QA Executor, Code Reviewer, Security Auditor, Context Miner; all-PASS required.
- **Sisyphus contract** — `DoneClaim → AdversarialVerify → FullyDone`.
- **Extras** — telemetry, auto-update, thread-title hygiene, LSP diagnostics gate, codegraph bootstrap, project-rules engine, comment checker, evidence gating, auto-continuation, worktree isolation, `.omo/` persistent state.

## 4. Lazyworkbuddy — strengths (verified)

- **S1 — Orchestration logic faithfully adapted.** Sisyphus is the *only* 1:1 `matched` method in the parity ledger, and the surrounding loop is real: `ulw-loop` has iteration caps + dynamic steering + compaction recovery + final quality gate (G-011/G-012 fixed). 14 skills carry genuine procedure content (zero placeholder hits).
- **S2 — 5 review lanes map to OmO's 5-agent review.** `reviewer`, `qa-executor`, `gate-reviewer`, `security-auditor`, `context-miner` (G-015 added) — all-PASS-gated, with read-only enforcement on the four judge roles; implementer cannot spawn subagents.
- **S3 — Traceability is a native advantage.** `events.jsonl` + `state.json` + `run-ledger` MCP surface things OmO scatters across `.omo/`. Parity ledger tracks 48 methods.
- **S4 — MCP infrastructure built (corrects prior belief).** 5 real JSON-RPC servers, not stubs.
- **S5 — 12 executable hook scripts**, 3 of them enforcement (stop-gate, subagent-stop evidence, pre-tool-use deny).

## 5. Lazyworkbuddy — weaknesses (the core of this eval)

**W1 — Plugin disabled by default.** `.workbuddy/settings.json:72` `"enabled": false`. The entire harness is inert until someone flips it. Highest-leverage, lowest-effort fix. *Evidence: `.workbuddy/settings.json`.*

**W2 — LazyCodex-context MCP servers are absent.** OmO's `context7` (doc injection), `codegraph` (blast-radius/centrality), `lsp` (symbol edits + diagnostics), `git_bash` (auditable git), `grep_app` (GitHub search) are **not implemented**. Lazyworkbuddy's 5 MCP are useful but *different* (run-ledger/parity/verification/source-map/status-dashboard). Consequence: `init-deep` scores directories on heuristics not real graph data; planners/explorers reason without code-graph; no LSP-aware refactors; no just-in-time docs. *Evidence: `.mcp.json` vs `reference/.../.mcp.json`. This is the single biggest full-orchestration gap.*

**W3 — Single-model, no tiered routing (G-004).** OmO runs planners/reviewers on `xhigh` and drops `explorer`/`librarian` to `mini/low/fast`. Lazyworkbuddy has `model: reasoning/default/lite` *hints* but no enforced `reasoning_effort` tiers; cost/latency not optimized; routing correctness leans on the host. G-004 is flagged "possibly permanent." *Evidence: `agents/*.md` frontmatter; `docs/lazyworkbuddy-known-gaps.md`.*

**W4 — 12 vs 21 hooks; 9 advisory hooks skipped.** Missing: LSP diagnostics gate, codegraph bootstrap, comment checker, telemetry, auto-update, thread-title hygiene, project-rules engine, and 3× `post-compact` cache resets. The 3 safety-critical enforcement hooks *are* present, so this is mostly "richness," but the `post-compact` cache resets matter: after context compaction, OmO reloads caches cleanly; Lazyworkbuddy risks stale state. *Evidence: `hooks/hooks.json` (12) vs `reference/.../plugin.json` (21).*

**W5 — Subagent model adaptation (G-001).** WorkBuddy's `Agent` tool replaces `multi_agent_v1`; the `WORKING:`/`BLOCKED:` mailbox signal protocol is absent; concurrency/context-isolation profile is unverified. In practice this may force more sequential execution than OmO's forked-context parallelism. *Evidence: `known-gaps` G-001; `reference/.../ultrawork/SKILL.md:255-269`.*

**W6 — LSP-aware editing + diagnostics gate absent.** OmO edits via `lsp_*` tools and gates on `post-tool-use` LSP diagnostics. Lazyworkbuddy has neither. *Evidence: `reference/.../components/lsp/`, `post-tool-use-checking-lsp-diagnostics.json`.*

**W7 — Codegraph context absent.** OmO computes directory importance and blast-radius via `codegraph`; Lazyworkbuddy uses heuristics. *Evidence: `reference/.../components/codegraph/`.*

**W8 — Stale metadata + contradictory docs.** `plugin.json` version `0.3.0`; `settings.json` version `0.3.0`; `parity-ledger.md` v0.3 paragraph says `.mcp.json` is empty (false); `CHANGELOG.md` says "placeholder / no runtime behavior" (false). All `implemented` claims are self-reported with no reproducible end-to-end integration test. *Evidence: `plugin.json:3`, `settings.json:73`, `parity-ledger.md`, `CHANGELOG.md`.*

**W9 — Runtime dir not pre-created.** `.lazyworkbuddy/` is absent at rest; first run depends on state scripts creating it correctly. Boundary risk for the Stop→re-inject continuation loop. *Evidence: repo `find` returns nothing for `.lazyworkbuddy/`.*

**W10 — MCP `required:false` + unverified in live session.** All 5 servers optional; skills fall back to direct script calls; the "tool" layer is static, not integration-tested in a real WorkBuddy session. *Evidence: `.mcp.json` (`required:false`); build-agent note.*

## 6. Inherent host deviations (forced, not sloppy)

| OmO (Codex) | Lazyworkbuddy (WorkBuddy) | Why |
| --- | --- | --- |
| `multi_agent_v1` fork_context + mailbox | `Agent` tool + isolation | Host runtime difference; mailbox signals gone (G-001) |
| 21 hooks | 12 hooks | 9 advisory hooks have no WorkBuddy event or are natively substituted |
| 5 context MCP (context7/codegraph/lsp/git_bash/grep_app) | 5 native MCP (run-ledger/parity/…) | Different host tool ecosystem; goal's context servers not ported |
| Tiered model routing (xhigh planners, mini/fast searchers) | Single model + role hints | WorkBuddy agent frontmatter doesn't enforce hard tiers (G-004) |
| LSP-aware edits + diagnostics gate | None | No LSP MCP in Lazyworkbuddy |
| `.omo/` monolith | `.lazyworkbuddy/` + `.workbuddy/` split | Cleaner separation; run ledger is a native advantage |

## 7. Recommended next steps (priority order)

1. **Flip `enabled: true`** in `.workbuddy/settings.json` (W1) — unblocks everything.
2. **Verify the hook `decision:block` contract** — confirm WorkBuddy actually blocks on `{"decision":"block"}` + `exit 0`; if not, the enforcement hooks are decorative.
3. **Port the 5 context MCP servers** (W2) — at minimum `context7` + `codegraph` + `lsp` equivalents, or WorkBuddy-native substitutes. This is the largest fidelity jump.
4. **Add tiered model routing** (W3) — enforce `reasoning_effort` tiers per role; drop explorer/indexer to a cheaper/faster model.
5. **Fix metadata + doc contradictions** (W8) — bump versions, rewrite CHANGELOG/parity-ledger v0.3 paragraphs, add one reproducible end-to-end integration test.
6. **Add `post-compact` cache-reset hooks** (W4) — close the stale-state risk after compaction.
7. **Pre-create `.lazyworkbuddy/` scaffold** (W9) — remove first-run fragility.

## 8. Bottom line

Lazyworkbuddy is a **faithful, logic-complete adaptation** of OmO's orchestration: the plan→execute→verify→review→loop spine, the Sisyphus contract, the 5-agent review, and the durable run ledger are all genuinely present and adapted with care. Its weakness against the *full* OmO orchestration is **not missing orchestration logic** — it is **missing context tooling** (`codegraph`/`context7`/`lsp`), **tiered model routing**, and **hook richness**, plus the trivial-but-blocking fact that **the plugin is switched off**. Fix W1–W3 and full-orchestration fidelity climbs from ~63 toward ~80.
