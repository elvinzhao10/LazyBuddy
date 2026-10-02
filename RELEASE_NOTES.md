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
