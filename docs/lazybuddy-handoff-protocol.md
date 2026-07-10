# LazyBuddy Handoff Protocol

> v0.5 — Inter-agent communication format, evidence format, verdict format, and escalation rules.

## Agent → Orchestrator: DoneClaim

When an implementer completes work, it returns a structured DoneClaim:

```
DoneClaim:
  task: <task id/title>
  changed_files: [absolute paths]
  tests: ["exact command + result"]
  manual_qa: [artifact paths]
  adversarial_classes:
    malformed_input: { probed: true, result: "PASS" }
    stale_state: { probed: false, reason: "no cached artifacts" }
    ...
  cleanup: [receipt paths]
  risks: [known risks or "none"]
  EVIDENCE_RECORDED: <path to evidence>
```

## Orchestrator → Verifier: VerifyRequest

The orchestrator sends the DoneClaim to the verifier:

```
VERIFY:
  task: <task id>
  DoneClaim: { ... }
  plan_reference: .lazybuddy/plans/<slug>.md
  accept_criteria: <from plan>
```

## Verifier → Orchestrator: AdversarialVerify

The verifier returns its verdict:

```
AdversarialVerify:
  task: <task id>
  verdict: confirmed | false-positive | needs-fix | needs-human-review
  evidence: ["command + result", "artifact path"]
  repro: "exact repro command"
  confidence: 0.95
  adversarial_classes:
    malformed_input: { probed: true, result: "PASS - returns 400 with validation errors" }
    ... (all 9 classes)
```

## Orchestrator → Reviewer: ReviewRequest

After verification, the orchestrator sends to reviewer:

```
REVIEW:
  task: <task id>
  goal: <original intent>
  constraints: [list]
  changed_files: [paths]
  diff: <git diff>
  verifier_verdict: { AdversarialVerify }
  plan_reference: .lazybuddy/plans/<slug>.md
```

## Reviewer → Orchestrator: ReviewVerdict

```
REVIEW VERDICT:
  task: <task id>
  decision: accept | revise | reject
  intent_match: true | false (with details)
  scope: no overreach | overreach found: [list]
  tests: sufficient | insufficient: [gaps]
  docs: updated | missing: [list]
  parity: matched | deviation_documented | unverified
  blocking_issues: [list or "none"]
```

## Gate Reviewer → Orchestrator: GateVerdict

Final gate after all review lanes pass:

```
GATE VERDICT:
  recommendation: APPROVE | REJECT
  blockers: [list or "none"]
  originalIntent: <what user wanted>
  desiredOutcome: <expected result>
  userOutcomeReview: <does the artifact satisfy it?>
  checked_artifact_paths: [list]
  evidence_gaps: [list or "none"]
```

## Librarian Update

After gate APPROVE, the orchestrator hands off to librarian:

```
LIBRARIAN UPDATE:
  event: work_accepted
  task: <task id>
  changed_files: [paths]
  parity_impact: none | method_X_status_changed | new_deviation_found
  memory_updates: [which files to update]
```

## Orchestrator → Implementer (re-dispatch on failure)

```
RE-DISPATCH:
  task: <task id>
  failure: <exact verifier/reviewer feedback>
  scope: <same scope as before, narrowed if possible>
  deadline: <max turns for this attempt>
```

## Escalation Rules

| Situation | Action |
|-----------|--------|
| Verifier returns `needs-fix` | Re-dispatch implementer with exact feedback; max 3 retries per task |
| Verifier returns `needs-human-review` | Pause; present to user with evidence summary |
| Verifier returns `false-positive` | Mark task as failed; record in ledger; escalate to user |
| Reviewer returns `revise` | Re-dispatch implementer; specific changes listed in verdict |
| Reviewer returns `reject` | Escalate to user; document fundamental issue |
| Subagent timeout (no WORKING: signal) | Poll with TaskOutput; after 3 polls → mark INCONCLUSIVE |
| Subagent explicitly BLOCKED | Record block reason; try to unblock or escalate |
| Iteration cap reached | Pause; ask user whether to continue |
| State corruption detected | Restore from latest checkpoint; re-dispatch from last completed checkbox |

## Communication Rules

1. **Isolation:** All subagents run with `isolation: true` — no parent history. Every message is self-contained.
2. **Self-contained messages:** Each dispatch includes all needed context (TASK, DELIVERABLE, SCOPE, VERIFY).
3. **WORKING: signals:** Long-running subagents must send periodic `WORKING: <phase>` status messages.
4. **BLOCKED: signals:** Only when genuinely blocked; includes exact reason.
5. **No implicit context:** Assume the subagent knows nothing about the conversation. Paste everything it needs.

---

_See `docs/lazybuddy-agent-orchestration.md` for the full flow diagram and `docs/lazybuddy-parallelism-policy.md` for concurrency rules._
