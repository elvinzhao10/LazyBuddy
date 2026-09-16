# LazyBuddy v1.3.0 — adaptive workflow experience

This release prepares the v1.3.0 package. It does not publish a tag,
marketplace entry, or host installation. Package readiness and current host
observation remain separate authorities.

This is a feature release. It adds dual activation, progressive milestones
with scoped decision gates, human plan-edit reconciliation, a cross-plan
decision ledger, and verification-tier selection with receipt reuse. Existing
routing, execution, verification, and librarian surfaces are retained; no new
orchestration framework or mandatory arbiter command is introduced.

## Eval-driven fixes

- Explicit `/lazy-start-work` and plain natural-language implementation
  requests converge on the same execution authority and gates. No slash
  command is required for a clear implementation request. Explanation,
  quoted-command, and explicit plan-only requests never mutate product files,
  and an ambiguous approval with several pending questions never grants
  execution authority.
- `execution_intent` (plan_only|execute) is persisted separately from
  workflow mode and current stage, defaulting to plan_only. Duplicate host
  events do not duplicate dispatch, and resume selects the single compatible
  run or asks only when genuinely ambiguous.
- Complex work uses one parent plan with milestones. Later milestones may be
  provisional and never dispatch; dependency cycles, missing IDs, and dangling
  child links are rejected at sync time. Decision gates carry the canonical
  question/recommendation/alternatives/owner/needed_by/status shape; a
  recommendation never becomes owner approval and only transitive dependents
  block.
- Human plan edits are reconciled at execution boundaries. Cosmetic edits
  preserve all evidence; semantic edits invalidate only the affected task and
  its transitive dependents. A human checked box is a completion assertion,
  never a verified result, and results dispatched under an older plan revision
  cannot update newer plan state.
- Cross-plan decision memory is durable: `decisions/ledger.jsonl` records
  versioned immutable events (recorded/superseded/voided, correction
  opened/resolved) with globally unique IDs, replay-derived active view, and
  visible failure on malformed records. Corrections block accepted completion
  only in their affected scope.
- Verification is selected once from the changed boundary and risk on the
  V0-V3 tier ladder, then a green receipt is reused while its declared inputs
  and covered behavior are unchanged. Test count, file count, plan size, agent
  count, or a request being called complex never promote a tier, and a failing
  focused check reruns only itself plus directly affected integration checks.

## Measured efficiency

This release does not change the compact task packet or any previously
measured byte, assertion, or gate figure. The previously recorded baseline
measured the compact task packet at 1,637 bytes rather than 2,285 bytes, a
648-byte / **28.36%** reduction, with the direct and six-module quality gates
unchanged at 13/13 and 57/57 assertions. No new efficiency claim is made here.

## Host capability matrix

| Host | Package route | Readiness requirement |
| --- | --- | --- |
| CodeBuddy CLI | Release-root local marketplace | Fresh session with one loaded Skill or command and all six MCP connections. |
| CodeBuddy IDE | CLI-backed marketplace when available; observed-build GUI or recovery fallback otherwise | Fresh IDE session with the same loaded surface and six live MCP connections. |
| WorkBuddy | `.workbuddy-plugin/plugin.json` through the host's visible marketplace/plugin flow | Current-build receipt for a Skill, command, agent, hook, and all six MCP connections. |

Package checks are package evidence only. Every host remains **pending host
proof** until it is observed in a fresh session; this release does not claim
that any host loaded, enabled, or connected anything.

## Migration and upgrade

Use the durable launcher to update from v1.2.3 after inventorying
receipt-owned, modified, and unknown assets. Preserve user changes and
host-managed settings. v1.2.3 projects load without losing plans or evidence:
the new state fields (`execution_intent`, milestone flags, decision ledger)
are additive with defaults, and states declaring a newer major version are
refused with a clear diagnostic rather than read partially. Migration is
idempotent; an absent decision ledger is a valid empty memory. Run package
checks, then start a fresh host session and observe the selected route before
reporting host readiness.

## Known risks

- Live marketplace discovery, plugin loading, hooks, workflow dispatch, and
  MCP connectivity remain host-owned and pending without current-session
  evidence.
- Dual activation depends on the host delivering prompt-submit events; where
  hook support is absent the explicit entry route is offered with an accurate
  pending status instead of a silent automatic claim.
- Host tool surfaces may interpose their own command shims. A shim that does
  not implement POSIX extended regular-expression classes can change the
  behavior of shipped shell checks on that host; shipped hook patterns use
  POSIX character classes but cannot constrain arbitrary host shims.
- Same-version ref movement, a changed runtime/executable, or changed host
  fingerprint invalidates prior evidence and requires re-verification.

## Rollback

Stop the host session and run durable `offboard` plan-first. After approval,
remove only unmodified v1.3.0 receipt-owned assets, preserve modified,
unknown, linked, caller-owned, and host-managed state, then reactivate the
intended immutable prior release. Start a fresh session and re-observe the
selected host route; never edit receipts, `active.json`, or private host
registries by hand.
