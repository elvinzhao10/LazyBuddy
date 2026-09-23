# LazyBuddy v1.3.1 release candidate

**Status:** Unpublished. The previous stable release is v1.3.0. Local repository checks passed; see [PR #37](https://github.com/elvinzhao10/LazyBuddy/pull/37) for current CI status. CodeBuddy and WorkBuddy activation in a fresh host session still needs live testing.

## Eval-driven fixes

- **Safer execution:** Workflow intent ignores quoted or historical command mentions while retaining explicit requests to start work. Isolation reports namespace allocation accurately; it does not claim to have created a Git worktree. Cleanup preserves populated allocations, linked files, and caller-owned changes.
- **Better evidence:** Outcome comparisons hash the supplied task, budget, and permission snapshots and reject mismatched cohorts. Reports distinguish absent, partial, and validated evidence, count explicit host-billed costs from failed runs, and reject fixture telemetry as execution data. Hashes verify supplied bytes, not the truth of their contents.
- **Predictable delegation:** Subagents keep the current model by default. A plan can propose a task-specific `lite`, `default`, or `reasoning` tier, but switching requires an explicit plan decision and `--allow-switch`. The selector is advisory and does not change host settings.
- **Lean tooling:** Dependency search handles extension-bearing imports, uses fewer search processes, and retains a fallback when ripgrep is unavailable. Verification avoids repeating the full suite for a Python-version preflight. These are local process improvements; no end-to-end speed or cost gain has been measured.
- **Current guidance:** README, contributor, lifecycle, and verification documentation reflect the candidate. Obsolete attribution and initial-port files were removed; credits and licenses remain in NOTICE and LICENSE.

## Measured efficiency

No measured productivity or native-cost improvement is claimed. Local repository and package checks passed; [PR #37](https://github.com/elvinzhao10/LazyBuddy/pull/37) records the current CI results.

## Host capability matrix

| Host | Candidate route | Live status |
| --- | --- | --- |
| CodeBuddy CLI | Release-root marketplace | Pending fresh-session test |
| CodeBuddy IDE | CLI-backed marketplace when available | Pending fresh-session test |
| WorkBuddy | Full-plugin marketplace | Pending fresh-session test |

## Migration and upgrade

Keep the previous v1.3.0 release as the stable version until the exact v1.3.1 archive and host routes are verified. Before upgrading, record the installed version and lifecycle ownership, then validate the exact candidate archive.

## Known risks

Repository and CI checks do not establish that a release archive loads in a host. Installation, activation, MCP, specialist, cancellation, and completed-task behavior remain unobserved in fresh CodeBuddy and WorkBuddy sessions. Evidence hashes bind supplied bytes but do not establish their independent truth.

## Rollback

Stop the host session and use the lifecycle offboard/rollback route for the previous release. Remove only unmodified receipt-owned assets; preserve modified, unknown, linked, caller-owned, and host-managed files. Start a fresh session to verify the restored installation.
