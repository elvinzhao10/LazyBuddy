# Host capability matrix

LazyBuddy deliberately aligns policy and package safety across hosts while keeping host adapters distinct. The same package may be present on two surfaces without both hosts exposing the same loading or registration behavior.

## Onboarding baseline

Require **Node.js LTS 20 or newer** and **Git**. Bootstrap `onboard` only from
`https://github.com/elvinzhao10/LazyBuddy.git`; then run `update`, `status`,
and plan-first `offboard` with
`node "<install-root>/LazyBuddy/launcher.js"`. The durable tree is
`LazyBuddy/{active.json,launcher.js,releases/,receipts/,rollback/,staging/,locks/}`
and survives source deletion. Moving a same-version ref requires full-SHA
confirmation; stale runtime recovery is scoped offboard/re-onboard. None of
this proves a host: **HOST READINESS: PENDING** until observation.

Open or link the durable `v1.0.3` release in the selected host, give the agent
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`. The agent
detects or asks for CodeBuddy IDE, CodeBuddy CLI, or WorkBuddy, runs safe
package checks, and reports package readiness separately from host readiness.
Before a host-managed change it asks for approval, gives one exact action, and
waits. It then uses Computer Use or a user-pasted status/screenshot; reload or
new session is a later action. Verify one real Skill/command and all six MCP
connections. Without observation, **HOST READINESS: PENDING**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route and the preferred CodeBuddy IDE route whenever the CodeBuddy CLI is
available**. CodeBuddy IDE GUI loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback.

## What each host needs

| Host | Local route | Supported fallback | Required host proof |
| --- | --- | --- | --- |
| **CodeBuddy IDE** | When the CLI is available (`codebuddy`), use the user-scope release-root marketplace route shared with CodeBuddy CLI. The GUI route is only an observed-build alternative; the supplied GUI Add local directory flow failed. | Public Skills import plus manual MCP JSON when the CLI is unavailable. It excludes commands, agents, and hooks. | New-session Skill/command appropriate to the chosen route and all six MCP connections. |
| **CodeBuddy CLI** | Run durable `status --route codebuddy-marketplace`, then use its active durable release root with `codebuddy plugin marketplace add <active-durable-release-root>`; wait before `codebuddy plugin install lazybuddy@lazybuddy`. | Inside a CodeBuddy session, the interactive `/plugin` menu provides the same route. `--plugin-dir` is development/testing only, never persistent. | Fresh-session Skill/command and all six MCP connections. |
| **WorkBuddy** | Historical full-plugin observation only; no supported public installation contract was verified. | Skills-only import plus six manual local MCP connectors. It excludes commands, agents, and hooks. | One imported Skill plus every connector. The GUI Install action is broken in the supplied build. |

The supplied macOS QA dated 2026-07-18 inspected WorkBuddy v5.2.6 on macOS
with LazyBuddy `v1.0.3`; the CodeBuddy exact host version/build was not recorded.
For CodeBuddy IDE,
prefer the CLI marketplace route whenever available; the GUI local-directory
marketplace is only a fallback observed-build alternative. In WorkBuddy, do not
use the supplied GUI Install action: the supplied WorkBuddy v5.2.6 macOS QA observed success
after undocumented host-internal changes. That is feedback about one build,
not an installation route. Use the supported fallback. Fully restart and
verify a fresh session as later actions. If the required control is unavailable, record the exact
limitation and retain **HOST READINESS: PENDING**. The fallback's absolute
six-launcher JSON and explicit project context are in [Host routes](reference/host-routes.md#manual-connector-specification).

Before requesting that host mutation, run this read-only preflight from the
release root:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh \
  --project-dir <absolute-project-root>
```

It prints `HOST_PREPARATION=not-applied`, `HOST_MUTATION=none`, and
`HOST_READINESS=pending`; `--apply` refuses. It is not an installer and never
proves host readiness.

For the CodeBuddy IDE GUI alternative, wait for marketplace discovery, install
as a separate action, then fully restart before inspecting a fresh session.

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
