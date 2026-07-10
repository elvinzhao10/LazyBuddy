# LazyBuddy Quality Gates

> 12 quality gates spanning the full workflow: plan → implement → verify → review → complete.
> A task is not done until every applicable gate passes.

## Quality Gates Table

| # | Gate Name | What It Checks | How to Run | Pass Criteria |
|---|-----------|---------------|------------|---------------|
| 1 | **Plan Reread** | Checkbox matches plan criteria; no scope creep | Read plan section + current checkbox; diff scope vs actual changes | Changed files match plan scope; all acceptance criteria addressed |
| 2 | **Failing-First Proof (RED)** | Failing test captured BEFORE implementation | Run the criterion's test before any production code change | Test fails for the RIGHT reason (not syntax error, not missing import) |
| 3 | **Implementation (GREEN)** | Minimum change flips RED to GREEN | Run the criterion's test after implementation | Test passes; change is minimal (no drive-by refactors) |
| 4 | **Real-Surface Proof (SURFACE)** | User-visible behavior works end-to-end | Run the criterion's Manual-QA scenario through a real surface (HTTP/tmux/browser/CLI) | Binary PASS/FAIL observable captured; evidence artifact saved |
| 5 | **Cleanup Receipt** | All QA resources torn down | Verify: no leftover processes, tmux sessions, browser contexts, containers, ports, temp files | Cleanup receipt recorded; all QA resources confirmed gone |
| 6 | **Automated Verification** | Test suite, typecheck, lint, build all pass | Run: `test`, `typecheck`, `lint`, `build` commands | All exit 0; no skipped/`.only`/`.skip` tests; no new lint warnings |
| 7 | **Adversarial QA** | 9 adversarial classes probed for every task | Run per-category probes (see verifier protocol); record result per class | All applicable classes probed; non-applicable classes have one-line justification |
| 8 | **DoneClaim + AdversarialVerify** | Sisyphus completion contract: executor claims → verifier confirms | Executor submits DoneClaim → independent verifier runs AdversarialVerify | Verdict: `confirmed` (confidence >= 0.8); evidence reproducible |
| 9 | **5-Agent Review** | Full review: Verifier, Reviewer, Security Auditor, Librarian, Context Miner | Spawn all 5 review agents with `isolation: true`; collect verdicts | All lanes return PASS; no REJECT or REVISE verdicts |
| 10 | **Debugging Runtime Audit** | 3+ failure hypotheses checked before completion | Name hypotheses → run distinguishing checks → append to events.jsonl | All hypotheses resolved; no unverified failure modes |
| 11 | **Final Quality Gate** | Full re-verification + gate-reviewer approval | Re-run all criteria scenarios → full test suite → independent gate-reviewer | Gate-reviewer: UNCONDITIONALLY APPROVED; all criteria PASS |
| 12 | **Atomic Commit** | One conventional commit per accepted checkbox | `git commit -m "type(scope): description"` per checkbox | Format: `type(scope): description`; one commit per completed checkbox |

## Gate Applicability by Tier

| Gate | LIGHT | HEAVY |
|------|-------|-------|
| 1. Plan Reread | Required | Required |
| 2. RED Proof | Required | Required |
| 3. GREEN Implementation | Required | Required |
| 4. SURFACE Proof | Required | Required |
| 5. Cleanup Receipt | Required | Required |
| 6. Automated Verification | Required | Required |
| 7. Adversarial QA | Required (9 classes) | Required (9 classes) |
| 8. DoneClaim + AdversarialVerify | Required | Required |
| 9. 5-Agent Review | Optional (self-review) | Required |
| 10. Debugging Runtime Audit | Required | Required |
| 11. Final Quality Gate | Required | Required |
| 12. Atomic Commit | Required | Required |

## Gate Failure Actions

| Gate Failed | Action |
|-------------|--------|
| 1-6 (pre-verification gates) | Fix and re-run; do not proceed to next gate |
| 7 (Adversarial QA) | Record failure probe; re-dispatch implementer with specific feedback |
| 8 (DoneClaim rejected) | Verifier's blocker list → implementer re-dispatch |
| 9 (Review rejected) | Fix every issue → re-run full QA → re-submit to same reviewer |
| 10 (Runtime audit flags issue) | Investigate and resolve; re-run audit |
| 11 (Final gate rejected) | Fix → re-run criteria → re-submit to gate-reviewer |
| 12 (Commit issue) | Amend or re-commit; verify conventional format |
