# Lazyworkbuddy evaluation — vs LazyTrae and the LazyCodex goal

> Read-only comparative evaluation. No plugin code was changed.
> Companion to the v0.1–v0.5 gap audit and the two scorecard widgets.

## 1. Executive summary

| System | Score / 100 | Status |
| --- | --- | --- |
| **LazyCodex** (OmO / Codex plugin, v4.16.0) | 100 | Ultimate goal / source of truth |
| **Lazyworkbuddy** (WorkBuddy-native rebuild) | ~80 | MVP complete (v0.0–v0.7); MCP + operability gaps |
| **LazyTrae** (Trae-native sibling) | ~73 (inferred) | No inspectable artifact — estimate only |

**Why your results feel weak:** the build is *substantively complete* for the MVP, but it is **not live**. The plugin is disabled in `.workbuddy/settings.json` (`plugin.lazyworkbuddy.enabled: false`), and the harness depends on v0.6/v0.7 runtime pieces that were only built *after* the audit's first pass. Content being present on disk is not the same as the harness actually running for you. The missing piece is **activation + verification of the hook contract**, not missing features.

---

## 2. Overall fidelity (why these numbers)

- **LazyCodex = 100** by definition — it is the reference target. 21 lifecycle hooks, 5 MCP servers, `multi_agent_v1` subagent spawning, `.omo/` run state, multi-model routing.
- **Lazyworkbuddy ~80**: semantically faithful, workflow-complete MVP. The ~20-point gap is concentrated in two areas that are *fixable without redesign*: (a) MCP tool integration is unbuilt (v0.8 not executed — `.mcp.json` still `{}`), and (b) operability — the plugin is not enabled, so nothing is actually wired to your session.
- **LazyTrae ~73 (inferred)**: there is **no LazyTrae artifact** anywhere in the workspace or the reference repo. The only trace is one sentence in `plan/README.md` describing the *plan* as "shaped like your LazyTrae/LazyWorkBuddy prompt packs." Any score for it is a reasoned estimate of a Trae-native adaptation facing the same host-imposed constraints, **not a measured result**.

---

## 3. Ten-dimension scorecard (Lazyworkbuddy)

| # | Dimension | Score | Band |
| --- | --- | --- | --- |
| 1 | Semantic fidelity to LazyCodex intent | 90 | strong |
| 2 | Workflow coverage (init→plan→execute→verify→review) | 95 | strong |
| 3 | Verification discipline (evidence gates, Sisyphus) | 85 | strong |
| 4 | Traceability (events.jsonl, parity ledger, run log) | 95 | strong |
| 5 | Host-native leverage (Skills/Agents/Hooks/MCP) | 80 | strong |
| 6 | Subagent architecture (Agent tool vs multi_agent_v1) | 75 | medium |
| 7 | Extensibility / maintainability | 82 | strong |
| 8 | Enforcement reliability (hook `decision:block` contract) | 50 | medium* |
| 9 | MCP / tool integration (context7, codegraph, etc.) | 15 | weak |
| 10 | Operability (plugin enabled, settings live) | 58 | medium |

> *Enforcement reliability is a question mark, not a confirmed 50. The hook scripts emit `{"decision":"block"}` and `exit 0`, but whether WorkBuddy honors that JSON contract to actually block is **unverified**. If it does, this dimension rises to ~85; if not, the stop-gate and subagent-stop evidence gates do not fire and the score is ~30.

Weighted core (dimensions 1–7) ≈ 87. Including the operational drags (8–10) pulls the blended number to ~78–80.

---

## 4. Lazyworkbuddy — strengths

- **Semantic fidelity (~90):** Core LazyCodex behaviors are preserved — tier triage, PIN→RED→GREEN→SURFACE→CLEAN, 5-gate review, Sisyphus completion contract (DoneClaim → AdversarialVerify → FullyDone), orchestrator-never-implements, ALL-MUST-PASS. Tool translations (`multi_agent_v1`→Agent tool, `.omo/`→`.lazyworkbuddy/`, `${PLUGIN_ROOT}`→`${CODEBUDDY_PLUGIN_ROOT}`) are applied consistently across 14 skills.
- **Workflow coverage (95):** Every LazyCodex workflow (init-deep, ulw-plan, start-work, ulw-loop, verifier, reviewer, librarian, migration-planner + 6 extended skills) has a WorkBuddy-native counterpart. v0.0–v0.7 executed and reviewed.
- **Verification discipline (85):** Stop hook blocks premature completion on unchecked plan checkboxes; SubagentStop verifies `EVIDENCE_RECORDED` paths; PreToolUse denies secrets/destructive ops. Context-pressure detection prevents infinite loops.
- **Traceability (95):** `events.jsonl` on every transition, parity ledger (48+ methods tracked), per-run `state.json`, daily work log. You can reconstruct any decision.
- **Host-native advantages (added, not in LazyCodex):** the `.lazyworkbuddy/` run ledger, the parity dashboard concept, and WorkBuddy's native Skills/Agents surfaces are cleaner than LazyCodex's monolithic OmO plugin in some respects.

## 5. Lazyworkbuddy — weaknesses

- **MCP / tool integration (15):** v0.8 was attempted but the worker did the *wrong task* and was reverted. `.mcp.json` is still `{}`. The 5 LazyCodex MCP servers (grep_app, context7, codegraph, git_bash, lsp) are not wired. This removes just-in-time doc lookup, code-graph context, and LSP-aware edits — a real capability loss vs the goal.
- **Operability (58):** Plugin disabled in settings. Even with all files present, the harness is inert for the user until enabled and the hook contract is confirmed.
- **Enforcement contract (50, unverified):** depends on WorkBuddy honoring the `decision:block` JSON from a bash hook. If it doesn't, the safety gates are decorative.
- **Documented semantic losses (known gaps G-001…G-015):** subagent model is adapted not identical (G-001/002), hook count 12 vs 21 (G-002), single-model vs multi-tier routing (G-004), context-miner lane has no dedicated agent (G-015). All logged, none silently dropped.
- **Stale metadata:** `plugin.json` version `0.3.0` (should reflect ≥v0.7), `CHANGELOG.md` still claims "placeholder scaffold, no runtime behavior" (false), `workbuddy.md` version line lagged behind actual progress.

---

## 6. LazyTrae — explicit caveat

**There is no LazyTrae artifact to evaluate.** It appears exactly once, in `plan/README.md`, as a *description of the plan's shape* ("shaped like your LazyTrae/LazyWorkBuddy prompt packs"). No `lazyworkbuddy`-Trae plugin, repo, or skill pack exists in this workspace or in `reference/lazycodex/`.

Therefore the ~73 is an **inference**, not a measurement:
- A Trae-native adaptation would face the same host-imposed constraints (different subagent model, different hook surface, different MCP story) and likely land in a similar band.
- It cannot be scored on dimensions 1–10 above because there is nothing to inspect.

Treat any LazyTrae comparison as **directional only**. If a real LazyTrae repo exists elsewhere, point me at it and I will re-run this evaluation empirically.

---

## 7. Inherent deviations forced by host differences (WorkBuddy / Trae ≠ Codex)

These are not bugs or omissions — they are consequences of rebuilding on a different host runtime:

| LazyCodex (Codex) | Lazyworkbuddy (WorkBuddy) | Why it deviates |
| --- | --- | --- |
| `multi_agent_v1` fork_context + mailbox | WorkBuddy `Agent` tool (general-purpose / Explore / Plan subagents) | Codex spawns isolated forked contexts with a mailbox; WorkBuddy uses the Agent tool with scoped subagent types. Concurrency and context-isolation semantics differ (G-001). |
| 21 lifecycle hooks | 12 hooks wired (subset confirmed real) | LSP/codegraph/telemetry/auto-update/thread-title hooks either skipped or substituted by native WorkBuddy surfaces (G-002). The 12 chosen cover the safety-critical lifecycle. |
| 5 MCP servers (grep_app, context7, codegraph, git_bash, lsp) | 0 implemented (design adds run-ledger/verification/parity-dashboard as *advantages*) | v0.8 not executed. Missing MCP loses just-in-time doc/code-graph context (G-003). |
| Multi-tier model routing (reasoning/lite per role) | Single default model, role hints only | WorkBuddy agent frontmatter does not enforce hard model tiers the way OmO does; quota/behavior impact only, no fidelity loss for logic (G-004). |
| `.omo/` monolithic run state | `.lazyworkbuddy/` + `.workbuddy/` split (Plugin / Project Memory / Run State) | Cleaner separation, but requires the run ledger to exist before skills can run (a sequencing flaw in the plan order — v0.5 before v0.7). |
| OmO plugin auto-loads on session | Plugin must be explicitly enabled in settings | Host policy: plugins are opt-in. This is why "it's built but does nothing" — the enablement step was never completed. |

**Net:** the deviations are *architectural adaptations*, consistently logged in `docs/lazyworkbuddy-known-gaps.md`, not silent regressions. The fidelity loss is real but bounded and concentrated in MCP (unbuilt) and enforcement verification (unconfirmed).

---

## 8. Recommended next steps (operational, not new implementation)

1. **Enable the plugin** — flip `plugin.lazyworkbuddy.enabled` to `true` in `.workbuddy/settings.json` (currently `false` at line 72). This is the single highest-leverage fix for "I'm not getting good results."
2. **Verify the hook contract** — run the v0.6 manual test plan (Stop blocks on unchecked work, SubagentStop blocks missing evidence, PreToolUse denies `rm -rf`). Confirm WorkBuddy actually blocks on `{"decision":"block"}`. If it doesn't, the hooks need a different enforcement channel.
3. **Fix stale metadata** — bump `plugin.json` to reflect ≥v0.7, rewrite the `CHANGELOG.md` "placeholder" line, reconcile `workbuddy.md` version line.
4. **Build v0.8 MCP servers** — wire the 5 LazyCodex-equivalent MCP servers (or WorkBuddy-native substitutes) so context7/codegraph-class context is available. This closes the biggest remaining fidelity gap.
5. **Re-run the audit after activation** — most "weak result" symptoms should resolve once the plugin is live and the hook contract is confirmed.

---

## 9. Bottom line

Lazyworkbuddy is a **faithful, well-documented MVP** of LazyCodex on WorkBuddy — semantically ~90, workflow-complete, and traceable. Its weakness is not missing content but **non-activation**: the plugin is off, MCP is unbuilt, and the hook-blocking contract is unverified. LazyTrae cannot be empirically compared because no artifact exists. The host-imposed deviations (subagent model, 12-vs-21 hooks, 5-vs-0 MCP, single-model routing) are logged and bounded, not silent.
