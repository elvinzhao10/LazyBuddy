# LazyBuddy v1.2.2 — streamlined adaptive context

This release prepares the v1.2.2 package and current documentation. It does
not publish a tag, marketplace entry, or host installation. Package readiness
and current host observation remain separate authorities.

## Eval-driven fixes

- Automatic workflow selection now selects the smallest sufficient existing
  workflow from task risk and complexity without an explicit special command.
- Selection is deliberately selection-only until current host readiness is
  observed. It records the selected package workflow but does not claim native
  workflow loading or host dispatch.
- Matching identity resumes current adaptive state; stale, dirty, terminal,
  malformed, or misleading status inputs are rejected or reclassified instead
  of reusing completion authority.

## Measured efficiency

The current compact LazyBuddy task packet is 1,637 bytes rather than 2,285
bytes: 648 bytes, or **28.36%**, smaller. This percentage applies only to the
explicit before/after packet preimages; no unavailable token reduction is
claimed. The direct and six-module quality gates retain 13/13 and 57/57
assertions respectively, so required safety and quality requirements are
unchanged.

## Host capability matrix

| Host | Package route | Readiness requirement |
| --- | --- | --- |
| CodeBuddy CLI | Release-root local marketplace | Fresh session with one loaded Skill or command and all six MCP connections. |
| CodeBuddy IDE | CLI-backed marketplace when available; observed-build GUI or recovery fallback otherwise | Fresh IDE session with the same loaded surface and six live MCP connections. |
| WorkBuddy | `.workbuddy-plugin/plugin.json` through the host's visible marketplace/plugin flow | Current-build receipt for a Skill, command, agent, hook, and all six MCP connections. |

The Skills/manual-MCP route remains recovery-only. Selection output is package
evidence only until the selected host is observed.

## Migration and upgrade

Use the durable launcher to update from v1.2.1 after inventorying
receipt-owned, modified, and unknown assets. Preserve user changes and
host-managed settings. Run package checks, then start a fresh host session and
observe the selected route before reporting host readiness.

## Known risks

- Live marketplace discovery, plugin loading, hooks, workflow dispatch, and
  MCP connectivity remain host-owned and pending without current-session
  evidence.
- The measured 28.36% reduction concerns compact packet bytes only; it does
  not imply a token or host-worker reduction.
- Same-version ref movement, a changed runtime/executable, or changed host
  fingerprint invalidates prior evidence and requires re-verification.

## Rollback

Stop the host session and run durable `offboard` plan-first. After approval,
remove only unmodified v1.2.2 receipt-owned assets, preserve modified, unknown,
linked, caller-owned, and host-managed state, then reactivate the intended
immutable prior release. Start a fresh session and re-observe the selected host
route; never edit receipts, `active.json`, or private host registries by hand.
