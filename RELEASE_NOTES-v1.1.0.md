# LazyBuddy v1.1.0 — Native host readiness boundaries

## Scope

v1.1.0 is the current documentation release. It updates human-facing route,
onboarding, migration, security, removal, evaluation, and status boundaries.
It does not change a package manifest, publish a marketplace artifact, or
assert that any host currently loaded LazyBuddy. The v1.0.3 release notes and
their evidence are historical and unchanged.

## Host and route status

The supported route identifiers are `codebuddy-cli`, `codebuddy-ide`, and
`workbuddy`.

| Host | Default route | Recovery route | Required current proof |
| --- | --- | --- | --- |
| CodeBuddy CLI (`codebuddy-cli`) | Release-root local marketplace | No persistent `--plugin-dir` substitute | Fresh session with one real Skill/command and all six MCP connections. |
| CodeBuddy IDE (`codebuddy-ide`) | Marketplace when the CLI route is available | Skills import plus six manual MCP connectors | Fresh session observation for the chosen route. |
| WorkBuddy (`workbuddy`) | Marketplace full-plugin route from `.workbuddy-plugin/plugin.json` | Skills import plus six manual MCP connectors | Current source/version/build/session receipt with the declared plugin surface and six MCP connections. |

Marketplace is the default full-plugin route for CodeBuddy IDE and WorkBuddy.
The manual Skills/MCP route is recovery-only and mutually exclusive with a
full-plugin route for the same project. Stop the session and remove only
LazyBuddy's old entry and manually added connectors through the host UI before
choosing the other route.

## v2 evidence language

v2 native modes are `invoke-documented`, `observe-only`, `descriptor-only`,
and `unavailable`. Its public labels are `documented-tested`,
`documented-untested`, `observed-build-specific`, and `unavailable`. Evidence
scopes are `package`, `probe`, and `current-session`.

Package readiness does not prove a live host. A `package` result validates
local assets and declarations only; a `probe` is limited to one observed build;
only a current `current-session` observation supports a current host claim.

## Onboarding and migration

Start from the verified LazyBuddy origin, use durable `status`, and select one
host before any host-managed action. Safe package checks may run first, but
marketplace, plugin, connector, account, credential, and trust changes require
explicit approval and one host action at a time. Observe the next fresh session
before reporting route readiness.

To migrate, stop the existing session; use the host UI to remove only
LazyBuddy's receipt-scoped plugin/Skills entry and its six manually added
connectors; choose exactly one route; then start a fresh session and verify
that route. Do not run both routes together.

## Security and removal

Do not automate trust, bypass permissions, modify private host registries, or
put credentials, OAuth values, tokens, or secrets in project configuration,
documentation examples, or receipts. Preserve host-managed paths and user
settings. Host removal is a user-observed action; package offboarding removes
only exact receipt-owned, unmodified assets and does not remove host state.

W4.5 and W4.6 are historical v1.0.3 test labels. They are not current v1.1.0
host-readiness, publication, or live-session evidence.
