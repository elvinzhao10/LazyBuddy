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
