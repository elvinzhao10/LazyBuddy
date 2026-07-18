# Host capability matrix

LazyBuddy deliberately aligns policy and package safety across hosts while keeping host adapters distinct. The same package may be present on two surfaces without both hosts exposing the same loading or registration behavior.

## Onboarding baseline

Keep the pinned `v1.0.2` release in a permanent folder. Open or link it in the
selected host, give the agent
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`. The agent
detects or asks for CodeBuddy IDE, CodeBuddy CLI, or WorkBuddy, runs safe
package checks, and reports package readiness separately from host readiness.
Before a host-managed change it asks for approval, gives one exact action, and
waits. It then uses Computer Use or a user-pasted status/screenshot; reload or
new session is a later action. Verify one real Skill/command and all six MCP
connections. Without observation, **HOST READINESS: PENDING**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback.

## What each host needs

| Host | Local route | Supported fallback | Required host proof |
| --- | --- | --- | --- |
| **CodeBuddy IDE** | Plugin loading is build-specific and may be used only after current discovery. | Public Skills import plus manual MCP JSON. It excludes commands, agents, and hooks. | New-session Skill/command appropriate to the chosen route and all six MCP connections. |
| **CodeBuddy CLI** | From the release root, enter `/plugin marketplace add <absolute-local-LazyBuddy-path>`, wait, then `/plugin install lazybuddy@lazybuddy` as a second action. | Interactive `/plugin` provides the same documented route. `--plugin-dir` is development/testing only, never persistent. | Fresh-session Skill/command and all six MCP connections. |
| **WorkBuddy** | The supplied prerelease build exposed a full plugin route; this observed-build route is not a public compatibility promise. | Skills-only import plus six manual local MCP connectors. It excludes commands, agents, and hooks. | One imported Skill plus every connector, or full-plugin capabilities only when the current loaded session proves them. |

`.codebuddy/settings.json` is shareable non-secret project scope.
`.codebuddy/settings.local.json` is ignored local/machine scope and remains
unstaged; secrets must never be committed. Package checks preserve both.

## Structural differences

The host adapter differs, but the safety model does not:

- **Host integration:** CodeBuddy and WorkBuddy decide plugin discovery, connector registration, session lifetime, and event delivery.
- **State/path:** package run state and receipt-owned tooling roots are local; marketplace directories, `.workbuddy` data, credentials, and connector state remain host/user-owned.
- **Inventory:** six local MCP servers are packaged. Optional remote exports and browser work remain separate explicit decisions.

## Package-built versus host-native behavior

| Behavior | LazyBuddy contribution | Raw host contribution | Learner takeaway |
| --- | --- | --- | --- |
| Workflow guidance | Ships skills, commands, and agent role text. | Decides whether/how those assets are discovered and exposed. | A Markdown command definition is not a running command. |
| Hook policy | Ships event mapping and scripts that validate supported input. | Delivers an event and decides the host lifecycle semantics. | A passing hook test does not prove a host delivered the event. |
| Local MCP | Ships six launchers and server programs. | Starts the process, negotiates connection, and shows tool availability. | A declaration is not a connection. |
| Run/evidence state | Implements package-local scripts and boundaries. | Supplies session context and user-visible integration. | Local records describe package work, not host state. |
| Optional providers | Implements policy, receipts, and export fragments. | Stores credentials and applies connector/network policy. | Selection/receipt status is not provider authorization or connection. |

The complete dependency classification is in [Dependency and host boundary reference](reference/dependency-and-host-boundaries.md).

## Readiness and fallback claims

The package contract uses four explicit evidence scopes: `package-ready`,
`observed-build-route`, `manual-skills-mcp-fallback`, and `live-host-proof`.
Load-check, doctor, and capability reports emit only `package-ready`; they do
not claim that a host loaded a plugin or connected an MCP process. A route seen
in one build is an `observed-build-route`, not universal host support.

The WorkBuddy fallback is Skills plus six manually configured local MCP
connectors. It explicitly excludes agents, commands, and hooks. It must not be
run alongside a full plugin route for the same project: coexistence is
unsupported and may duplicate Skills or MCP processes. Stop the session,
remove only the old LazyBuddy entries in the host UI, choose one route, restart,
and verify that route before making a live-host-proof claim.

## macOS-only scope

The package evidence is verified on macOS only. It does not claim equivalent host loading, marketplace behavior, hook execution, or MCP connection on other operating systems. Those are observed per host session.
