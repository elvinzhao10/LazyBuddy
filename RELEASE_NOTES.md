# LazyBuddy v1.3.4 — safer runs, clearer host boundaries

A small maintenance release for the LazySeries family. It repairs runtime and
host-adapter boundaries while retaining the workflow foundation inherited from
family versions v1.3.0–v1.3.3. Those inherited features are not new in this patch
and do not imply prior public releases of the Kimi or DeepSeek ports.

## Eval-driven fixes

- Task claims and iteration updates share one transaction; blocked or exhausted queues cannot report completion.
- Repeated run creation preserves history, and stale snapshot commits cannot overwrite intervening plan edits.
- Hook input stays data, hook writes respect locks, and malformed MCP requests leave the server available.
- Finalization requires all intended tasks done; persisted status is assessed
  separately from completion evidence.

## Cumulative workflow experience

Describe work in natural language or use explicit workflow entry points.
Keep editable Markdown plans, durable decisions, evidence-bound completion
and verification sized to the change. Planning-only requests remain separate
from execution authority. The README presents these inherited features together
with the 1.3.4 fixes; historical notes below retain the version-by-version record.

## Measured efficiency

No new latency, token-saving, cost or recall improvement is measured for this
patch. Ledger append/compaction, learned routing and shared-core migration are deferred.

## Host capability matrix

Fresh native host activation and complete onboarding/offboarding acceptance remain pending. Package tests and release publication do not establish those host observations.

Package and distribution checks do not prove a current native host session.
**HOST READINESS: PENDING** until loading, command/skill behavior and the expected
MCP connections are observed. The README links the selected host's setup guide.

## Migration and upgrade

Use the receipt-aware upgrade route with an explicit project binding. Preserve project evidence and unknown host configuration. No credentials or production host settings are changed by package verification.

Read [AGENTS.md](AGENTS.md) and [the install guide](docs/03-install-and-host-verification.md).
Choose one route, check the installed package version, and restart the host.
Source checkouts and release archives have different build requirements; follow
the documented route. Do not reset populated runs merely to upgrade.

## Known risks

Native acceptance is separate from package readiness. Token/cost budgets are
metadata; pending approvals are persisted observations without a live approval
queue. Shell loop policy beyond the configured global cap needs orchestrator enforcement.

## Rollback

Retain the published v1.3.3 tag and ownership receipts. Remove only receipt-owned, unmodified assets and use a fresh host session to verify removal.

## Documentation and family presentation

Aligned sibling README structure, current setup navigation and a shared six-repo
family table. Personal environment files and caches are ignored while example
configuration and pinned fixture logs remain publishable. Earlier release notes
remain below as historical evidence.

## Post-publication repository maintenance

The current main-branch dependency lock uses patched `fast-uri` 3.1.8.
This addresses [host canonicalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
Existing published v1.3.4 archives retain their original tagged dependency
contents. Use the current source lock for this fix; a refreshed archive needs
a subsequent versioned release.

## Prior release notes

# LazyBuddy v1.3.3 — reliability and release consistency

**Status:** v1.3.3 release. Package, lifecycle, and publication checks passed locally and in PR CI. Fresh CodeBuddy and WorkBuddy activation remains pending.

## Eval-driven fixes

- Restricted-role hook decisions now normalize identity, reject conflicting identities and malformed or oversized mutating input, and deny unrestricted shell dispatch.
- A deferred optional MCP server provides a valid protocol endpoint. Python bytecode caches are excluded consistently from package inventory and archive selection.

## Measured efficiency

No token, latency, or cost improvement has been measured for this patch.

## Host capability matrix

Package checks exercise CodeBuddy and WorkBuddy routes. Fresh host activation and MCP behavior still require observation on a recorded build and session.

## Migration and upgrade

Update from v1.3.2 through the normal host route. Preserve caller state and verify the installed package identity.

## Known risks

Role enforcement depends on trusted host identity and an explicitly restricted run. Package checks do not establish host sandboxing or live connection health.

## Rollback

Use lifecycle rollback to the prior verified v1.3.2 release while preserving run evidence and caller state.

## Prior release notes

# LazyBuddy v1.3.2 — durable verification handoff

**Status:** v1.3.2 release. Source, publication, and main-branch CI checks passed. Fresh CodeBuddy and WorkBuddy activation remains pending; package verification alone does not establish host readiness.

## Eval-driven fixes

- The verifier contract writes a run-scoped, revision-bound report as checks finish; the orchestrator contract blocks a verdict when that report is missing, incomplete, or stale. Generic completion APIs do not yet enforce this report format.
- The orchestrator contract requires focused checks between stages, one full matrix at closure, a compact run digest, and completion events instead of active polling. It forbids duplicate dispatch while owned paths or evidence are changing.
- Where the host supplies agent identity, the PreToolUse hook denies an orchestrator Write/Edit outside its own state directory. Host payloads without identity still require the agent contract to enforce this boundary.

## Measured efficiency

The B3 postmortem identifies repeated whole-suite verification and polling as major token sinks. v1.3.2 has no measured token, latency, or cost reduction yet.

## Release verification

PR #38 and the merged main branch passed CI. The tag-triggered release workflow separately verifies the package and publication archive before attaching its release asset. Treat the attached archive and workflow result as the publication evidence; confirm Skills, commands, agents, hooks, and MCP connections in a fresh host session before claiming live readiness.

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
