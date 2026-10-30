# Platform status — 2026-10-27

Historical snapshot: see [the 2026-10-30 audit](platform-status-2026-10-30.md) for current documentation and compatibility changes.

This is a documentation audit of LazyBuddy 1.4.0, not a claim that any host
loaded it. Public release indexes differ by locale: the current Chinese
indexes name newer versions than the English mirrors. The latest entries found
on 2026-10-27 are:

| Host | Latest public documented release found | Local read-only inventory | Current-session activation |
| --- | --- | --- | --- |
| CodeBuddy CLI | [2.177.0, 2026-10-26](https://www.codebuddy.cn/docs/cli/release-notes/README); [release detail](https://www.codebuddy.cn/docs/cli/release-notes/v2.177.0) | `codebuddy --version`: 2.124.0 | Pending |
| CodeBuddy IDE | [4.12.2, 2026-10-14](https://www.codebuddy.cn/docs/ide/release-notes/release-notes) | `/Applications/CodeBuddy.app` absent; other locations not inventoried | Pending |
| WorkBuddy | [5.9.2, 2026-10-26](https://free-plat-test.qcloudcdn.com/docs/workbuddy/Changelog) | `/Applications/WorkBuddy.app` bundle version 5.6.2 | Pending |

Versions are observations of published indexes, not proof that all editions or
regions receive the same build. The English CLI and IDE indexes lag the Chinese
indexes. Historical macOS host observations and their limitations remain in
[the earlier audit](platform-status-2026-10-02.md); the incremental
[2026-10-18 review](platform-status-2026-10-18.md) is retained.

## Feature-by-feature comparison

| Package surface | Official evidence and package assessment | Remaining proof |
| --- | --- | --- |
| Skills and commands | [Plugin reference](https://www.codebuddy.ai/docs/cli/plugins-reference) documents root-level Skills and commands. Package check finds 14 each. | Invoke one in a fresh session on each chosen route. WorkBuddy fallback only promises imported Skills. |
| Agents and delegation | The plugin reference documents agents; package check finds 13. Package task identity, cancellation and role boundaries are separate from host behavior. | Invoke a specialist and observe delegation and cancellation on the actual build. |
| Hooks | [Hooks reference](https://www.codebuddy.ai/docs/cli/hooks) labels hooks Beta and documents events and plugin-root paths. Package declares 25; plugin hooks merge with host hooks. Skill/agent frontmatter hooks have a distinct opt-in trust gate. | Observe events and payloads on the chosen build; no package check proves dispatch. |
| MCP and profiles | [Plugin reference](https://www.codebuddy.ai/docs/cli/plugins-reference) documents MCP declarations; WorkBuddy's [MCP guide](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide) describes connector settings. Six local servers are declared; the orchestrated status-dashboard server lists seven tools, including `project`. Profiles do not assert a live connection. | Observe all six connections and real calls; do not infer status from files. |
| Marketplace, settings, security | [Marketplace guide](https://www.codebuddy.ai/docs/cli/plugin-marketplaces) and plugin reference describe discovery and install. Package validation is separate from trust, configuration and host-managed removal. The WorkBuddy full-plugin descriptor is a package artifact, not a publicly established manifest contract. | Each host action and fresh-session receipt remain pending; no host settings were changed. |
| Lifecycle and recovery | Local durable onboarding, receipt-scoped offboarding and transaction recovery do not require a host version. Safe package checks do not establish plugin discovery. | Host-specific install, reload and removal remain separate observed actions. |
| Workflow selection, plan, execution, verification and evidence | Package selection chooses a workflow without claiming native dispatch. CLI [2.177.0](https://www.codebuddy.cn/docs/cli/release-notes/v2.177.0) adds session-level ACP Code Mode, which this package does not consume. | Verify real task outputs, cancellation and completion artifacts in the host. |
| Dashboard, sync, usage | Local dashboard and reconciliation use package state; usage is reported only when supported by evidence. IDE 4.12.2 explicitly excludes terminal-indirect changes from its change list, so inspect actual filesystem changes instead of treating that list as complete. | Host embedding, chat handoff, wake and live usage remain unobserved. |
| Packaging | The package checks validate the declared assets and versions, not vendor activation. No version bump or publication was performed. | Validate the eventual release archive and each actual host route separately. |

No host compatibility defect or performance improvement is claimed solely from
this documentation comparison. Current-session host readiness remains pending.

## Package checks on 2026-10-27

`lazybuddy-load-check.sh` reported package-ready (14 Skills, 14 commands,
13 agents, 25 hooks, six MCP declarations); `lazybuddy-plugin-doctor.sh`
passed 68 checks. Focused Node suites passed 60 host/route/hook tests, 48
lifecycle/evidence/efficiency-policy tests, and 15 dashboard monitor/Health/
telemetry tests. The post-edit marketplace/naming suite passed 13 tests and
`lazybuddy-docs-check.sh` reported 22 links with zero broken or policy
violations. These are local package tests, not native-host acceptance or a
new performance measurement. Dashboard tests require a supported Python:
with the system Python 3.9 one test failed importing `typing.TypeAlias`; it
passed with the supplied Python runtime on `PATH`.
