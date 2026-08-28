# LazyBuddy verification evidence

This document records public, present-tense evidence for the LazyBuddy package.
It is not evidence that a specific CodeBuddy or WorkBuddy session has loaded a
plugin. Verification is on macOS only.

## Current documentation status: v1.2.0

The v1.2.0 documentation boundary covers `codebuddy-cli`, `codebuddy-ide`, and
`workbuddy`; it does not publish or alter a package. For CodeBuddy IDE and
WorkBuddy, marketplace is the default full-plugin route. The manual
Skills/MCP route is recovery-only and mutually exclusive with the full-plugin
route for one project. Package readiness does not prove a live host.

v2 receipts use `invoke-documented`, `observe-only`, `descriptor-only`, and
`unavailable` native modes; `documented-tested`, `documented-untested`,
`observed-build-specific`, and `unavailable` public labels; and `package`,
`probe`, and `current-session` evidence scopes.

## Project purpose and attribution

LazyBuddy is a learning project for evidence-led agent workflows. It is
primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). OmO upstream
attribution is recorded in [NOTICE](NOTICE). The package is an independent
implementation and does not require LazyCodex or OmO at runtime.

## Implemented package behavior

LazyBuddy packages 14 `lazy-` skills, 14 command workflows, 13 agents, 12
hook-event declarations, and six local MCP declarations: `run-ledger`,
`verification`, `status-dashboard`, `context-graph`, `code-intel`, and
`docs`. The package checks validate manifests, component inventory, JSON,
executable MCP scripts, internal Markdown links, hook/security behavior, MCP
protocol regressions, and the automatic-tooling contract.

`bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` reports
`PACKAGE_READINESS=full` when the copied package assets and local contracts
are complete. `lazybuddy-plugin-doctor.sh` and
`lazybuddy-plugin/scripts/lazybuddy-verify.sh` provide package health and an
aggregate verification gate. These commands are evidence about the package,
not a host session.

The `docs` MCP boundary accepts validated npm or PyPI package names and
requests only the fixed HTTPS npm or PyPI registry endpoint. Redirects and
metadata URLs such as a package homepage, repository, or documentation link
are not followed. Structured `Write` and `Edit` secret protection examines
only the supported target-path fields; text that merely mentions a secret-like
filename is not a target. `Bash` retains its conservative literal scan, so a
command that merely contains such a path can still be denied.

InitDeep can use an explicitly supplied absolute `CODEBUDDY_PLUGIN_ROOT` from
an unrelated workspace. It does not search parents, siblings, marketplaces,
or the filesystem for another plugin. A parent marketplace file may be read
only to compare its entry version with the already selected root; this is
metadata validation, not root discovery or host proof.

Aggregate verification emits bounded per-check status and reason. A deadline
is a failure, an absent CodeBuddy validator is **UNCHECKED**, and a validator
timeout, launch failure, nonzero result, or semantic failure never becomes a
host-success claim.

For trusted package-owned verification commands, each bounded check starts in
its own process group. A deadline triggers best-effort termination of that
owned group, and the JSON/stderr result reports whether descendants were still
detectable at cleanup time. This is not a security sandbox and does not
guarantee all descendants are gone; genuinely untrusted commands require a VM or container-backed runner. A no-fork sandbox is not enabled by default.

The package's local-first tooling policy detects compatible `rg` and `sg`,
supports JavaScript/TypeScript and Python LSP navigation, and recognizes
declared repository-native verification. A missing provider can be installed
only in a caller-selected empty receipt-owned root; verification never mutates
a target manifest, lockfile, global tool, or host configuration.

## Host support and required observation

| Surface | Package evidence | Required user observation |
|---|---|---|
| CodeBuddy IDE | Copyable package, manifest, local checks, and six MCP declarations. | Install with the host plugin flow, reload if offered, then confirm a LazyBuddy skill/command and MCP status in a new session. |
| CodeBuddy CLI | Marketplace commands and package validation are documented. | Install through the host, start a new session, and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Compatibility metadata and package assets are present. | Use the documented UI/marketplace and confirm a loaded session before relying on plugin capabilities. |
| WorkBuddy local fallback | `lazybuddy-plugin/skills/` is the verified no-package-manager import source. | Import skills through Skills UI and add each compatible MCP connector manually in Settings. |

The copied repository is not a verified WorkBuddy plugin installer. Package
readiness cannot prove SessionStart, hook execution, marketplace activation, a
live session, or MCP connection.

## Public capability status contract

`lazybuddy-tooling.sh` status, load-check, doctor, and provider reports are
read-only canonical package evidence. They report assets, capability eligibility,
policy, and receipt state without provider execution, optional activation, host
registration, or a claim that a live host loaded the package.

## Optional capability policy

Automatic task routing is temporary and nonpersistent. It selects the lightest
eligible local capability for the task without writing host/project
configuration or lockfiles. Context7 and experimental, unpinned `grep_app`
are remote exports that require explicit selection; any export is namespaced,
manual to merge, and contains no credential. Remote calls can egress data or
incur cost.

CodeGraph is optional architecture exploration with its own explicit
install/init/enable lifecycle. It is not automatically indexed, launched,
registered, or telemetered. Playwright requires explicit browser approval and
is outside the bundled local MCP inventory. `context-graph` is a heuristic
grep fallback, not CodeGraph.

## Receipt and safe removal

Receipt ownership is enforced for package tooling. Only an exact, unmodified
receipt-owned root can be removed. Modified, foreign, linked, caller-owned,
project, and host-managed paths are preserved. This boundary protects local
tooling and does not authorize removal of host plugin, marketplace, MCP, or
credential state.

Migration is route replacement: stop the session; remove only LazyBuddy's
receipt-scoped plugin/Skills entry and manually added connectors through the
host UI; select one route; then verify it in a fresh session. Do not scan or
edit private host registries, automate trust, bypass permissions, or place
credentials in configuration examples.

## Package readiness versus host verification

Package readiness validates copied contents, declarations, inventories, and
local contracts. It does not prove host discovery, SessionStart, hooks,
marketplace installation, a running session, or MCP connection. The host
observation in the support table is required before making an integration
claim.

## JSON-RPC resilience

The six packaged local MCP endpoints have JSON-RPC stream regression coverage,
including malformed input and subsequent-request behavior. This is protocol
evidence for the package, not proof that a host process launched or connected
an endpoint.

## Learner references

The complete 21-page learner tree starts at [docs/README.md](docs/README.md).
Use [security and authority](docs/06a-security-and-authority.md) for the
registry, secret-path, and explicit-root boundaries, then [state and
validation](docs/07a-state-and-validation.md) and [test and release
verification](docs/09-test-and-release-verification.md) for bounded-status
and release-evidence vocabulary.

## Host-specific exclusions

- **Host integration:** CodeBuddy IDE/CLI use host plugin flows; WorkBuddy uses
  its UI/marketplace or local skills with manual connectors.
- **State/path:** tooling roots are package receipt-owned; `.workbuddy`,
  host plugin locations, host MCP entries, and credentials remain host/user
  state and are never guessed or deleted.
- **Inventory:** six local MCP servers are bundled. Context7 and `grep_app`
  are optional export fragments; filesystem and Playwright are not bundled
  local MCP servers.

## Known unverified host behavior

Live plugin discovery, marketplace behavior, hook execution, SessionStart, and
MCP connection remain user-observed host behavior. WorkBuddy's copied-repo
plugin installation is not verified; the local import fallback intentionally
requires manual MCP configuration.

## macOS verification scope

LazyBuddy is verified on macOS only. Normal CI does not require a sibling
repository. Release-only paired parity receives explicitly supplied sibling
roots as release evidence and never creates a runtime or installation
dependency.

## Attribution and limits

[NOTICE](NOTICE) and [LICENSE](LICENSE) are the attribution and license
records. This evidence describes the package's tested boundaries and does not
claim host behavior beyond the required manual observations.

## Comparison with the upstream reference harness

The reference named in the attribution above publicly describes project memory,
planning, execution, verified completion, specialized skills, hooks,
diagnostics, and multi-agent roles. The comparison below is a capability
comparison, not a compatibility or drop-in replacement claim.

| Reference capability family | LazyBuddy realization | Deliberate difference or limitation |
| --- | --- | --- |
| Project memory | `lazy-init-deep`, managed agent instructions, and explicit plugin-root selection. | No automatic parent/sibling or marketplace discovery; host loading remains unverified until observed. |
| Planning and durable execution | Plan, start-work, loop, evidence, and verifier instruction surfaces. | The host decides whether commands, hooks, and agents are actually available in a session. |
| Specialized roles and review | Packaged planning, implementation, QA, security, context, and verifier roles. | Role definitions are package assets; they are not evidence that a host spawned a role. |
| Hooks and lifecycle | Declared hook events plus structured pre/post-tool policy scripts. | Hooks are host-governed and are not an enforcement boundary until the host reports them loaded. |
| Local development tooling | Local-first ripgrep, ast-grep, LSP, repository-native verification, and optional CodeGraph lifecycle. | Remote Context7 and grep_app remain explicit opt-in exports; filesystem and Playwright are not bundled local MCP servers. |
| Diagnostics and removal | Load-check, doctor, aggregate verifier, receipts, and conservative removal. | Results establish package readiness, not marketplace activation, live session behavior, or MCP connection. |
| Installation model | A self-contained CodeBuddy/WorkBuddy package with manual host steps. | It intentionally does not reproduce the reference harness's installer, managed global configuration, provisioning, model routing, or automatic host mutation. |

The upstream project is a useful architectural reference, but LazyBuddy keeps a
smaller ownership model: package-owned assets are verifiable and removable;
host-owned settings and live integrations require an explicit user observation.
