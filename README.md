# LazyBuddy

![LazyBuddy](lazybuddy-banner.jpg)

[![Package 1.4.0](https://img.shields.io/badge/package-1.4.0-7ce8d1)](RELEASE_NOTES.md)
[![MIT License](https://img.shields.io/badge/license-MIT-silver)](LICENSE)
[![LazySeries family](https://img.shields.io/badge/LazySeries-6_siblings-7ce8d1)](#lazyseries-family)

**Describe the work. Keep the plan. Prove the result.**

LazyBuddy helps you use structured, evidence-based workflows in **CodeBuddy
CLI**, **CodeBuddy IDE**, and **WorkBuddy**. It prepares local package assets
and guidance; a host is only considered ready after it is observed in a fresh
session.

[Platform status](docs/reference/platform-status-2026-10-27.md) · [Get started](#recommended-install-with-ai-help) · [Host routes](#choose-one-route) ·
[1.4.0 notes](RELEASE_NOTES.md) · [Family](#lazyseries-family) · [Docs](docs/)

> **Current package version: v1.4.0. HOST READINESS: PENDING.** Local checks and release
> archives prove package behavior; a fresh host session must prove loading,
> command/skill execution and MCP connections.

## What's in 1.4.0

- The family's portable dashboard core is vendored in `lazybuddy-plugin/shared/dashboard/` and pinned byte-identically in `lazybuddy-plugin/shared/dashboard.vendor.json`; this package is the family's vendoring source.
- The `status-dashboard` MCP server offers `dashboard_service` (start, inspect, stop, or return the local browser entry), `copy_task_context` (copy a validated producer context without executing or consuming it), and typed `project` operations alongside four status views.
- An authenticated loopback browser dashboard offers Work, Verification, and Plan-edit views with a task inspector, evidence preview, and queue planning; queue edits never start work.
- The completion pass redesigned the project dashboard end to end: design tokens v2 dark-first family language, a de-tabbed shell with a static retractable sidebar and in-place navigation, six audited views, navigation guards, measured-and-held performance budgets, and a comprehension re-measure that passes both targets; per-repo dashboard isolation and the canonical observe bridge landed beside it.
- Honest capability labels are documented: browser, transactional edits, project queue, context copy, and observations are available; host embedding, chat handoff, and wake are unobserved; native host readiness stays pending.

This release adds the shared dashboard surface to the workflow foundation
introduced in the family since v1.3.0. The details below describe the
cumulative v1.4.0 experience; the [release notes](RELEASE_NOTES.md)
distinguish this release's additions from inherited features. No new speed,
token-saving or cost claim is made.

| Family milestone | What you get in the current package |
| --- | --- |
| v1.3.0 foundation | Natural-language entry, editable plans, durable decisions and verification tiers. |
| v1.3.1 reliability | Clearer execution intent, safer isolation and evidence comparisons. |
| v1.3.2 handoff | Revision-bound verification-report contracts; generic completion APIs have separate limits. |
| v1.3.3 hardening | Host-specific hook, MCP and publication repairs. |
| v1.3.4 maintenance | Transactional run integrity, safer lifecycle and native adapter repairs. |
| v1.3.5 repairs | Real runtime exercises, bounded hooks, dependency updates and current platform guidance. |
| v1.4.0 dashboard | Vendored portable dashboard core, authenticated loopback browser UI, two new status-dashboard tools, queue planning and honest capability labels. |
| v1.4.0 completion | Redesigned project dashboard (dark-first family language, sidebar shell, in-place navigation), per-repo isolation and canonical observe bridge. |

### Just ask, or use a command — both work

Two entry routes converge on the same execution authority and gates:

- **Natural language**: describe the work plainly — "Fix the typo in the
  welcome label" — and the smallest sufficient workflow is selected and run.
- **Explicit commands**: `/lazy-ulw-plan <idea>` builds a new plan, and
  `/lazy-start-work <plan>` executes a known plan. Same authority, same gates.

No slash command is required for a clear implementation request. Conversely,
asking to *explain*, quoting a command, or saying "plan only" never touches
your files: the persisted `execution_intent` stays `plan_only` until you
actually ask for execution, and a vague "ok" with several open questions never
grants execution by itself.

### Plans you can edit while work runs

Plans are Markdown you own. Edit them mid-run; the harness reconciles your
changes at execution boundaries instead of overwriting them:

- Cosmetic wording and ordering edits preserve existing evidence.
- Semantic edits (acceptance, dependencies, verification commands) invalidate
  only the affected task and its dependents — unrelated work is untouched.
- Your checkbox is an *assertion*, not a verdict: a checked box alone never
  counts as verified completion, and unchecking reopens the task.

### Decisions the harness remembers

Cross-plan decisions live in a durable ledger (`.lazybuddy/decisions/ledger.jsonl`).
When plan two hits a question plan one already answered — with evidence — it
recalls the decision instead of re-asking you. Contradictions are surfaced as
supersessions, defects become scoped corrections that block only the affected
work, and nothing in memory can override your current instructions.

### Verification sized to the change

The workflow calls for verification sized to the change: a documentation
inspection (V0), a focused check (V1), an integration scenario (V2), or a
comprehensive security/release gate (V3, normally in CI). Valid evidence may be
reused while its inputs match; affected, missing or stale checks must rerun.
Native execution still needs acceptance in the selected host.

Milestones, decision gates, and full state/version semantics are shared
byte-identically with LazyTrae and LazyQoder (see
`lazybuddy-plugin/contracts/lazyseries-shared-semantics.v1.json`).

## Browser dashboard (v1.4.0)

LazyBuddy vendors the family's portable dashboard core in
`lazybuddy-plugin/shared/dashboard/` and pins its bytes in
`lazybuddy-plugin/shared/dashboard.vendor.json`. This package is the family's
vendoring source: `scripts/vendor-dashboard.mjs` distributes the tree, and
`.github/workflows/dashboard-family-drift.yml` is the LazyBuddy-run CI job that
rejects dashboard drift across the six sibling repositories. The 1.4.0
persistent project layer is vendored the same way as a second family tree:
`lazybuddy-plugin/shared/project/` is pinned in
`lazybuddy-plugin/shared/project.vendor.json` (31 files — the portable runtime
modules and QA harness; tests, native-identity QA, and fault hooks stay
Buddy-side by recorded decision), checked with `--family project`. The
current source tree includes the long-run monitor, research capture, Health
view and reported-usage telemetry. The dashboard vendor manifest records the
source tree digest; family synchronization must be checked independently and
is not implied by this source checkout.

The `status-dashboard` MCP server exposes seven tools: four status views,
`dashboard_service` (`start`, `status`, `stop`, `open`), `copy_task_context`,
and `project`. Context copying does not execute or consume work; project
operations use the typed shared command route.
The browser dashboard binds literal `127.0.0.1` on an owned loopback port,
requires an access key stored in a protected credential file, and offers Work,
Verification, and Plan-edit views with a task inspector, evidence preview, and
queue planning (create, amend, and reorder queued plans). Transactional edits
and the independent project queue are available; queue edits never start work,
and no endpoint dispatches execution.

### The project dashboard UI (as shipped after the completion pass)

After an explicit project init, the served dashboard mounts the project shell
— a tab-free single surface:

- **Static retractable sidebar**: a fixed column of destinations grouped
  WORKSPACE (Overview, Project, Plans) and OBSERVATION (Execution, Git,
  Evidence, Research), retractable to a 56px icon rail
  (Cmd/Ctrl+B, persisted), with projection-fed count badges on Overview and
  Plans. Selecting a destination replaces the content **in place**; item
  navigation (a plan, an evidence record) opens within the content region
  over a capped in-place history stack with a back affordance in the page
  header, and a dock inspector opens on the right for details.
- **Dark-first family design language**: the dashboard defaults to the dark
  theme (light/dark/system choice persists), on design tokens v2 — the
  shared family palette and depth system with LazyBuddy's cobalt accent
  marking identity and wayfinding only; status stays shape + icon + text.
- **Keyboard map** (the native experience layer, installed on every page):
  Tab keeps the native ring with an always-visible focus ring; `j`/`k`
  traverse list scopes with wrap; `/` focuses the first filter input;
  Escape closes the topmost overlay (dock, legend, dialog) and returns
  focus to the invoker; segmented controls take Arrow/Home/End;
  Cmd/Ctrl+1..7 jump to destinations; Cmd/Ctrl+B retracts the sidebar;
  theme (light/dark/system) and density (compact/regular) persist per
  browser. Navigation guards protect unsaved edits when you switch
  destinations.
- **Per-repo isolation**: each repository's dashboard stores (observations,
  admission rechecks, shell navigation) live under that repository's own
  root; the per-repo isolation and foreign-runtime refusal matrix
  (family-wide test) keeps a foreign runtime's writes out.

Honest capability labels: the browser UI, transactional edits, the project
queue, context copy, and observations are available in the package; host
embedding, chat handoff, and wake are unobserved; native host readiness stays
**pending**. The authoritative service contract — loopback binding,
authentication, command semantics, and the queue boundary — is
[shared/dashboard/SERVICE.md](lazybuddy-plugin/shared/dashboard/SERVICE.md),
with a package-level overview in
[Dashboard service](docs/reference/dashboard-service.md).

## Recommended: install with AI help

You do not need to manually work through every setup detail. Open an AI coding
assistant in your project and paste this:

> Help me install LazyBuddy from https://github.com/elvinzhao10/LazyBuddy for
> this project. Use v1.4.0 and follow AGENTS.md and the current install guide. Run safe package checks first,
> explain each step plainly, and ask me before changing marketplace, plugin,
> Skills, MCP, account, credential, or trust settings.

The assistant can guide onboarding, but you approve every host-managed change.

## Manual setup

Manual setup is available when you prefer complete control. You need
**Node.js LTS 24 (recommended) or 22 (supported alternative)** and **Git**, plus **Python 3.10+** available as `python3`. The lifecycle also accepts Node.js LTS 20 for compatibility. Start from the verified origin
`https://github.com/elvinzhao10/LazyBuddy` and follow the
[installation guide](docs/03-install-and-host-verification.md).

Run `onboard` once to create a durable installation. After that, use the stable
launcher for `update`, `status`, and safe `offboard`:

```text
node "<install-root>/LazyBuddy/launcher.js" status
```

## What “ready” means

- **Package readiness** means the copied package and local checks are valid.
- **Host readiness** needs a fresh host session, one real Skill or command,
  and every expected MCP connection.

Until that is observed, the honest result is **HOST READINESS: PENDING**.
Local files and load checks never prove that a host loaded the plugin.

The default package doctor does not discover or execute `codebuddy` from
`PATH`. Optional host-manifest validation is an explicit action using
`bash scripts/lazybuddy-plugin-doctor.sh --host-validator /absolute/path`.
The release verifier runs classified shell regressions serially, all package
`tests/*.test.js` with conservative Node concurrency, and Python tests under
`tests/` and `tooling/`; its JSON names those outcomes separately.

## Choose one route

Pick one host route during onboarding:

- **CodeBuddy CLI** uses the documented local marketplace route.
- **CodeBuddy IDE** uses that marketplace route when the CLI is available.
- **WorkBuddy** uses its full-plugin marketplace route.

Skills plus manual MCP connectors are a recovery-only option. Do not run that
fallback beside a full-plugin route for the same project. Stop the session,
remove only LazyBuddy's previous entries through the host UI, choose one route,
and start a new session to verify it.

## Design mindset

Start with the result you want and how you will know it worked. Then use the
smallest amount of structure that fits the task. You can simply describe the
work in plain language; the modes are guidance, not commands you need to
memorize. The v1.3.0 dual-entry routing picks one of these for you.

| Mode | Use it when | Example request |
| --- | --- | --- |
| Direct | The change is small and clear. | “Fix this error and run the relevant test.” |
| Assisted | You need help understanding an unfamiliar area or failure. | “Help me find why this command fails, then verify the fix.” |
| Planned | The work has several parts or important choices. | “Make a plan for this feature before changing files.” |
| Orchestrated | The work affects a release, security, or a risky change. | “Review this release and prepare it for publication.” |
| Long-horizon | The goal needs to continue across sessions. | “Keep working on this migration with checkpoints.” |

## Keep host changes deliberate

LazyBuddy does not automate credentials, OAuth values, private registries, or
trust settings. It asks for approval before any host-managed action and keeps
safe package checks separate from marketplace and connector changes.

## Package inventory

| Surface | Count | Role |
| --- | ---: | --- |
| Skills | 14 | Host-facing workflow policies for planning, execution, review, and verification. |
| Commands | 14 | Named host entry points for those workflow policies. |
| Agents | 13 | Specialist role definitions for planning, implementation, QA, security, and context. |
| MCP declarations | 6 | Local services for ledger, verification, status, context, code intelligence, and docs. |

## LazySeries family

**One workflow philosophy. Six host integrations.** Choose the sibling for the
host you use; each keeps its own native adapters, installation route and
acceptance evidence. These packages run independently.

| Sibling | Target host |
| --- | --- |
| [LazyBuddy](https://github.com/elvinzhao10/LazyBuddy) **← you are here** | CodeBuddy CLI / IDE · WorkBuddy |
| [LazyTrae](https://github.com/elvinzhao10/LazyTrae) | TraeCode / TraeWork / TraeCode CLI |
| [LazyQoder](https://github.com/elvinzhao10/LazyQoder) | Qoder CLI / IDE / app |
| [LazyZCode](https://github.com/elvinzhao10/LazyZCode) | ZCode |
| [LazyKimi](https://github.com/elvinzhao10/LazyKimi) | Kimi Code CLI · Kimi Work (experimental) |
| [LazyDeepSeek](https://github.com/elvinzhao10/LazyDeepSeek) | DeepSeek Harness 0.2.0-rc.2 |

The family shares planning, evidence, decision-memory and completion contracts.
The shared verification core and the portable dashboard core are vendored
byte-identically in every package (LazyBuddy is the vendoring source); product
adapters keep host setup and permissions explicit. Matching contracts do not
make host capabilities interchangeable. In particular,
Kimi Work remains experimental for LazyKimi, and DeepSeek's synthesized events
are not native hooks. Use each sibling's host guide before installation.

## Technical reference and evaluation

The source-level explanation lives in [docs/README.md](docs/README.md). It
maps the package structure, request flow, state model, security boundaries,
MCP lifecycle, and release checks with diagrams tied to the implementation.

For a capability-by-capability comparison with the original LazyCodex design,
including what LazyBuddy implements and where it intentionally differs, see
[lazybuddy-evaluation.md](lazybuddy-evaluation.md).

LazyBuddy is primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). Its
relationship to OmO and upstream sources is recorded in [NOTICE](NOTICE).
It is an independent implementation and does not require LazyCodex or OmO at
runtime.

## Learn more

- [Install and verify a host](docs/03-install-and-host-verification.md)
- [Remove receipt-owned assets safely](docs/08-safe-removal.md)
- [Browser dashboard service and boundaries](docs/reference/dashboard-service.md)
- [Workflow playbooks — how the modes pick work](docs/04-workflow-playbooks.md)
- [Evidence and completion — what "done" proves](docs/05-evidence-and-completion.md)
- [State and validation — how plan edits reconcile](docs/07a-state-and-validation.md)
- [Host routes and recovery](docs/reference/host-routes.md)
- [Release notes](RELEASE_NOTES.md)
- [Documentation index](docs/README.md)

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution and provenance.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for development checks, release expectations, and guidance for reporting
sanitized reproduction details. Report vulnerabilities privately according to
[SECURITY.md](SECURITY.md).
