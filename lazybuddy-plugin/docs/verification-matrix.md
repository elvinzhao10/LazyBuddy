# LazyBuddy package verification contract

This public, package-owned matrix lets a copied `lazybuddy-plugin/` discover
its checks without repository-root documentation. It reports package evidence
and names the host observation required before a user-facing integration claim.

## Package checks

| Verification Step | Command | Expected | Artifact |
| --- | --- | --- | --- |
| Package readiness | `bash scripts/lazybuddy-load-check.sh` | `PACKAGE_READINESS=full` or an explained degraded state | command output |
| Package health | `bash scripts/lazybuddy-plugin-doctor.sh` | `Doctor check: ALL PASS` | command output |
| MCP integration | `bash scripts/lazybuddy-mcp-test.sh` | `MCP test: ALL PASS` | command output |
| Package verification | `bash scripts/lazybuddy-verify.sh` | JSON with `"all_pass":true` | command output |

## Repository publication check

The installed package checks above do not read repository-root learner pages.
Release CI runs `bash tests/publication-regression.sh` separately from a full
repository checkout to validate the learner route, local links, and public
semantic claims.

## Capability and host boundary

Package readiness and doctor validate copied package assets, six local MCP servers,
the optional-capability policy, and receipt-safe removal rules. They do not prove a
live CodeBuddy or WorkBuddy host loaded the package, executed a hook, or connected
an MCP server. A manual host observation in a new session or the applicable host UI
is still required.

## Readiness vocabulary and route boundaries

Every record emitted by a package check has `readiness_scope=package-ready`.
That scope means only that the copied package and its local contracts are
internally consistent. The contract also names three scopes that package checks
must never synthesize: `observed-build-route` (a route seen in a particular host
build), `manual-skills-mcp-fallback` (Skills import plus six manually configured
local MCP connectors), and `live-host-proof` (a fresh host session showing the
requested Skill/command and every expected MCP connection).

The manual fallback is intentionally Skills-only: it excludes agents, commands,
and hooks. Do not run it alongside the full plugin route for the same project;
the two routes can double-load Skills or MCP processes and their coexistence is
unsupported. To migrate safely, stop the host session, remove the old route's
Skills/plugin and only its six LazyBuddy connectors through the host UI, select
one route, start a new session, and verify the selected route's exact surface.
Package checks do not inspect host-private directories or claim that migration
or live proof occurred.

## Intentional host differences

| Difference class | LazyBuddy documentation rule |
| --- | --- |
| Host integration | CodeBuddy uses its plugin flow; WorkBuddy uses its UI/marketplace or local skills with manual host connector configuration. |
| State/path | Receipt-owned tooling roots stay package-local; host-managed paths and `.workbuddy` state are not scanned or removed. |
| Inventory | Six local MCP servers are bundled. Context7 and `grep_app` are optional export fragments; filesystem and Playwright are not bundled local MCP servers. |

## Scope and paired evidence

Verification in this matrix is macOS only. Normal CI does not require a
sibling repository. Release-only paired parity may receive explicitly supplied
sibling roots to compare documentation or contracts; it is not a runtime,
installation, or normal-CI dependency. The repository-level evaluation is
additional public evidence; this package matrix remains self-contained.

## Adaptive harness (v1.0.3)

The v1.0.3 adaptive harness adds behavior-only tests on top of the package
checks above. They prove the harness selects the smallest sufficient workflow
mode, composes existing surfaces, persists an additive snapshot, falls back
safely, escalates within bounds, and explains material choices. They are
still `package evidence` — they do not prove a live host loaded the plugin or
connected an MCP server.

### Adaptive package checks

| Verification Step | Command | Expected | Artifact |
| --- | --- | --- | --- |
| Contract byte-identical with LazyTrae | `diff -r lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json <lazytrae>/lazytrae-plugin/packages/cli/contracts/adaptive-harness-contract.v1.json` | empty diff | command output |
| Contract schema validation | `python3 -c "import json, jsonschema; ..."` (or `ajv validate`) | exit 0 | command output |
| Contract + fixture digest | `shasum -a 256 -c lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json.sha256` and `shasum -a 256 -c lazybuddy-plugin/contracts/fixtures/v103/sha256sums.txt` | `OK` for every line | command output |
| Adaptive detector behavior | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_detector.py` | all tests pass | pytest output |
| Adaptive mapping per mode | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_mapping.py` | all tests pass | pytest output |
| Adaptive snapshot extension | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_snapshot.py` | all tests pass; v1.0.2 state without `adaptive` continues to load | pytest output |
| Adaptive explanation | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_explanation.py` | all tests pass | pytest output |
| Full-plugin host mapping | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_hosts.py` | CodeBuddy and WorkBuddy mappings pass; Skills/MCP fallback explicitly marked degraded | pytest output |
| Adaptive integration (detector → mapping → snapshot → explanation) | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_integration.py` | all tests pass | pytest output |
| W4.1 explicit override remains authoritative | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_1_explicit_override.py` | all tests pass; classifier does not silently downgrade explicit requests | pytest output |
| W4.2 bounded escalation | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_2_bounded_escalation.py` | all tests pass; max-two-escalation bound enforced; blocked-state record produced | pytest output |
| W4.3 capability fallback | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_3_capability_fallback.py` | all tests pass; no approval-required authority activated without approval | pytest output |
| W4.4 responsibility ownership | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_4_responsibility_ownership.py` | all tests pass; one owner per stage; no duplicate work | pytest output |
| W4.5 continuation | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_5_continuation.py` | all tests pass; compatible snapshots resume the saved stage/mode and escalation state, while incompatible request/revision snapshots reclassify from `understand` without mutating prior state | pytest output |
| W4.6 evidence freshness | `python3 -m pytest lazybuddy-plugin/tooling/test_lazybuddy_adaptive_w4_6_evidence_freshness.py` | all tests pass; revision-fingerprint changes trigger stale reclassification and re-verification signalling, while the existing `lazy-verifier` surface is reused without a parallel lineage store | pytest output |
| Aggregate verification | `bash scripts/lazybuddy-verify.sh` | JSON with `"all_pass":true` | command output |

### Adaptive evidence boundary

The adaptive package checks above are `package evidence`. They prove:

- the contract is byte-identical with LazyTrae (`parity evidence` only at the
  contract layer);
- the classifier, mapping, snapshot, and explanation modules behave per the
  contract against the shared fixture set;
- v1.0.2 state without the `adaptive` block continues to load;
- the single-writer rule is enforced;
- authority-safe fallback and bounded escalation behave per the contract.

They do **not** prove:

- a live CodeBuddy or WorkBuddy host loaded the plugin, executed a hook, or
  connected any of the six MCP servers;
- the adaptive explanation surfaced through a real host session;
- failure escalation or continuation was observed through the current host
  surface;
- any host route is OBSERVED rather than PENDING.

Live-host observation for W5.3 (WorkBuddy full-plugin) and W5.4 (CodeBuddy
and other hosts) is **PENDING**. Host-route procedures and the repository-level
adaptive-harness narrative are intentionally outside this copied package; a
package check must not turn those documents into package evidence or infer a
live host result.
