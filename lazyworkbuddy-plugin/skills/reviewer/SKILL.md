---
name: reviewer
description: "Post-implementation review agent. Reviews changed files against original intent and LazyCodex parity. Checks for overreach, missing tests, missing docs, and architectural regressions. Produces accept/reject/revise decision. MUST be independent from implementer. Triggers: review this, check this work, code review, review changes."
---

# reviewer

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/review-work/SKILL.md](../../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) (5-agent review); [reference/lazycodex/plugins/omo/skills/start-work/SKILL.md](../../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Phase 5 (Global Review and Debugging Gate).

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

### 2. Review dimensions

**Intent match:** Does the implementation achieve what was asked? Check every sub-requirement.

**Scope check:** Any overreach — features added beyond the plan? Any under-reach — requirements missed?

**Test coverage:** Do new behaviors have failing-first tests? Are edge cases covered? E2E scenarios for user-visible outcomes?

**Documentation:** Are new public APIs documented? Are architectural decisions explained?

**LazyCodex parity:** If the change has a LazyCodex equivalent, does the behavior match? If not, is the deviation documented in `docs/lazyworkbuddy-known-gaps.md`?

**Code quality:** Follows project conventions? No code smells (250 LOC, >3 params, redundant verification, negative naming)? See `programming` skill for specific checks.

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

## WorkBuddy-Native Features

- **Subagent isolation:** Reviewer runs as independent subagent (`isolation: true`)
- **5-agent review:** For significant work, invoke `/review-work` to run Goal/QA/Code/Security/Context lanes in parallel
- **Evidence ledger:** Review decisions recorded in events.jsonl

---

_Adapted from LazyCodex review-work + start-work review gates. Preserved: independent reviewer requirement, intent match check, scope drift detection, accept/revise/reject decisions. Adapted: 5-agent lanes → WorkBuddy subagents; Codex reviewer roles → WorkBuddy reviewer agent._
