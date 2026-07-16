# LazyBuddy

![LazyBuddy](lazybuddy-banner.jpg)

LazyBuddy is a self-contained workflow harness for **CodeBuddy IDE**,
**CodeBuddy CLI**, and the documented **WorkBuddy** plugin/marketplace surface.
This public repository is also a code-study project: it shows how an agent
harness turns a request into durable state, bounded execution, evidence, and
host-facing declarations without treating host state as package-owned state.

LazyBuddy is a learning project for studying safe, evidence-led agent
workflows on CodeBuddy and WorkBuddy, primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). Its
relationship to OmO and the upstream sources is recorded in [NOTICE](NOTICE).
It is an independent implementation and does not require LazyCodex or OmO at
runtime.

> **Study the implementation:** [docs/README.md](docs/README.md), then
> [the package map](docs/07-package-map.md), [state and validation](docs/07a-state-and-validation.md),
> [MCP lifecycle](docs/07b-mcp-lifecycle.md), and [verification](docs/09-test-and-release-verification.md).
>
> **Install and host setup:** [AGENTS.md](AGENTS.md).
>
> **Package commands and tooling lifecycle:** [lazybuddy-plugin/README.md](lazybuddy-plugin/README.md).
>
> **Learner guide:** [docs/README.md](docs/README.md).

LazyBuddy is verified on macOS only. Package checks prove copied package assets
and contracts; a real CodeBuddy or WorkBuddy session is still the authority for
plugin loading, hooks, and MCP connection.

## How to study the harness

Read the repository as a pipeline rather than as a menu of commands:

```text
host event or request
        │
        ├── skills / commands explain the intended workflow
        ├── agents divide planning, implementation, QA, and review roles
        ├── hooks inspect structured host events and enforce local policy
        ├── scripts own receipts, bounded verification, and package readiness
        └── MCP servers expose narrow stdio tools after a host connects
```

The important implementation boundary is ownership. `lazybuddy-plugin/` is the
standalone distributable unit. It owns its templates, scripts, declarations,
and receipt-managed tooling roots. A host owns marketplace state, loaded
plugins, session hooks, MCP registration, credentials, and every live
connection. The harness records package evidence, but never upgrades that
evidence into a claim about a running host session.

Start with [docs/07-package-map.md](docs/07-package-map.md) for the source
layout, [docs/06a-security-and-authority.md](docs/06a-security-and-authority.md)
for input and authority boundaries, and
[docs/09-test-and-release-verification.md](docs/09-test-and-release-verification.md)
for the evidence pipeline. The remainder of this README describes the host
surface those components support.

## Host-facing workflow

Describe the outcome, its acceptance criteria, and the surface that should
prove it works. For a focused change, ask normally. For uncertain or
multi-file work, ask for a plan, approve it, then run the planned workflow.

```text
/lazybuddy:lazy-init-deep                    # understand a new repository
/lazybuddy:lazy-ulw-plan "add project search" # make an approval-ready plan
# review and approve the plan
/lazybuddy:lazy-start-work                    # execute with evidence
/lazybuddy:lazy-review-work                   # independent review for significant work
```

In a CodeBuddy plugin session, commands are namespaced as
`/lazybuddy:lazy-<command>`. If a host does not expose slash commands, make the
same request in plain language. The workflow is deliberately proportional:
use a normal request for a small task, planning for ambiguity, and the durable
loop only for long-running goals.

## First task workflow

Start with a request like:

> Add project search. Results must work on a real project, have tests, and be
> checked in the user interface before completion.

LazyBuddy then selects the smallest relevant playbook: project memory for an
unfamiliar repository, a plan for broad work, debugging for a failure,
verification for a completed change, and a review gate for material risk. The
agent should not treat a passing unit test as the whole result: it should also
exercise the matching CLI, page, API, or other user surface.

| Need | Use | Result |
|---|---|---|
| New or confusing repository | `/lazybuddy:lazy-init-deep` | Local project memory and instructions. |
| Multi-file or architectural change | `/lazybuddy:lazy-ulw-plan "…"` | A decision-ready plan before edits. |
| Approved plan | `/lazybuddy:lazy-start-work` | Delegated execution with evidence. |
| Failure | “Debug why … fails” | Reproduction, competing hypotheses, and a verified fix. |
| Behavior-preserving cleanup | “Refactor … without changing behavior” | Narrow change with regression protection. |
| Significant completion | `/lazybuddy:lazy-review-work` | Independent goal, QA, quality, security, and context review. |
| Long-running outcome | `/lazybuddy:lazy-ulw-loop "…"` | Checkpointed progress until evidence supports completion. |

## Install paths and proof

Run `onboard` after opening a copied repository in the host. It chooses one
host path and runs the package load check.

| Host | Install path | What you must observe afterwards |
|---|---|---|
| CodeBuddy IDE | Host plugin UI, then reload if the host offers it | A `lazybuddy` skill or command and MCP status in a new session. |
| CodeBuddy CLI | Marketplace installation and a new CLI session | Plugin and MCP activation in that session. |
| WorkBuddy | Documented plugin/marketplace UI | A loaded plugin session before relying on hooks, commands, agents, or MCP. |
| WorkBuddy local fallback | Import `lazybuddy-plugin/skills/` through the Skills UI and add connectors manually | An imported skill and each manual connector in host settings. |

The WorkBuddy copied-repository plugin installer is not verified. The local
skills import is the verified no-package-manager fallback; it does not claim
that hooks, agents, commands, or MCP declarations automatically loaded.

`bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` reports **package
readiness**: the manifests, inventories, local MCP declarations, and tooling
contract are present. It cannot prove SessionStart, marketplace installation,
hook execution, or a live MCP connection. Treat the host observation as a
separate final step.

## Automatic tooling and MCP boundaries

LazyBuddy's unusual feature is a package-owned capability policy that can
choose a **temporary, task-scoped** local capability without modifying the
project, host configuration, lockfiles, or global tools. It starts local-first:

| Task need | Capability |
|---|---|
| Exact local text/file search | `rg` (ripgrep) |
| Structural code search or repeated safe edits | `sg` (ast-grep) |
| Definitions, references, types, symbols, diagnostics | JavaScript/TypeScript or Python LSP bridge |
| Architecture or cross-file dependency mapping | CodeGraph, only after its explicit lifecycle |
| Correctness confirmation | The repository's declared lint, typecheck, test, and build commands |

When a compatible local tool is missing, the tooling script may provision a
locked fallback only inside an explicit, empty, absolute **receipt-owned
tooling root**. The receipt records what LazyBuddy created; uninstall removes
only an exact unmodified owned root and preserves caller-owned, project,
linked, modified, and host-managed paths. Normal detection, status, doctor,
and readiness are offline and do not start a provider.

Six local MCP declarations ship with the package: `run-ledger`, `verification`,
`status-dashboard`, `context-graph`, `code-intel`, and `docs`.
`context-graph` is a grep-based heuristic fallback, not semantic CodeGraph.
Filesystem and Playwright are outside that six-server inventory.

Automatic selection never creates a persistent host registration. Persistent
or remote actions are deliberately separate:

- **CodeGraph** is optional and requires explicit `codegraph-install`,
  `codegraph-init`, and `codegraph-enable` steps before an exported MCP
  fragment can be manually merged in the host. It never auto-indexes,
  auto-starts, or enables telemetry.
- **Context7** and experimental, unpinned **grep_app** are remote capabilities.
  They stay disabled until an explicit `remote-enable`; `remote-export-mcp`
  prints only a namespaced merge fragment for the host UI. Remote requests can
  egress data or incur cost; credentials remain in the user's host environment.
- **Playwright** is browser automation and requires an explicit approval
  decision. It is not bundled as a local MCP server and is never started
  automatically.

Use the detailed [tooling guide](lazybuddy-plugin/README.md#optional-local-tooling)
for exact commands, approvals, status output, and receipt-safe removal.

## What is included

| Component | Inventory | Why it exists |
|---|---:|---|
| Skills | 14 | Reusable playbooks for planning, execution, debugging, review, and verification. |
| Commands | 14 | Named CodeBuddy workflow entry points. |
| Agents | 13 | Focused roles for planning, implementation, verification, review, QA, security, and context. |
| Hook events | 12 | Host-side policy and lifecycle checks after a host loads the package. |
| Local MCP declarations | 6 | Package-local ledgers, verification, status, heuristic context, code intelligence, and docs. |

The Stop, SubagentStop, and PreToolUse hooks are host integrations: they matter
only after the host reports the package as loaded. The package itself never
uses that claim as proof of a live session.

## Remove safely

Type `offboard` for the host-specific removal protocol. Remove LazyBuddy using
the selected host's plugin, marketplace, or Skills UI, then remove only the
LazyBuddy MCP connectors that you personally added. LazyBuddy never searches
for or guesses host-managed installation paths.

For WorkBuddy's local fallback, remove imported skills through the Skills UI
and manual connectors through Settings. Do not delete `.workbuddy-plugin`,
`.workbuddy`, shared MCP metadata, or another host's files to simulate an
uninstall. Keep the copied repository until you observe host removal; then it
can be deleted independently. Receipt-owned local tooling can be removed only
with the package's documented lifecycle command.

## Repository map and evidence

`lazybuddy-plugin/` is the self-contained installable package: skills,
commands, agents, hooks, MCP servers, templates, tooling policy, and scripts
must work without the repository root's documentation. The public learning map
is this README; package verification evidence is in
[lazybuddy-evaluation.md](lazybuddy-evaluation.md) and the package
[verification matrix](lazybuddy-plugin/docs/verification-matrix.md).

## License and attribution

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution and provenance.
