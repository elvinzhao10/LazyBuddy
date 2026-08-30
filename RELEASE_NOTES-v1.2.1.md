# LazyBuddy v1.2.1 — compatibility and release verification

This patch release advances package, runtime, and current documentation
authorities from v1.2.0 to v1.2.1. It does not publish a tag or prove that a
CodeBuddy or WorkBuddy host loaded the package.

## Eval-driven fixes

- PR #23 made the direct and six-module efficiency evaluations standalone by
  checking in their assertion outputs, diffs, worker claims, and test fixtures.
- The eval validator now binds assertion artifacts to the LazyBuddy product
  namespace and their recorded digests, so sibling-product or stale evidence is
  rejected.
- PR #23 corrected the readiness diagnostic fixture and the service-adapter
  security fixture so their assertions exercise the intended behavior instead
  of incidental host state.

## Measured efficiency

The post-v1.2.0 README summary remains the operating model: deterministic risk
selects focused or comprehensive verification; shell, Node, and Python results
remain separate; Node execution is bounded; and cost/outcome telemetry is
redacted. The checked-in direct evaluation passed 13 of 13 assertions with one
actor, two invocations, no reruns or rework, 75,300 ms validation time, and
5,037 evidence bytes. The six-module evaluation passed 57 of 57 assertions
with seven actors, six-way concurrency, nine invocations, one rerun/rework,
51,278 ms validation time, and 13,533 evidence bytes. Token totals remain
unavailable because the host did not expose native token telemetry.

## Host capability matrix

| Host | Package route | Readiness requirement |
| --- | --- | --- |
| CodeBuddy CLI | Release-root local marketplace | Fresh session with one loaded Skill or command and all six MCP connections. |
| CodeBuddy IDE | CLI-backed marketplace when available; observed-build GUI or recovery fallback otherwise | Fresh IDE session with the same loaded surface and six live MCP connections. |
| WorkBuddy | `.workbuddy-plugin/plugin.json` through the host's visible marketplace/plugin flow | Current-build receipt for a Skill, command, agent, hook, and all six MCP connections. |

The Skills/manual-MCP route remains recovery-only. WorkBuddy remains named
WorkBuddy, and CodeBuddy IDE and CodeBuddy CLI authority boundaries are
unchanged.

## Migration and upgrade

Use the durable launcher to update from v1.2.0 after inventorying receipt-owned,
modified, and unknown assets. Preserve user changes and host-managed settings.
Package checks establish package readiness only; after upgrade, start a fresh
host session and observe the selected route before claiming host readiness.
PR #21 makes Linux Node 22 and Node 24 core jobs plus the macOS lifecycle job
blocking behind one deterministic PR safety net. PR #22 adds weekly full-suite
compatibility coverage on macOS Node 26. PR #23 sets the module behavior
required by that scheduled verifier.

## Known risks

- Live marketplace discovery, plugin loading, hooks, and MCP connectivity are
  host-owned behavior and remain pending without current-session evidence.
- Weekly Node 26 coverage is compatibility evidence, not a promise that Node 26
  is the minimum supported runtime; Node.js LTS 20 or newer remains required.
- The paired release candidate still requires matching sibling-product release
  contracts and independent source/artifact receipts.

## Rollback

Stop the host session and run durable `offboard` plan-first. After approval,
remove only unmodified v1.2.1 receipt-owned assets, preserve modified, unknown,
linked, caller-owned, and host-managed state, then reactivate the immutable
v1.2.0 release. Start a fresh session and re-observe the selected host route;
never edit receipts, `active.json`, or private host registries by hand.
