# LazyBuddy v1.3.2 — durable verification handoff

**Status:** Draft release candidate. Local source and publication checks passed, and PR #38 checks passed. Fresh CodeBuddy and WorkBuddy activation remains pending.

## Eval-driven fixes

- The verifier contract writes a run-scoped, revision-bound report as checks finish; the orchestrator contract blocks a verdict when that report is missing, incomplete, or stale. Generic completion APIs do not yet enforce this report format.
- The orchestrator contract requires focused checks between stages, one full matrix at closure, a compact run digest, and completion events instead of active polling. It forbids duplicate dispatch while owned paths or evidence are changing.
- Where the host supplies agent identity, the PreToolUse hook denies an orchestrator Write/Edit outside its own state directory. Host payloads without identity still require the agent contract to enforce this boundary.

## Measured efficiency

The B3 postmortem identifies repeated whole-suite verification and polling as major token sinks. v1.3.2 has no measured token, latency, or cost reduction yet.

## Host capability matrix

| Host | Package route | Current session |
| --- | --- | --- |
| CodeBuddy CLI, CodeBuddy IDE, WorkBuddy | Existing documented routes | Pending live observation |

## Migration and upgrade

Upgrade from v1.3.1 using the documented lifecycle after inventorying managed and modified assets. Preserve caller files and existing run evidence. The report contract applies to new verification attempts; old conversational verdicts do not become durable evidence.

## Known risks

The role-aware hook depends on host-provided agent identity and does not classify arbitrary Bash writes. Quota termination can still leave an in-progress report; it must remain blocked until independently resumed or rerun.

## Rollback

Use the lifecycle rollback to the prior verified release. Keep v1.3.2 run evidence for diagnosis and do not mark in-progress reports complete.

## Prior release notes (v1.3.1)

# LazyBuddy v1.3.1

**Status:** Stable release. Local repository checks passed. CodeBuddy and WorkBuddy activation in a fresh host session still needs live testing.

## Eval-driven fixes

- **Safer execution:** Workflow intent ignores quoted or historical command mentions while retaining explicit requests to start work. Isolation reports namespace allocation accurately; it does not claim to have created a Git worktree. Cleanup preserves populated allocations, linked files, and caller-owned changes.
- **Better evidence:** Outcome comparisons hash the supplied task, budget, and permission snapshots and reject mismatched cohorts. Reports distinguish absent, partial, and validated evidence, count explicit host-billed costs from failed runs, and reject fixture telemetry as execution data. Hashes verify supplied bytes, not the truth of their contents.
- **Predictable delegation:** Subagents keep the current model by default. A plan can propose a task-specific `lite`, `default`, or `reasoning` tier, but switching requires an explicit plan decision and `--allow-switch`. The selector is advisory and does not change host settings.
- **Lean tooling:** Dependency search handles extension-bearing imports, uses fewer search processes, and retains a fallback when ripgrep is unavailable. Verification avoids repeating the full suite for a Python-version preflight. These are local process improvements; no end-to-end speed or cost gain has been measured.
- **Current guidance:** README, contributor, lifecycle, and verification documentation reflect v1.3.1. Obsolete attribution and initial-port files were removed; credits and licenses remain in NOTICE and LICENSE.

## Measured efficiency

No measured productivity or native-cost improvement is claimed. Local repository and package checks passed.

## Host capability matrix

| Host | Release route | Live status |
| --- | --- | --- |
| CodeBuddy CLI | Release-root marketplace | Pending fresh-session test |
| CodeBuddy IDE | CLI-backed marketplace when available | Pending fresh-session test |
| WorkBuddy | Full-plugin marketplace | Pending fresh-session test |

## Migration and upgrade

Before upgrading from v1.3.0, record the installed version and lifecycle ownership, then validate the exact v1.3.1 release archive. Host readiness remains pending until the selected route is observed in a fresh session.

## Known risks

Repository and CI checks do not establish that a release archive loads in a host. Installation, activation, MCP, specialist, cancellation, and completed-task behavior remain unobserved in fresh CodeBuddy and WorkBuddy sessions. Evidence hashes bind supplied bytes but do not establish their independent truth.

## Rollback

Stop the host session and use the lifecycle offboard/rollback route for the previous release. Remove only unmodified receipt-owned assets; preserve modified, unknown, linked, caller-owned, and host-managed files. Start a fresh session to verify the restored installation.
