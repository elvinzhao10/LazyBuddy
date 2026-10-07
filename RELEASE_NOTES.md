# LazyBuddy v1.4.0 - vendored dashboard core and authenticated browser service

A feature release across the six LazySeries siblings: the family's portable
dashboard core is vendored byte-identically into every package, and LazyBuddy
is the vendoring source that distributes and drift-guards it.

## Project platform (2026-10-07)

- The persistent project record ships as a second vendored family:
  `lazybuddy-plugin/shared/project/` (contract, model, history, projection,
  CLI, architecture, usage accounting, reconciliation, artifacts, baseline,
  plans, source-edit, git-observation, portable qa harness) is hash-pinned by
  `project.vendor.json` and distributed byte-identically to the five sibling
  packages; the family re-pinned at T26 to tree `95c0e0fc…`, then to the
  final tree `1feb5646…` at source revision `537f393` at delivery prep, and
  the CI family-drift workflow now requires all six roots
  complete (`--require-complete`) for both families.
- Over that core, LazyBuddy (as family source) carries the project dashboard
  views, the chat/MCP project tools, transactional original-source editing,
  authority-checked baseline amendments with reconciliation, and producer
  observations with usage/time accounting and local Git/worktree collectors.
  Ports consume the same vendored runtime through their own adapters, which
  remain port-authored and distinct.
- Honest scope of those views: the project dashboard views ship as committed
  page modules plus the standalone project shell entry; the production served
  dashboard does not yet expose project destinations (its asset-manifest routes
  stay run-scoped only), and the §14 comprehension targets were measured on the
  shell entry, not the production service (see the G2 verdict — deferral R-2:
  typed project read route, post-init-only destination swap, bounded
  asset-manifest allowlist, single navigation surface, dedicated verifier and a
  comprehension re-measure remain future work).
- Boundaries stay honest: host embedding, chat handoff, and host wake remain
  unobserved on every surface; conflict assessment is deterministic only (no
  language-level semantic analysis); an immutable archive of older Markdown
  bodies is not built (receipts retain commands and digests); the vendored
  `qa/store-boundary.test.mjs` is Buddy-namespaced Buddy-side proof by design
  and does not run in siblings.

## Eval-driven fixes

- The portable dashboard core (projection, command/queue reducers, browser UI)
  lives in `lazybuddy-plugin/shared/dashboard/`, pinned by the hash-pinned
  `lazybuddy-plugin/shared/dashboard.vendor.json`; `scripts/vendor-dashboard.mjs`
  vendors it and `.github/workflows/dashboard-family-drift.yml` rejects family
  drift across the six sibling repositories.
- The `status-dashboard` MCP server gains two tools for a total of six:
  `dashboard_service` (start, inspect, stop, or return the local browser entry)
  and `copy_task_context` (copy a validated producer context without executing
  or consuming it). The four existing status views are unchanged.
- The authenticated browser dashboard binds literal `127.0.0.1`, requests an
  owned port, and requires an access key from a protected credential file. It
  offers Work, Verification, and Plan-edit views with a task inspector,
  evidence preview, and queue planning; queue edits never start work.
- The marketplace route contract was regenerated with the repo's own generator
  after the accepted dashboard payload changes: `file_count` stays 63 and only
  the pinned inventory digest moved.
- No-drift plan sync no longer rewrites run state or appends sync events for
  cosmetic or fenced-example plan edits; a first revision snapshot or a
  cosmetic edit adopts the revision without state or event writes.

## Measured efficiency

No latency, token, cost, or native-host performance improvement is claimed.
The dashboard service binds an owned loopback port with an authentication
boundary; queue edits never start work, so planning traffic cannot trigger
execution. Host embedding, chat handoff, and wake remain unobserved.

## Host capability matrix

CodeBuddy CLI, CodeBuddy IDE, and WorkBuddy retain separate acceptance. The
dashboard is package-owned local software: the browser, transactional edits,
the project queue, context copy, and observations are available in the
package, while host embedding, chat handoff, and wake are unobserved.
`dashboard_service open` returns the loopback browser entry and labels native
host loading unobserved. **HOST READINESS: PENDING** until the selected
current client demonstrates discovery, skill/command execution, relevant
hooks, and MCP connections.

See [the dated platform audit](docs/reference/platform-status-2026-10-02.md)
for the v1.3.5 historical snapshot; its boundaries are unchanged by this
release.

## Migration and upgrade

Use the receipt-aware lifecycle update with an explicit project binding.
Preserve populated run state, modified assets, unknown files, and host
settings. Existing 1.3.5 tags and assets remain intact. Runs created before
this release keep their state and events; the plan-sync repair only stops
unnecessary rewrites of unaffected runs.

Read [AGENTS.md](AGENTS.md), [README.md](README.md), and the selected host
guide before following a native installation route.

## Known risks

Authenticated current-client acceptance remains pending. A copied
configuration, manifest validation, or isolated lifecycle fixture cannot
establish host loading; the dashboard service does not prove that a host
embedded it, handed off a chat, or woke from a host event. Optional providers
must satisfy their own runtime floor. Native features added upstream are not
automatically wired into the adapter.

## Rollback

Retain the previous release and receipts. Follow the scoped lifecycle removal
or rollback plan, preserving user-modified and foreign assets. Stop the owned
dashboard service with `dashboard_service stop` before rollback; host-managed
registrations require their selected client's removal flow; never remove
credentials, sessions, or entire shared configuration directories.

## Prior release notes

# LazyBuddy v1.3.5 - runtime verification and platform clarity

A maintenance release across the six LazySeries siblings. It carries forward
the workflow and run-integrity foundation from 1.3.0 through 1.3.4.

## Eval-driven fixes

- Runtime-floor checks execute named package, installation and lifecycle tests.
  Missing or unknown exercises and failed subprocesses cannot report PASS.
- Optional TypeScript LSP installation is tested separately with engine-strict
  dependency installation and the installed server executable.
- Hook payloads are bounded before parsing and kept out of process arguments.
  Invalid or oversized events preserve each adapter's exit and state contract.
- Current product names, configuration scopes and native extension capabilities
  are distinguished from legacy routes and unverified live integration.

## Measured efficiency

Hook boundary repairs avoid payload-sized process arguments and bound input
memory. The first host-independent verification unit is vendored identically
in sibling packages, with product-specific exercises in small adapters.
No latency, token, cost or native-host performance improvement is claimed.
Persistent LSP sessions and event-ledger compaction remain future measured work.

## Host capability matrix

CodeBuddy CLI, CodeBuddy IDE and WorkBuddy retain separate acceptance. Native plugins and agent isolation are documented; the package does not establish a current authenticated host session.
Agent memory declarations now use native `memory: project` for the librarian and orchestrator; other roles omit this optional field. The validator rejects obsolete Booleans and preserves worktree and tool restrictions.

See [the dated platform audit](docs/reference/platform-status-2026-10-02.md).
**HOST READINESS: PENDING** until the selected current client demonstrates
discovery, skill/command execution, relevant hooks and MCP connections.
Official feature documentation and package tests are separate evidence.

## Dependencies and runtime requirements

Node.js 24 is recommended. Core lifecycle compatibility remains Node.js 20;
LazyTrae's standalone CLI also retains its separate Node.js 18 compatibility
tier. Optional TypeScript language-server 6.x requires Node.js 22.22.2 or later;
5.x providers retain their own Node.js 20 requirement.
Python language-server providers are aligned at basedpyright 1.40.1.
LazyTrae uses fast-uri 4.2.1 directly and the patched 3.1.8 Ajv edge, with
security and normalization regressions preserved.

## Migration and upgrade

Use the receipt-aware lifecycle update with an explicit project binding.
Preserve populated run state, modified assets, unknown files and host settings.
Select the exact client and version before following a native installation route.
Kimi Code clients can share configuration; Kimi Work is a separate target.

Read [AGENTS.md](AGENTS.md), [README.md](README.md) and the selected host guide.
Use a newly versioned archive; existing 1.3.4 tags and assets remain intact.

## Known risks

Authenticated current-client acceptance remains pending. A copied configuration,
manifest validation, or isolated lifecycle fixture cannot establish host loading.
Optional providers must satisfy their own runtime floor.
Native features added upstream are not automatically wired into the adapter.

## Rollback

Retain the previous release and receipts. Follow the scoped lifecycle removal
or rollback plan, preserving user-modified and foreign assets. Host-managed
registrations require their selected client's removal flow; never remove
credentials, sessions or entire shared configuration directories.
