# LazyBuddy v1.3.1 release candidate

**Status:** Unpublished. v1.3.0 remains the latest stable release. This candidate has passed repository tests and PR CI; CodeBuddy and WorkBuddy activation in a fresh host session still needs live testing.

## What changed

- **Safer execution:** Workflow intent ignores quoted or historical command mentions while retaining explicit requests to start work. Isolation reports namespace allocation accurately; it does not claim to have created a Git worktree. Cleanup preserves populated allocations, linked files, and caller-owned changes.
- **Better evidence:** Outcome comparisons hash the supplied task, budget, and permission snapshots and reject mismatched cohorts. Reports distinguish absent, partial, and validated evidence, count explicit host-billed costs from failed runs, and reject fixture telemetry as execution data. Hashes verify supplied bytes, not the truth of their contents.
- **Predictable delegation:** Subagents keep the current model by default. A plan can propose a task-specific `lite`, `default`, or `reasoning` tier, but switching requires an explicit plan decision and `--allow-switch`. The selector is advisory and does not change host settings.
- **Lean tooling:** Dependency search handles extension-bearing imports, uses fewer search processes, and retains a fallback when ripgrep is unavailable. Verification avoids repeating the full suite for a Python-version preflight. These are local process improvements; no end-to-end speed or cost gain has been measured.
- **Current guidance:** README, contributor, lifecycle, and verification documentation reflect the candidate. Obsolete attribution and initial-port files were removed; credits and licenses remain in NOTICE and LICENSE.

## Verification and remaining test

The candidate passed repository tests, package checks, and all nine checks on [PR #37](https://github.com/elvinzhao10/LazyBuddy/pull/37). Those checks do not establish that a release archive loads in a host. Fresh-session CodeBuddy CLI, CodeBuddy IDE, and WorkBuddy installation, activation, MCP, specialist, cancellation, and completed-task behavior remain unobserved. No measured productivity or native-cost improvement is claimed.

## Upgrade and rollback

Keep v1.3.0 as the stable version until the exact v1.3.1 archive and host routes are verified. Before upgrading, record the installed version and lifecycle ownership, then validate the exact candidate archive. To roll back, stop the host session and use the lifecycle offboard/rollback route for the previous release. Remove only unmodified receipt-owned assets; preserve modified, unknown, linked, caller-owned, and host-managed files. Start a fresh session to verify the restored installation.
