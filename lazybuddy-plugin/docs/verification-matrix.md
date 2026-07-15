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
| Documentation contract | `bash tests/v017-documentation-regression.sh` | shared headings and host-boundary policy pass | command output |

## Capability and host boundary

Package readiness and doctor validate copied package assets, six local MCP servers,
the optional-capability policy, and receipt-safe removal rules. They do not prove a
live CodeBuddy or WorkBuddy host loaded the package, executed a hook, or connected
an MCP server. A manual host observation in a new session or the applicable host UI
is still required.

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
