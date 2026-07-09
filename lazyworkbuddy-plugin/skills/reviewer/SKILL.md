---
name: reviewer
description: "Post-implementation review agent. Reviews changed files against original intent and LazyCodex parity. Checks for overreach, missing tests, missing docs, and architectural regressions. Produces accept/reject/revise decision. MUST be independent from implementer. Triggers: review this, check this work, code review, review changes."
---

# reviewer

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/review-work/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) (5-agent review); [reference/lazycodex/plugins/omo/skills/start-work/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phase 5 (Global Review and Debugging Gate).

## Purpose

Review completed implementation work against the original intent and LazyCodex parity requirements. Check for scope overreach, missing test coverage, missing documentation, and architectural regressions. Issue an accept/reject/revise decision. For significant work, invoke the full 5-agent `/review-work` parallel review.

## Trigger Conditions

- Implementation is complete and verifier has confirmed
- User says "review this", "code review", "check my work"
- `start-work` Phase 5 Global Review Gate
- Before merging or handing off work

## Required Context

- The original goal/plan and acceptance criteria
- The git diff of changes
- The full contents of changed files
- The verifier's evidence report
- The project's conventions from `workbuddy.md`

## Tool Access

This skill is **read-only** — it reviews but never modifies.
- Allowed: Read, Grep, Glob, Git (diff, log, blame)
- Disallowed: Write, Edit

## Step-by-Step Procedure

### 1. Gather review context

- Read the original goal and constraints from the plan
- Collect changed files: `git diff --name-only`
- Read the full diff and file contents
- Read the verifier's evidence report

### 2. Review dimensions (v0.9)

The reviewer evaluates every change across 7 mandatory dimensions. Each dimension produces a PASS/FAIL/WATCH grade and contributes to the final accept/revise/reject decision.

| # | Dimension | What it checks | FAIL condition |
|---|-----------|---------------|----------------|
| 1 | **Intent match** | Does the implementation achieve every sub-requirement from the plan? | Any acceptance criterion is unmet |
| 2 | **Scope (overreach detection)** | Are there changes beyond what the plan specified? (Overreach) Are any plan requirements missing? (Under-reach) | Unauthorized file changes outside the plan scope |
| 3 | **Test coverage** | Do new behaviors have failing-first tests? Are edge cases covered? E2E scenarios for user-visible outcomes? | New behavior has zero tests or tests are tautological |
| 4 | **Documentation** | Are new public APIs documented? Are architectural decisions explained? Are parity deviations recorded in `known-gaps.md`? | Public API added without doc; parity deviation unrecorded |
| 5 | **Regression check** | Do existing tests still pass? Does the diff touch code paths shared by other features? | Existing test suite fails on the changed branch |
| 6 | **LazyCodex semantic preservation** | If the change has a LazyCodex equivalent, does the behavior match the reference? If not, is the deviation justified and documented? | Undocumented behavioral divergence from LazyCodex reference |
| 7 | **WorkBuddy adaptation justification** | If a LazyCodex concept was adapted (not preserved verbatim), is the adaptation rationale documented in the parity ledger? | Adaptation present but no parity-ledger entry explaining why |

### 3. Accept/reject/revise decision tree (v0.9)

```
                    ┌─────────────────────┐
                    │ All 7 dimensions     │
                    │ reviewed?           │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │ Any FAIL in          │
                    │ dimensions 1-5?     │
                    └─────────┬───────────┘
                    ┌─────YES─┴─NO──────┐
                    ▼                   ▼
            ┌─────────────┐    ┌─────────────────┐
            │ Is the FAIL   │    │ Any FAIL in      │
            │ fixable in    │    │ dimensions 6-7?  │
            │ ≤1 round?    │    │ (parity/adaptation)│
            └──────┬───────┘    └────────┬──────────┘
            ┌─YES──┴─NO──┐          ┌─YES─┴─NO──┐
            ▼            ▼           ▼           ▼
        ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
        │ revise │  │ reject │  │ revise │  │ accept │
        │        │  │        │  │(doc-only)│        │
        └────────┘  └────────┘  └────────┘  └────────┘
```

- **accept**: All 7 dimensions PASS or have only documented, justified WATCH items. No blocking issues.
- **revise**: One or more dimensions FAIL but the issues are concrete, specific, and fixable in one round by the implementer. Reviewer provides exact file:line references and suggested fixes.
- **reject**: Fundamental issue — wrong approach, security flaw, irrecoverable parity break, or the implementer has exhausted retry budget (≥3 consecutive revisions for the same task without resolution).

### Output

All review artifacts are written to `.lazyworkbuddy/runs/<run_id>/review/`:

| File | Content |
|------|---------|
| `dimensions.json` | Per-dimension grades: `{dimension, grade, findings[], file_refs[]}` |
| `verdict.json` | Final decision: `{verdict, blocked_by[], retry_count, reviewer_agent_id}` |
| `findings.md` | Human-readable summary with file:line references and suggested fixes |
| `cross-lane-consistency.json` | If 5-agent review was invoked, cross-lane consistency check results |

### 3. Issue decision

| Decision | Meaning | When |
|----------|---------|------|
| `accept` | Work is good; proceed to memory update | All review dimensions pass; no blocking issues |
| `revise` | Work needs specific changes | Concrete issues found with clear fix path |
| `reject` | Work cannot be accepted as-is | Fundamental issues (wrong approach, security flaw, parity broken) |

## Expected Output Artifacts

```markdown
Review verdict: accept | revise | reject
  Intent match: PASS / FAIL (N requirements checked)
  Scope: no overreach | overreach found (list)
  Tests: N tests, M edge cases covered
  Docs: updated | missing (list)
  Parity: matched | deviation documented | unverified
  Code quality: N issues (list by severity)
  Blocking issues: [list or none]
```

## Verification Gates

1. Every changed file is reviewed
2. Intent match is confirmed against plan
3. Scope drift is flagged
4. Test coverage adequacy is assessed
5. Parity status is updated if changed

## Failure Behavior

- `revise`: List specific changes needed; return to implementer
- `reject`: Document why; escalate to user for decision
- If reviewer is not independent (root also implemented): escalate to gate-reviewer

## Handoff Format

Register the review decision in `.lazyworkbuddy/runs/<run_id>/events.jsonl`. If `accept`, hand off to librarian for memory update. If `revise`, hand back to implementer with feedback.

## State Ledger Integration (v0.7)

The reviewer now writes review decisions through the state/ script layer for durable, queryable audit trails.

- **Review decision recording:** After completing all review dimensions (intent match, scope check, test coverage, documentation, LazyCodex parity, code quality), the reviewer calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/append-event.sh <run_id> review_verdict "<json>"` to write the full review decision — including `verdict` (accept/revise/reject), each dimension's pass/fail status, blocking issues, and code quality findings — as a structured event in `events.jsonl`.
- **State synchronization:** After the event is written, the reviewer calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/update-task.sh <run_id> <task_index> review --field verdict=<verdict> --field dimensions=<passed_count>/<total>` to update `review_status` in `state.json`. If the verdict is `accept`, the `review_gate` field on the task is marked `passed`; otherwise, it's marked `blocked` with the specific reasons.
- **Review independence:** Like the verifier, the reviewer runs as an isolated Agent (`isolation: true`) to ensure the review is independent from both the executor and the verifier.

## WorkBuddy-Native Features

- **Subagent isolation:** Reviewer runs as independent subagent (`isolation: true`)
- **5-agent review:** For significant work, invoke `/review-work` to run Goal/QA/Code/Security/Context lanes in parallel
- **Evidence ledger:** Review decisions recorded in events.jsonl

---

_Adapted from LazyCodex review-work + start-work review gates. Preserved: independent reviewer requirement, intent match check, scope drift detection, accept/revise/reject decisions. Adapted: 5-agent lanes → WorkBuddy subagents; Codex reviewer roles → WorkBuddy reviewer agent._
