# Dashboard service

The v1.4.0 dashboard surface is package-owned local software. This page maps
what ships, what each entry point does, and which claims it can never make.
The authoritative service contract is
[shared/dashboard/SERVICE.md](../../lazybuddy-plugin/shared/dashboard/SERVICE.md);
this overview never overrides it.

## What is vendored

| Artifact | Role |
| --- | --- |
| `lazybuddy-plugin/shared/dashboard/` | The family's portable dashboard core: projection, command and queue reducers, the browser UI, and the service runtime. |
| `lazybuddy-plugin/shared/dashboard.vendor.json` | Hash-pinned vendoring manifest recording the source revision and `treeSha256` for the vendored tree. |
| `scripts/vendor-dashboard.mjs` | The vendoring tool; `--check` verifies every family root against the pinned tree. |
| `.github/workflows/dashboard-family-drift.yml` | LazyBuddy-run CI job that rejects dashboard drift across the six sibling repositories. |

LazyBuddy is the vendoring source. The vendored bytes are drift-guarded: do
not edit `shared/dashboard/` in place; a change must go through the vendoring
tool so the pinned manifest and every sibling tree move together.

## The authenticated browser service

The service binds literal `127.0.0.1`, always requests an owned port, and
returns the actual URL plus a credential-file location; credential bytes never
appear in CLI output or URLs. Every browser session starts from
`POST /api/session` with the access key stored in the protected credential
file, and every command needs the resulting bearer token plus the exact bound
origin. The UI offers Work, Verification, and Plan-edit views with a task
inspector, an evidence preview dialog, and queue planning.

Two boundaries are load-bearing:

- **Transactional edits only.** Commands are typed, revision-checked, and
  durably recorded; 409 means a revision conflict and 422 a rejection. There
  is no shell, patch, arbitrary file-write, or manual-pass route.
- **Queue edits never start work.** `create_queued_plan`, `amend_queued_plan`,
  and `reorder_queued_plan` target the independent project queue and never
  dispatch execution or consume a plan revision. No endpoint executes tasks.

## The six-tool status-dashboard MCP server

| Tool | Boundary |
| --- | --- |
| `show_run_status` / `show_task_graph` / `show_verification_matrix` / `show_pending_approvals` | Read-only status views over local run state; a rendered status is not a completion or host-integration claim. |
| `dashboard_service` | `start`, `status`, `stop`, or `open` for the owned loopback browser service. `open` returns the browser entry and labels native host loading unobserved. |
| `copy_task_context` | Copies a validated producer context binding without executing it, consuming a revision, or verifying work. |

## Honest capability labels

| Capability | Label |
| --- | --- |
| Browser dashboard | Available (package-owned, loopback, authenticated). |
| Transactional plan/task edits | Available. |
| Independent project queue | Available; queue edits never start work. |
| Context copy | Available; it does not execute or verify. |
| Observations | Available from committed run and event state. |
| Host embedding / chat handoff / wake | Unobserved. |
| Native host readiness | Pending. |

The dashboard does not prove that any host embedded it, handed off a chat, or
woke from a host event. Package readiness and host readiness remain separate
authorities; without a current host session, **HOST READINESS: PENDING** is
the only honest result.

## 1.4.0 repairs recorded in this release

- The marketplace route contract was regenerated with the repository's own
  generator after the accepted dashboard payload changes: `file_count` stayed
  63 and only the pinned inventory digest moved.
- No-drift plan sync no longer rewrites `state.json` or appends plan-sync
  events for cosmetic or fenced-example plan edits; a first revision snapshot
  adopts the revision with a checkpoint-only write.
