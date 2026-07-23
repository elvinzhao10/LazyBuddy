# LazyBuddy

![LazyBuddy](lazybuddy-banner.jpg)

LazyBuddy is a self-contained workflow harness for **CodeBuddy IDE**,
**CodeBuddy CLI**, and **WorkBuddy**. In the supplied macOS QA dated
2026-07-18, CodeBuddy IDE loaded the full plugin through the CLI-backed
user-scope marketplace route. WorkBuddy v5.2.6 on macOS loaded the full plugin
only after user-approved cache preparation followed by the durable GUI `+` binding.
The GUI Add local directory/Install flows failed in that tested build; the
CodeBuddy exact host version/build was not recorded. These are build-specific
observations, while
Skills/manual-MCP is the supported fallback.
It provides structured workflows for planning, implementation, verification,
review, and bounded long-running work.

It is verified on macOS only. Package checks prove the copied package and its
local contracts; a CodeBuddy or WorkBuddy session remains the authority for
plugin loading, hooks, and MCP connection.

## Start with the outcome

State the result you need, the acceptance criteria, and the surface that must
prove it. Use the smallest workflow that fits the uncertainty and risk:

| Situation | Ask for | Why |
| --- | --- | --- |
| Small, well-understood change | A normal request | Avoid process for process's sake. |
| Unfamiliar repository | `lazy-init-deep` | Establish project-local instructions and context. |
| Broad or ambiguous change | `lazy-ulw-plan` | Make decisions reviewable before editing. |
| Approved plan | `lazy-start-work` | Execute against explicit acceptance criteria. |
| Failure | “Debug why … fails” | Reproduce, compare hypotheses, and verify the fix. |
| Material-risk completion | `lazy-review-work` | Add independent quality, QA, security, and scope checks. |
| Long-running goal | `lazy-ulw-loop` | Keep durable state and checkpoints. |

In a CodeBuddy plugin session, commands are namespaced as
`/lazybuddy:lazy-<command>`. If the host does not expose slash commands, make
the same request in plain language.

## Adaptive harness (v1.0.3)

LazyBuddy v1.0.3 introduces an **adaptive harness** that selects the smallest
sufficient workflow for an outcome-based request, composes existing Skills,
agents, commands, MCPs, tools, hooks, and verifiers, persists an additive
single-writer snapshot, and explains material choices. Named workflows
(`lazy-ulw-plan`, `lazy-start-work`, `lazy-review-work`, `lazy-ulw-loop`,
`lazy-init-deep`, `lazy-verifier`, `lazy-ultrawork`) remain authoritative; an
explicit user request is never silently downgraded. In a CodeBuddy plugin
session, commands are namespaced as `/lazybuddy:lazy-<command>`; in WorkBuddy,
use the equivalent natural-language workflow or imported skill.

### Five modes

The harness selects the lowest mode that satisfies all identified risk,
uncertainty, continuation, and verification requirements.

| Mode | When selected |
| --- | --- |
| `direct` | Localized change, clear acceptance criteria, targeted verification sufficient. |
| `assisted` | Unfamiliar subsystem, cross-file tracing, primarily debugging, bounded implementation. |
| `planned` | Acceptance criteria incomplete, multi-system change, decisions must precede edits. |
| `orchestrated` | Security-sensitive, release/publication, destructive migration, or independent review required. Review responsibilities run automatically; only gated actions require approval. |
| `long-horizon` | Multi-session work, durable checkpoints, bounded continuation loop. |

### Automatic selection and explicit override

For an ordinary outcome request the classifier evaluates an ordered
seven-step policy (explicit user workflow → compatible continuation →
long-horizon → high-risk or multi-system → broad or ambiguous → unfamiliar or
diagnostic → small and clear) and selects the first match. An explicit named
workflow always wins; the classifier may only add required verification or
approval boundaries.

### Bounded escalation and capability fallback

Verification failure adds a debugging stage. A broader-scope failure may
escalate the mode by one level. No more than two automatic depth escalations
are permitted per decision; further failure produces a blocked-state record
with reproduced failure, attempted approaches, current evidence, and the exact
next user decision required. When a preferred capability is unavailable, the
harness selects a safe fallback in the same capability class, reports the
substitution, and weakens verification claims when the fallback is weaker — it
never claims equivalent evidence.

### Adaptive snapshot

The harness writes an additive, optional `adaptive` block inside existing
run/loop state (managed by `lazybuddy-plugin/scripts/state/`). The block
carries `version`, `decisionId`, `requestDigest`, `mode`, `stages`, `currentStage`,
`responsibilities`, `capabilityClasses`, `capabilitySubstitutions`, `approval`,
`escalationCount`, `escalationHistory`, `revisionFingerprint`,
`scopeFingerprint`, `hostFingerprint`, `risk`, `reasons`, `blocker`,
`nextAction`, and `verificationLevel`. Only the adaptive orchestrator writes
the block; existing pre-adaptive state without it continues to load.

### Authority

Read-only and package-owned capabilities, including selected review
responsibilities, activate automatically. Installing a dependency, persisting
a provider beyond the task, modifying host or marketplace settings, changing
MCP registrations, using credentials, using a paid service, sending repository
data to a remote provider, or controlling a browser surface all require
approval. `release-review` and `security-review` do not themselves require
approval; the requested concrete action determines the approval boundary.

### Full-plugin host mapping

CodeBuddy and WorkBuddy are treated as first-class full-plugin hosts. The
adapter maps each mode onto the existing Skills, agents, commands, hooks, and
all six declared MCP servers (`run-ledger`, `verification`, `status-dashboard`,
`context-graph`, `code-intel`, `docs`). The Skills/manual-MCP fallback is a
clearly degraded route that excludes commands, agents, and hooks; it is not
the adaptive architecture or default product target.

### Contract reference

The behavior-only contract is shared byte-identically with LazyTrae at
[`lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json`](lazybuddy-plugin/contracts/adaptive-harness-contract.v1.json),
paired with its JSON Schema and sha256 digest. Fixtures live under
`lazybuddy-plugin/contracts/fixtures/v103/`. The implementation lives in
`lazybuddy-plugin/tooling/lazybuddy_adaptive_*.py`. The full contract
semantics, authority levels, fallback rules, evidence labels, and known v1.0.3
gaps are documented in
[`docs/v1.0.3-adaptive-harness-contract.md`](docs/v1.0.3-adaptive-harness-contract.md).

## Design mindset

LazyBuddy treats a task as an evidence problem: define the observable outcome,
keep authority with the host and user, choose local tools before heavier
providers, and finish by exercising the surface the user actually cares about.
A passing unit test is useful evidence, not automatically proof of a CLI, API,
page, or host integration.

The package never turns its own readiness check into a claim about a running
host. It keeps package-owned state separate from marketplace state, host MCP
registrations, credentials, and live sessions.

## Install and onboard

Keep the pinned **v1.0.3** release in a permanent folder. Open or link that
folder in CodeBuddy or WorkBuddy, give the agent the GitHub repository link,
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard` in the agent
chat. Do not use a temporary copy or treat a package file as host proof:

```bash
git clone --branch v1.0.3 --depth 1 https://github.com/elvinzhao10/LazyBuddy.git /permanent/path/LazyBuddy
```

`onboard` detects or asks whether you use **CodeBuddy IDE**, **CodeBuddy CLI**,
or **WorkBuddy**, runs only safe package checks and local setup, and reports
**package readiness** separately from **host readiness**. Before any marketplace
trust/add, plugin install, Skills import, Settings connector, account, or
credential change it asks for approval. It then gives one exact host action and
waits; after you respond it inspects the app with Computer Use. Reload/new
session is a separate handoff. Host readiness requires one real Skill/command
and every expected MCP connection; without observation it stays **pending**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route and the preferred CodeBuddy IDE route whenever the CodeBuddy CLI is
available**. CodeBuddy IDE GUI loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. If Computer Use is unavailable, a user-pasted
verbatim status or screenshot can provide observation; otherwise **HOST
READINESS: PENDING**.

For CodeBuddy CLI, and for CodeBuddy IDE when the CLI is available
(`codebuddy`), use the release root containing
`.codebuddy-plugin/marketplace.json` and enter these in order, one approved
action at a time:

```text
codebuddy plugin marketplace add <absolute-release-root>
codebuddy plugin install lazybuddy@lazybuddy
```

Run these terminal commands against the absolute release root. Wait after
discovery, wait again after installation, then start a fresh session as a third
action and observe one Skill/command plus all six MCP connections.
`--plugin-dir <absolute-release-root>` is for development/testing only,
never persistent. Inside a CodeBuddy session, the interactive `/plugin` menu is
equivalent; do not use the slash forms as terminal commands.

CodeBuddy IDE's GUI Add local directory flow failed in the supplied build, so
use the CLI marketplace route above whenever the CLI is available. If the CLI
is unavailable, record that limitation and use the Skills/manual-MCP fallback;
the GUI flow is only an observed-build alternative and must be inspected before
installation. If selected, add the release root, wait for discovery, install
separately, fully restart the IDE, and verify a fresh session.

### WorkBuddy observed-build route

The supplied WorkBuddy build required user-approved filesystem preparation
followed by one durable GUI binding. Its GUI Install action hung in an
orphaned `plugin validate`. Do not click the GUI Install action or direct users
to it. Do not
hand-edit `known_marketplaces.json`, because those entries were dropped on
restart. Before asking for that approval, run this read-only, non-mutating preflight from
the release root:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-workbuddy-preparation-check.sh \
  --project-dir <absolute-project-root>
```

It only renders/checks the six absolute MCP launchers and project context,
prints `HOST_PREPARATION=not-applied`, `HOST_MUTATION=none`, and
`HOST_READINESS=pending`, and does not prepare the cache, register
`installed_plugins.json`, or prove host readiness. `--apply` refuses and makes
no host mutation because the WorkBuddy registry schema is private and
unverified. The supplied WorkBuddy v5.2.6 macOS QA observed the successful full-plugin route only
after an agent prepared a cache with the absolute MCP render and a registry
update, followed by the user's GUI `+` binding. Those artifacts are
build-specific evidence, not a generic installer recipe. Before any
host-managed cache or registry mutation, require both explicit user approval
and current host-specific schema inspection with a validated merge plan that
preserves all existing user entries and unknown fields. If that plan cannot be
established, stop and use the Skills/manual-MCP fallback. If it can be
established and the user approves, perform only that validated additive plan;
never overwrite an unrecognized registry or claim host readiness from the
mutation.

Then give exactly one GUI action: in WorkBuddy open **Skills → Plugins**, find
`lazybuddy`, and click **+**; wait for inspection. That `+` binding persisted
across restarts in the supplied build. As later separate actions, restart/open
a fresh project session and inspect one real Skill or command, 14 commands, 13
agents, 12 hooks, and live connections to all six MCP servers. If `+` is
unavailable after restart, use the fallback. That fallback provides Skills plus
six MCP connectors only and never commands, agents, or hooks.

The fallback for either desktop host is Skills-only import plus six individual
manual local MCP connectors. It excludes commands, Agents, and hooks. Its exact
six-entry connector JSON, including absolute launchers and project context, is
in [Host routes](docs/reference/host-routes.md#manual-connector-specification).
Do not run it beside a full plugin route: stop the session, remove only the old
LazyBuddy entries through the host UI, choose one route, start a new session,
and verify it. A copied repository or load-check output never establishes host
readiness.

Use `.codebuddy/settings.json` only for shareable non-secret project defaults.
`.codebuddy/settings.local.json` is ignored local/machine scope and must remain
unstaged; secrets must never be committed. Package checks preserve both files.

The repository link is [github.com/elvinzhao10/LazyBuddy](https://github.com/elvinzhao10/LazyBuddy),
and release notes are on the [v1.0.3 release page](https://github.com/elvinzhao10/LazyBuddy/releases/tag/v1.0.3).

## Verify and remove

`bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` reports **package
readiness** only. Type `offboard` for the matching safe-removal protocol; it
never guesses or removes host-managed paths.

For package command details and the optional tooling lifecycle, see
[lazybuddy-plugin/README.md](lazybuddy-plugin/README.md).

## Package inventory

| Surface | Count | Role |
| --- | ---: | --- |
| Skills | 14 | Host-facing workflow policies for planning, execution, review, and verification. |
| Commands | 14 | Named host entry points for those workflow policies. |
| Agents | 13 | Specialist role definitions for planning, implementation, QA, security, and context. |
| MCP declarations | 6 | Local services for ledger, verification, status, context, code intelligence, and docs. |

## Technical reference and evaluation

The source-level explanation lives in [docs/README.md](docs/README.md). It
maps the package structure, request flow, state model, security boundaries,
MCP lifecycle, and release checks with diagrams tied to the implementation.

For a capability-by-capability comparison with the original LazyCodex design,
including what LazyBuddy implements and where it intentionally differs, see
[lazybuddy-evaluation.md](lazybuddy-evaluation.md).

LazyBuddy is primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). Its
relationship to OmO and upstream sources is recorded in [NOTICE](NOTICE). It
is an independent implementation and does not require LazyCodex or OmO at
runtime.

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution and provenance.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for the development checks, release expectations, and guidance for reporting
sanitized reproduction details. Report vulnerabilities privately according to
[SECURITY.md](SECURITY.md).
