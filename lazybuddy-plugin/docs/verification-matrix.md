# LazyBuddy v0.17 Verification Matrix

This package-local matrix supplements the repository [verification matrix](../../docs/lazybuddy-verification-matrix.md). It is self-contained and does not require a LazyTrae checkout during normal CI.

## Documentation and readiness checks

| Category | Command | Expected result | Evidence |
|---|---|---|---|
| Public status vocabulary | `bash tests/v017-documentation-regression.sh` | Required headings and all seven public readiness statuses are documented | Command output |
| Package versus host | `bash scripts/lazybuddy-load-check.sh` | Package readiness is reported without claiming host loading or MCP connection | Command output |
| Existing links | `bash scripts/lazybuddy-docs-check.sh` | Internal Markdown links resolve | JSON summary |
| Normal CI isolation | `bash scripts/lazybuddy-verify.sh` | Checks are local to this repository; parity is not an operational dependency | JSON summary |
| Paired release parity | Release-only paired runner with an explicit sibling path | Contract artifacts are compared without global install or host mutation | Release evidence |

## Intentional product differences

| Difference class | LazyBuddy contract |
|---|---|
| Host integration | CodeBuddy uses its plugin marketplace/UI; WorkBuddy uses a documented UI or local `skills/` import plus manual MCP configuration. |
| State and path | Runtime state is `.lazybuddy/`; package assets are under `lazybuddy-plugin/`. |
| Inventory | Eight MCP declarations are packaged. Filesystem and Playwright are not declared by LazyBuddy. |

## Safety and host limits

Package checks and canonical status reports are read-only: they do not activate optional providers, install globally, register MCP, or prove a live host session. Receipt-safe removal preserves host-owned registrations and unknown/tampered/link entries. MCP protocol checks cover malformed JSON, invalid requests, notifications, later valid requests, and stdout purity. The stated cross-product host verification scope is **macOS only**; non-macOS host behavior remains unverified.
