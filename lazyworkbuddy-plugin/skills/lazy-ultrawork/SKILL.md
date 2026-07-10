---
name: lazy-ultrawork
description: "Binding high-precision mode. Tier triage (LIGHT/HEAVY), PIN-RED-GREEN-SURFACE-CLEAN loop, binding reviewer gate, evidence-grade rigor."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# ultrawork

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md)

<ultrawork-mode>

**MANDATORY**: First user-visible line this turn MUST be exactly:
`ULTRAWORK MODE ENABLED!`

[CODE RED] Maximum precision. Outcome-first. Evidence-driven.

## Purpose

Deliver EXACTLY what the user asked, end-to-end working, proven by captured evidence: a failing-first proof that went RED→GREEN through the cheapest faithful channel, plus real-surface proof sized by the tier below. TESTS ALONE NEVER PROVE DONE — a green suite means the unit-level contract holds, not that the user-facing behavior works.

## Trigger Conditions

- The word "ultrawork" or "ulw" appears in the user prompt
- The `/lazy-ultrawork` command is invoked
- The UserPromptSubmit hook detects the ultrawork keyword and injects the bootstrap

Once activated, ultrawork mode governs EVERY subsequent action in the session until all success criteria are met or the iteration cap is reached.

## Required Context

- The user's goal statement (explicit or inferred from the prompt)
- The loaded skill list — survey ALL skills before starting; prefer every genuinely applicable one
- The repo structure (workbuddy.md, directory layout, existing conventions)
- Access to the four Manual-QA channels: HTTP, tmux, browser, CLI

## Tool Access

Ultrawork mode grants FULL tool access but governs HOW tools are used:
- No production code change before its failing-first proof is captured RED
- No `--dry-run` as completion evidence
- No tests-only completion claim — a real-surface Manual-QA artifact is required
- No claiming done from inference — only from captured evidence
- Parallel tool calls for any independent work within a step

## Step-by-Step Procedure

### Bootstrap 0: Survey skills, then size the work

Survey the loaded skill list. Read the description of every loosely relevant skill. Decide explicitly which skills this task will use — name them in the notepad with a one-line reason each. Skipping a skill that fits the task is a defect.

Then run **Tier triage** — classify ONCE and record the tier + one-line justification in the notepad. Ratchet up only; never downgrade mid-task.

**Default is LIGHT.** Take **HEAVY** only when the change set hits a fact you can point to:
- A new module, layer, domain model, or abstraction
- Auth, security, session, or permissions
- An external integration (API, queue, payment, webhook)
- A DB schema or migration
- Concurrency, transaction boundaries, or cache invalidation
- A refactor crossing domain boundaries
- The user signaled care ("carefully", "thoroughly", "design first") or demanded review

When unsure, take HEAVY. If a HEAVY fact surfaces mid-task, upgrade immediately and redo whatever the LIGHT path skipped.

**LIGHT** — narrow change inside existing layers: plan directly in the notepad; 1-2 success criteria (happy path + riskiest edge); one real-surface proof of the user-visible deliverable (auxiliary surfaces are first-class for CLI- or data-shaped work); self-review recorded in the notepad instead of the reviewer loop.

**HEAVY** — anything a fact above names: spawn a plan agent to decide waves; 3+ success criteria (happy, edge, regression, adversarial risk), each with its own channel scenario and both evidence pieces; reviewer loop until unconditional approval.

### Bootstrap 1: Create the goal with binding success criteria

Open your reply with a `# Goal` block treated as binding. The criteria MUST list, upfront:
- The user-visible deliverable in one line, and the tier with its justification
- Success criteria sized by tier (LIGHT 1-2, HEAVY 3+ covering happy path, edge cases — boundary / empty / malformed / concurrent — and adjacent-surface regression named by file + function), each naming its exact scenario: the literal command / page action / payload and the binary PASS/FAIL observable, plus the evidence artifact it will capture
- For each criterion, the failing-first proof (test id or scenario) that will be captured RED BEFORE the implementation and GREEN after. Evidence added after the green code does NOT satisfy this.

These scenarios are the contract. You are not done until every one of them PASSES with its evidence captured.

### Bootstrap 2: Open the durable notepad

Run: `NOTE=$(mktemp -t ulw-$(date +%Y%m%d-%H%M%S).XXXXXX.md)`. Echo the path. Initialize it with these sections and APPEND (never rewrite) as you work:

```
# Ultrawork Notepad — <one-line goal>
Started: <ISO timestamp>

## Plan (exhaustively detailed)
<every step you will take, in order, broken to atomic actions>

## Success criteria + QA scenarios
<copied from the goal>

## Now
<the single step in progress>

## Todo
<every remaining step, ordered>

## Findings
<every non-obvious fact discovered, with file:line refs>

## Learnings
<patterns / pitfalls / principles to remember next turn>
```

Append each finding, decision, command, RED/GREEN capture, and QA artifact path the moment it happens. Update `## Now` and `## Todo` on every transition. Append-only — never rewrite. After any compaction or context loss, STOP and re-read the WHOLE notepad FIRST before any other action, then resume from `## Now`.

### Bootstrap 3: Register tasks via WorkBuddy TaskCreate/TaskUpdate

Translate every action from the plan into a task — one step per atomic work unit: an edit plus its verification, a QA scenario run, a teardown. Use `TaskCreate` for new steps, `TaskUpdate` to mark status changes. Keep each step small enough to finish within a few tool calls.

Call `TaskUpdate` on EVERY state transition — the instant a step starts (mark `in_progress`) and the instant it finishes (mark `completed`). Exactly ONE `in_progress` at a time. Mark completed IMMEDIATELY — never batch, never let the task list lag behind reality. Add newly discovered steps with `TaskCreate` the moment they surface.

Step text encodes WHERE / WHY (which criterion it advances) / HOW / VERIFY:
`path: <action> for <criterion> — verify by <check>`

GOOD pair (test-first, ordered):
- `foo.test.ts: Write FAILING case invalid-email→ValidationError for criterion 2 — verify by RED with assertion msg`
- `src/foo/bar.ts: Implement validateEmail() RFC-5322-lite for criterion 2 — verify by foo.test.ts GREEN + curl 400 body`

BAD: "Implement feature" / "Fix bug" / "Add tests later" / writing production code before its failing test → rewrite.

## Execution Loop: PIN → RED → GREEN → SURFACE → CLEAN

Until every success criterion PASSES with its evidence captured:

1. **Pick next criterion** → mark `in_progress` → update notepad `## Now`.
2. **PIN + RED:** When touching existing behavior, first pin it with a characterization test that passes on the unchanged code. Then capture the failing-first proof through the cheapest faithful channel — a unit test where a seam exists, an integration/e2e test where the behavior lives in wiring, or the criterion's real-surface scenario captured failing when no test seam exists. It must fail for the RIGHT reason (not a syntax error, not a missing import). Paste RED output into the notepad. No production code yet.
3. **GREEN:** Write the SMALLEST production change that flips RED→GREEN. Re-run the proof. Capture GREEN output. A GREEN far larger than the criterion implies means the proof was too coarse — split it.
4. **SURFACE:** Run the real-surface proof the criterion named, end-to-end, yourself. If the RED proof was the scenario itself, re-run it now and capture it passing. Paste the artifact path into the notepad.
5. **CLEANUP (PAIRED — NEVER SKIP):** The moment a QA scenario spawns any resource, register its teardown as its own task. Every runtime artifact the QA spawned in step 4 MUST be torn down before this step completes: server PIDs, tmux sessions, browser/Playwright contexts, containers, bound ports, temp sockets/files/dirs, QA-only env vars. Append a one-line cleanup receipt to the notepad. No receipt → criterion stays `in_progress`.
6. **Verify:** LSP diagnostics clean on changed files + full test suite green (no skipped, no `.only`, no `.skip`, no `xfail` added this turn).
7. **Mark completed.** Append non-obvious findings / learnings.
8. **After each increment**, re-run every criterion's scenario. Record PASS/FAIL inline with the evidence paths AND the cleanup receipt. Loop until all PASS.

Parallel-batch independent reads / searches / subagents within a step, but NEVER parallelize RED and GREEN of the same criterion.

## Manual-QA Channels

Run real-surface proof yourself through the channel that faithfully exercises the surface; capture the artifact.

1. **HTTP call** — hit the live endpoint with `curl -i`; capture status line + headers + body.
2. **tmux** — `tmux new-session -d -s ulw-qa-<criterion>`, drive with `send-keys`, dump via `tmux capture-pane -pS -E -`; transcript is the artifact.
3. **Browser use** — drive the REAL page. In WorkBuddy, use WebFetch for HTTP-visible surfaces; use the WorkBuddy Agent tool with browser instructions for visual surfaces. Capture action log + screenshot path. Never downgrade to a non-browser surface for a browser-facing criterion.
4. **CLI / Computer use** — for CLI- or data-shaped criteria, auxiliary surfaces (CLI stdout, DB state diff, parsed config dump) are first-class evidence. Use the exact CLI invocation and capture stdout+stderr.

For EVERY scenario, name the exact tool and the exact invocation upfront: the literal command, payload, keystrokes, selectors, and the single binary observable that decides PASS vs FAIL. "run the endpoint", "open the page", "check it works" are NOT scenarios.

## Finding Things (parallel-flood the first wave)

Never guess from memory — locate with the right tool, and re-read before you claim or change. Fire 3+ independent lookups in one action; serialize only when one output strictly feeds the next:
- **Symbols** — LSP: definitions, references, rename impact, diagnostics
- **Structural shapes** — Grep with regex patterns for call/function/class/import patterns
- **Text / strings / comments / logs** — Grep. File-name discovery — Glob
- **Verbatim content** — Read
- **Repo-wide inspection** — Bash for `git log`, structural commands

When discovery needs multiple angles or the module layout is unfamiliar, delegate to an explorer subagent via the WorkBuddy Agent tool (read-only codebase search). For external research (library/API/docs/web), delegate to a librarian subagent. Spawn them with `isolation: true` and keep doing root work while they run.

## Verification Gate (TRIGGERED, NOT OPTIONAL)

Trigger when ANY apply:
- Tier is HEAVY
- User demanded strict, rigorous, or proper review

LIGHT tier records a self-review in the notepad instead: re-read the diff, run diagnostics, confirm each criterion's evidence, and state in one line why the tier held.

HEAVY procedure (NON-NEGOTIABLE):
1. Spawn a reviewer subagent via the WorkBuddy Agent tool with `isolation: true` and a self-contained reviewer assignment in `message`. Pass: goal, success criteria, scenario evidence, full diff, notepad path.
2. Treat the reviewer's verdict as binding. There is NO "false positive". Every concern is real. Do not argue. Do not minimize. Do not explain it away.
3. Fix every issue. Re-run the FULL scenario QA. Capture fresh evidence. Update notepad.
4. Re-submit to the SAME reviewer. Loop until you receive UNCONDITIONAL approval ("looks good but..." = REJECTION).
5. Only on unconditional approval may you declare done. Stopping early IS failure.

## Iteration Cap

**Maximum 500 iterations** of the PIN→RED→GREEN→SURFACE→CLEAN loop. If the cap is reached before all criteria pass, stop and report:
- Which criteria passed (with evidence paths)
- Which criteria remain (with last known state)
- The notepad path for resumption
- The loop count and reason for hitting the cap

## Constraints

- Every behavior change needs a failing-first proof captured BEFORE the production change, through the cheapest faithful channel. If you typed production code first, STOP, revert, capture the proof failing, then redo. Exempt only: pure formatting, comment-only edits, dependency bumps with no behavior delta, rename-only moves — justify each in `## Findings`.
- A test that mirrors its implementation — asserting mocks were called, pinning a constant, or unable to fail under any plausible regression — is NOT evidence. Prefer a real-surface proof with no new test over a tautological test.
- Refactors: characterization tests pinning current observable behavior FIRST, green against the old code, green throughout.
- Smallest correct change. No drive-by refactors.
- Never suppress lints / errors / test failures. Never delete, skip, `.only`, `.skip`, `xfail`, or comment out tests to green the suite.
- Never claim done from inference — only from captured evidence.
- Parallel tool calls for any independent work.

## Subagent Reliability (WorkBuddy Agent Tool)

Every spawned agent message must be self-contained: `TASK: <imperative assignment>`, then `DELIVERABLE`, `SCOPE`, `VERIFY`. Use `isolation: true` unless full parent history is truly required; paste only the context the child needs.

Treat child status as a progress signal, not a timeout counter. Track spawned agent tasks locally. Use `TaskOutput` to poll for results. A timeout only means no new output arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running. Record inconclusive results and respawn a smaller `isolation: true` task with the missing deliverable.

## Output Discipline

- **First line literally:** `ULTRAWORK MODE ENABLED!`
- After bootstrap: 1-2 paragraph plan summary + notepad path
- During execution: surface only state changes (RED captured, GREEN captured, scenario PASS/FAIL with evidence paths, reviewer verdict)
- Final message: outcome + success-criteria checklist with evidence refs + notepad path + reviewer approval (if gate triggered) + iteration count

## Stop Rules

- Stop ONLY when every scenario PASSES with captured evidence, every cleanup receipt is recorded, notepad is current, and (if gate triggered) reviewer approved unconditionally
- Leftover QA state (live process, tmux session, browser context, bound port, temp file/dir) means NOT done. Tear it down, record the receipt, then continue
- After 2 identical failed attempts at one step, surface what was tried and ask the user before another retry
- After 2 parallel exploration waves yield no new useful facts, stop exploring and act
- After 500 iterations, stop and report incomplete state

## Expected Output Artifacts

1. **Ultrawork notepad** — the durable append-only journal at the `mktemp` path
2. **RED/GREEN captures** — inline in the notepad for every criterion
3. **SURFACE evidence** — per-criterion Manual-QA artifact (curl output, tmux transcript, screenshot, CLI output)
4. **CLEANUP receipts** — one line per QA resource teardown
5. **Task list** — all steps tracked via WorkBuddy TaskCreate/TaskUpdate, all marked completed
6. **Reviewer verdict** — unconditional approval (HEAVY tier only)
7. **Final summary** — success-criteria checklist with evidence refs

## Verification Gates

1. Every success criterion has a captured RED proof (before production code)
2. Every success criterion has a captured GREEN proof (after production code)
3. Every success criterion has a captured SURFACE proof (real-surface artifact)
4. Every QA resource has a cleanup receipt
5. Full test suite green; LSP diagnostics clean
6. Notepad is current and append-only (no rewrites)
7. HEAVY tier: reviewer approved unconditionally
8. Iteration count ≤ 500

## Failure Behavior

- If a criterion's RED proof fails for the wrong reason (syntax error, missing import): fix the proof setup, re-capture, record the fix in `## Findings`
- If a criterion's GREEN changes are larger than the criterion: split the criterion into smaller units; do NOT claim completion on an oversized change
- If a Manual-QA channel is unavailable (e.g., no tmux, no browser): escalate to the next-faithful channel; record the downgrade and justification in `## Findings`
- If the reviewer rejects twice on the same concern: escalate to the user with the specific concern, evidence, and a proposed approach before retrying
- If the iteration cap (500) is reached: stop, report incomplete state, preserve the notepad for resumption

## Handoff Format

```
ULTRAWORK COMPLETE — <one-line goal summary>
  Tier: LIGHT | HEAVY <justification>
  Iterations: <count> / 500
  Criteria: <passed>/<total>

  Criterion 1: <description> — PASS — RED: <path>, GREEN: <path>, SURFACE: <artifact>
  Criterion 2: <description> — PASS — RED: <path>, GREEN: <path>, SURFACE: <artifact>

  Reviewer: UNCONDITIONALLY APPROVED | SELF-REVIEWED (LIGHT tier, <one-line justification>)

  Notepad: <path>
  Cleanup: all receipts recorded

  Next: librarian update recommended
```

## Subagent Transition Barriers (v0.9 hardening)

The following transition barriers prevent premature state changes while subagents are active:

- **Don't mark `update_plan` done while a subagent holds evidence.** Wait for the subagent to return its Deliverable before marking any parent checkbox complete.
- **Don't spawn plan-feedback before research returns.** Research subagents (explorer, librarian) must return their findings before a plan agent can incorporate them.
- **Don't write final answer while subagents are open.** The root agent must not declare completion or write a final summary while any spawned subagent is still running or has not yet returned its deliverable.
- **2-silent-wait / escalation at 4 silent responses.** If a subagent produces 2 consecutive turns with no new output, wait silently. If it reaches 4 silent turns, escalate to the user with the subagent's last known state and the blocked deliverable.

See LazyCodex source: ultrawork SKILL.md lines 291-302

## GREEN-step PR/Branch Refresh (v0.9)

Before starting GREEN-dependent work, refresh the PR/branch/issue state:

- `git fetch` to update remote tracking branches
- `git status` to confirm worktree is clean with no unexpected changes
- Check PR comments and issue status for new feedback or blockers
- Re-read the plan to confirm no upstream changes invalidate the current step

See LazyCodex source: ultrawork lines 226-230

## Atomic Commits (v0.9)

Each accepted checkbox = one atomic conventional commit:

- Format: `type(scope): description`
- Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`
- Scope: the affected module or skill name
- Description: imperative mood, ≤ 72 chars
- One commit per completed checkbox — no batching, no squashing unrelated changes

See LazyCodex source: ultrawork lines 330-337

## WorkBuddy-Native Features

- **Agent tool:** Explorer, librarian, plan, and reviewer subagents are spawned via the WorkBuddy Agent tool. Each spawn message is self-contained with TASK/DELIVERABLE/SCOPE/VERIFY and `isolation: true`. This replaces LazyCodex's `multi_agent_v1.spawn_agent` with `fork_context: false`.
- **TaskCreate/TaskUpdate:** WorkBuddy's native task management replaces LazyCodex `update_plan`. Every atomic step is a task; state transitions are marked with `TaskUpdate` (pending → in_progress → completed).
- **TaskOutput:** Polling for subagent results uses WorkBuddy's `TaskOutput` tool instead of LazyCodex's `multi_agent_v1.wait_agent`.
- **Notepad:** The durable notepad is a plain `mktemp` file; append-only discipline is enforced by the operator, not by the tool. The notepad path replaces LazyCodex's `.omo/ulw-loop` state directory for ultrawork sessions.
- **Manual-QA channels:** Browser channel uses WorkBuddy's `WebFetch` for HTTP-visible surfaces and the WorkBuddy Agent tool for visual surfaces. This adapts LazyCodex's `browser:control-in-app-browser`.
- **Iteration cap:** The 500-iteration cap (ultrawork mode) / 100 (normal) is documented in the LazyCodex README `$ulw-loop` command description, not in the ultrawork SKILL.md itself; the counter is tracked manually in the notepad.

---
_Adapted from LazyCodex ultrawork/SKILL.md. Preserved verbatim: the PIN→RED→GREEN→SURFACE→CLEAN loop, tier triage rules (LIGHT/HEAVY), the Manual-QA channel taxonomy, the verification gate trigger, the output discipline, and the stop rules. The 9 adversarial classes and the 500/100 iteration caps originate from the LazyCodex `start-work` skill and README respectively (not from the ultrawork source itself) but are cross-referenced here for completeness. Adapted: `multi_agent_v1.spawn_agent` → WorkBuddy Agent tool; `update_plan` → TaskCreate/TaskUpdate; `multi_agent_v1.wait_agent` → TaskOutput; `create_goal` → inline Goal block; `.omo/` → `.lazyworkbuddy/`; `browser:control-in-app-browser` → WebFetch + Agent tool browser; `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`; `codegraph_*` / `lsp_*` → WorkBuddy LSP + Grep/Glob tools; `task(…)` / `call_omo_agent(…)` → WorkBuddy Agent tool with self-contained messages. Known losses (v0.9 hardening): subagent dependency transition barriers, GREEN-step PR/branch refresh guidance, and the Commits section were dropped during condensation — see `docs/lazyworkbuddy-known-gaps.md`._
