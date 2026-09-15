# LazyBuddy v1.2.3 — platform compatibility patch

This release prepares the v1.2.3 package. It does not publish a tag,
marketplace entry, or host installation. Package readiness and current host
observation remain separate authorities.

This is a patch release. It changes host-facing validation, setup output, and
plan parsing. Workflow and decision-memory features are **not** part of this
release; they are scheduled for v1.3.0.

## Eval-driven fixes

- Host MCP declarations are validated before they are trusted. Stdio servers
  require a non-empty executable name or path (spaces are supported), string
  arguments, and resolvable bundled launcher paths. HTTP transports require a URL. A violation reports a typed error naming the
  server and the remediation instead of failing silently or loading anyway.
- An empty or malformed `mcpServers` object is rejected explicitly rather than
  passing validation with no servers checked.
- Setup output is actionable. The load check and the status report print the
  remaining step for each host and name the failing component with its detail,
  so a reader does not have to infer the next action.
- Enabling a project-scoped MCP surface is reported as a host setting, never as
  an observed connection. Package readiness is not promoted to host readiness.
- Plan parsing accepts the canonical `## TODOs` heading and the legacy
  `## Todos` form. A non-empty plan that parses zero tasks now fails with an
  actionable error rather than reporting success, and missing or duplicate task
  identifiers are reported instead of matched by guesswork.
- A checkbox label that matches more than one task is refused with the full
  list of matches rather than updating an arbitrary first match.

## Measured efficiency

This patch does not change the compact task packet or any previously measured
byte, assertion, or gate figure. The previously recorded baseline measured
the compact task packet at 1,637 bytes rather than 2,285 bytes, a
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

Use the durable launcher to update from v1.2.2 after inventorying
receipt-owned, modified, and unknown assets. Preserve user changes and
host-managed settings. Run package checks, then start a fresh host session and
observe the selected route before reporting host readiness. Existing
valid declarations, including executable paths containing spaces, need no change.

## Known risks

- Live marketplace discovery, plugin loading, hooks, workflow dispatch, and
  MCP connectivity remain host-owned and pending without current-session
  evidence.
- The command validation is a local declaration boundary. It does not prove
  that a declared server starts, that its arguments are safe, or that a host
  will load it.
- Host tool surfaces may interpose their own command shims. A shim that does
  not implement POSIX extended regular-expression classes can change the
  behavior of shipped shell checks on that host; this release converts the
  affected hook patterns to POSIX character classes but cannot constrain
  arbitrary host shims.
- Same-version ref movement, a changed runtime/executable, or changed host
  fingerprint invalidates prior evidence and requires re-verification.

## Rollback

Stop the host session and run durable `offboard` plan-first. After approval,
remove only unmodified v1.2.3 receipt-owned assets, preserve modified, unknown,
linked, caller-owned, and host-managed state, then reactivate the intended
immutable prior release. Start a fresh session and re-observe the selected host
route; never edit receipts, `active.json`, or private host registries by hand.
