# LazyBuddy v1.2.0 — evidence-bound execution and release integrity

This file prepares the coordinated v1.2.0 package. It does not publish a tag,
GitHub release, marketplace entry, or host installation. Package readiness and
host readiness remain separate authorities.

## Eval-driven fixes

- Completion now requires revision-bound, independently verified evidence and
  rejects stale context, spoofed dirty-tree probes, weak or missing artifacts,
  and changed capability fingerprints.
- Atomic run transactions and task leases recover after interruption without
  allowing concurrent work to claim another task's namespace.
- Bounded cost telemetry records invocations, elapsed time when available,
  evidence bytes, reruns, rework, concurrency, and unavailable token telemetry.
- Deterministic risk classification scales verification work while preserving
  the final completion and evidence gates.
- CodeBuddy CLI, CodeBuddy IDE, and WorkBuddy probes/status are tied to current
  executable, build, session, and capability fingerprints.
- Python preflight, network redirects, MCP transport, path boundaries, and
  sensitive output are hardened; lifecycle regression coverage preserves
  modified, unknown, and unrelated state through v1.1.0-to-v1.2.0 transitions.
- The verification MCP rejects malformed nonblank ledger lines with the exact
  line number while keeping its stdio session usable. Lifecycle hooks fail
  typed on corrupt or unreadable candidate state instead of recording against
  another run.
- The npm 11 package verifier installs from inside its interrupt-cleaned
  temporary root with scripts disabled. Aggregate verification retains serial
  shell classifications, automatically covers Node and Python suites, bounds
  Node concurrency to 2 by default and 4 maximum, and reports
  `shell_regressions`, `node_tests`, and `python_tests` separately.
- Package doctor is package-only by default and never executes a PATH-resolved
  `codebuddy`; optional host validation requires
  `--host-validator /absolute/path`. Verification-risk reports include
  in-memory monotonic total and per-gate `elapsed_ms`, while historical
  efficiency fixtures use `validation_elapsed_ms`.

## Measured efficiency

Checked-in fixtures under `lazybuddy-plugin/tests/fixtures/efficiency/` record
the comparison. The direct scenario completed 13 assertions in 75,300 ms with
2 invocations, 5,037 evidence bytes, zero reruns, zero rework, and concurrency
1. The six-module scenario completed 57 assertions in 51,278 ms with 9
invocations, 13,533 evidence bytes, one rerun, one rework event, and concurrency
6. Both passed the same three gates: exact assertions, completion
classification, and required evidence. Token totals are explicitly unavailable,
so no token savings are claimed.

## Host capability matrix

| Product surface | v1.2.0 package capability | Host evidence boundary |
| --- | --- | --- |
| CodeBuddy CLI | Documented release-root local marketplace route with full plugin assets and six MCP declarations | Discovery, install, fresh session, one Skill/command, and all MCP connections must be observed separately |
| CodeBuddy IDE | Uses the CodeBuddy CLI marketplace route when available; manual Skills/MCP is recovery-only | Current executable fingerprint and fresh IDE session evidence are required |
| WorkBuddy | Full-plugin manifest for Skills, commands, agents, hooks, and six MCP declarations | Current build/session receipt must prove each capability; package files alone remain pending |
| TraeCode / TraeCode CLI | Provided by the paired LazyTrae package, not LazyBuddy | Use LazyTrae's package and host-specific evidence boundaries |

## Migration and upgrade

Upgrade only through the durable release-owned lifecycle launcher. A v1.1.0
receipt may be upgraded to v1.2.0 after inventorying managed, modified, unknown,
and unrelated assets. Keep CodeBuddy package removal distinct from `codebuddy
daemon uninstall`; preserve host settings, credentials, schema versions, v1/v2
contract filenames, historical fixtures, and user changes. Do not run the
full-plugin route beside the recovery-only Skills/manual-MCP route.

## Known risks

- Live CodeBuddy CLI, CodeBuddy IDE, and WorkBuddy readiness is pending unless
  a current supported build/session is visibly observed.
- Risk-scaled verification reduces unnecessary intermediate work, but final
  release, security, parity, and evidence gates remain mandatory.
- Same-version ref movement, a changed runtime/executable, or changed host
  fingerprint invalidates prior evidence and requires re-verification.

## Rollback

Use the durable launcher's receipt-scoped offboard/rollback flow. Remove only
v1.2.0 receipt-owned unmodified assets after approval, preserve modified or
unknown files and host-managed settings, and never restore v1.1.0 over user
changes. Daemon removal is not package removal. If runtime identity is stale,
use a fresh verified checkout for scoped offboard and then onboard the desired
immutable release.
