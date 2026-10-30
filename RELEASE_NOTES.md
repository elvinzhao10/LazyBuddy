# LazyBuddy v1.4.0

## Unreleased 1.4.1 — verification, history and scale

The combined former 1.4.1 and 1.4.2 scope is implemented in this development branch. Package metadata and the published baseline remain **1.4.0**; this PR does not publish a release. Live-host acceptance is **deferred by the maintainer as of 2026-10-30**, and remains pending.

- Retain versioned verification scenarios, compare attempts by their source/criterion/plan subject, and promote an observed failure into an unverified regression scenario.
- Bind rerun review to the exact plan, criterion and captured source. Pending, rejected, stale and used approvals cannot authorize another native attempt; independent verification remains required.
- Inspect checkpoint/decision history through authenticated, paginated reads. Deduplicate identical runtime events with transactional recovery while retaining the original ledger and failed attempts.
- Preserve first-review plan bytes, correct legacy review-state updates, and harden owned-process cleanup against PID reuse and exit races.
- Reduce repeated replay and unnecessary review-source capture in measured local cases. These measurements do not establish whole-task latency, token or cost savings.

See the [1.4.1 completion and validation record](docs/verification/1.4.1-completion.md) and [usage/contracts](docs/verification/1.4.1-verification-history.md).

LazyBuddy 1.4.0 adds the shared local project dashboard and persistent project
record to the existing planning, execution and verification workflows.

## Dashboard and project work

- An authenticated local dashboard with eight destinations: **Overview, Project,
  Plans, Health, Execution, Git, Evidence and Research**.
- A project record, editable plans, queue planning and research capture, with
  source revisions and evidence references visible for review.
- A run monitor that separates execution progress from verified completion,
  plus reported token usage, resource activity and retained-run history.
- A Health inventory of package components, separate from observed host activity.

The collapsible sidebar, contextual Details and expandable pan/zoom maps keep
navigation within the project. Source edits use authenticated native project
binding and revision checks. Queue edits do not start work. Plans and research
retain source revision and evidence references; these references are not
immutable source copies or verification verdicts. Unknown usage stays unknown,
and recorded comparisons do not establish efficiency savings.

The `status-dashboard` MCP server exposes seven tools, including
`dashboard_service`, `copy_task_context` and typed `project` operations.

The dashboard and project cores are hash-pinned in the package's
[vendor manifests](lazybuddy-plugin/shared/dashboard.vendor.json), with a separate
[project manifest](lazybuddy-plugin/shared/project.vendor.json). See the
[documentation index](docs/README.md) for package architecture and usage.

## Host capability matrix

CodeBuddy CLI and IDE use the documented marketplace route when the CLI is
available. WorkBuddy has a separate full-plugin route; Skills and manual MCP
remain a recovery option. Historical macOS observations do not establish
current-build compatibility. See the [platform audit](docs/reference/platform-status-2026-10-27.md)
for the documented versions and the acceptance still needed.

## Known risks

**HOST READINESS: PENDING.** Package checks do not prove plugin loading, hook
execution, model selection or live MCP connections. Browser embedding, chat
handoff and host wake remain unobserved. No current-session model selection or provider entitlement is established.

## Migration and upgrade

Use Node.js 24 LTS (recommended) or Node.js 22 LTS, Git and Python 3.10+.
The core lifecycle and the pinned TypeScript language-server 5.3.0 provider
retain Node.js 20 compatibility. Optional tooling stays separately enabled.

Use the [installation guide](docs/03-install-and-host-verification.md) and
[AGENTS.md](AGENTS.md) for the selected route. Update only receipt-owned assets
and preserve modified or unknown files,
project history and host settings. Do not combine a full-plugin route
with its fallback. After updating, observe a fresh host session separately
from package checks.

## Rollback

Keep the previous release and its receipts. Rollback and removal remain
receipt-scoped; follow the [removal guide](docs/08-safe-removal.md) instead of
deleting host directories.

## Eval-driven fixes

Source writes check the expected revision before mutation, and project stores
reject a foreign runtime identity. Package verification covers these local
boundaries separately from native host acceptance.

## Measured efficiency

Usage and retained-run comparisons display recorded inputs only. Missing usage
is not zero, fixture measurements are not live host measurements, and this
release makes no token, time, resource or cost-saving claim.

## Release verification and distribution

The [release workflow](.github/workflows/release.yml) checks the tag against the
package version and gates publication on package verification and publication checks.
It builds `lazybuddy-v1.4.0.tar.gz` for the selected tag and publishes it as a GitHub Release
asset. Archive checks are part of that workflow; existing published assets
are retained. This workflow does not publish to npm.

Final CI and release-job outcomes belong to the tagged commit's Actions run;
these notes do not substitute for that result or for current-session host
acceptance. Reproduction commands are in the
[test and release guide](docs/09-test-and-release-verification.md).

Historical release entries remain in [CHANGELOG.md](CHANGELOG.md) and dated
platform audit documents.
