# LazyBuddy v1.3.1 — release candidate (unpublished)

The latest published stable release is v1.3.0. This v1.3.1 worktree is a release candidate only: it has not been tagged or published, and it makes no host-installation or activation claim. Main-branch CI and package checks are not evidence about a release archive.

## Eval-driven fixes

- Cohort comparison now reads and hashes referenced task, budget and permission snapshots. Outcome integrity distinguishes absent, partial and validated evidence; explicitly marked fixture-validation telemetry is rejected as execution input.
- Intent routing ignores quoted, fenced and historical workflow mentions while preserving explicit current execution requests.
- Reverse-dependency search handles ordinary extension-bearing imports and preserves the no-ripgrep fallback. Blast-radius lookup uses one search process instead of four; repository overview scans imports once. These are local process-count improvements, not measured coding-task speedups; results remain heuristic.
- Verification avoids rerunning the full verifier merely to check Python-version admission, and gives the package-boundary regression a sufficient dedicated deadline.
- Baseline telemetry explicitly records `measurement_scope: fixture-validation`; its timing is not coding-task duration.

- Execution isolation records truthful namespace allocation only. It reports created=false, verified=false, and worktree_provisioned=false; it does not create or verify a Git worktree. Cleanup refuses non-empty allocations, symlinks, and an untracked dirty caller workspace. External/native worktree readiness remains a separate, unobserved check.
- Outcome evaluation reports explicit host-billed cost only. It does not infer dollar costs from token rates, preserves usage records when a run fails, includes failed-run costs in the condition numerator, and rejects cohorts with mismatched host build, model, task snapshot, budget, or permissions. Artifact hashes establish integrity, not independent truth.
- Subagents inherit the current model by default. Plans can propose `lite`/`default`/`reasoning` routing for specific tasks; switching requires an explicit plan decision and `--allow-switch`. The selector records a recommendation without changing host settings or claiming native execution.

## Documentation cleanup

Removed obsolete implementation-session notes and initial port instructions. Current contributor guidance is in AGENTS.md and CONTRIBUTING.md; project credits and licenses remain in NOTICE and LICENSE.

## Measured efficiency

No observed end-to-end productivity gain, coding-task speedup, token-price estimate, or native cost reduction is claimed for this candidate. Cost comparisons follow the [outcome evaluation protocol](lazybuddy-plugin/contracts/OUTCOME-EVALUATION.md) and are limited to explicit host-billed records and matching cohorts.

## Host capability matrix

The package routes below describe available package declarations. The rows remain pending until a fresh host session supplies current host build/edition, selected route, session identity, activation, MCP call, specialist action, cancellation, completion, and actual artifact evidence.

| Host | Package route | Current host evidence |
| --- | --- | --- |
| CodeBuddy CLI | Release-root marketplace | Local CLI inventory reported CodeBuddy CLI 2.124.0. A codebuddy plugin validate attempt produced no output before interruption and is inconclusive. No activation, live MCP call, specialist, cancellation, or completed host task is observed. |
| CodeBuddy IDE | CLI-backed marketplace when available; recovery route is separate | Pending: current build/edition/route/session, activation, MCP calls, specialist, cancellation, completion artifact. |
| WorkBuddy | Full-plugin marketplace | Pending: current build/edition/route/session, activation, MCP calls, specialist, cancellation, completion artifact. |

## Migration and upgrade

Keep the published v1.3.0 release as the stable reference. For candidate evaluation, use normal durable lifecycle inventory and package verification; preserve modified, unknown, linked, and caller-owned files. Verify the exact archive or candidate commit independently before host testing. Do not infer archive contents from main-branch CI. No host mutation is included in this preparation.

## Known risks

- Namespace allocation is not Git worktree provisioning and does not establish the state of an external/native worktree.
- Host integration remains pending without current-session observation. CI and host-parser validation do not prove asset discovery, a loaded Skill/command, specialist execution, MCP connectivity, cancellation behavior, or task completion.
- Evaluation hashes only bind supplied evidence bytes; they do not establish that evidence is independently true.

## Rollback

Stop the host session, then use the durable lifecycle rollback/offboard path to return to the exact prior release after reviewing receipt ownership. Remove only unmodified receipt-owned assets; preserve modified, unknown, linked, caller-owned, and host-managed state. Start a fresh session before recording any restored host behavior.
