# LazyBuddy

![LazyBuddy](lazybuddy-banner.jpg)

LazyBuddy is a self-contained workflow harness for **CodeBuddy IDE**,
**CodeBuddy CLI**, and WorkBuddy's verified Skills/manual-MCP fallback. A full
WorkBuddy plugin/marketplace surface is conditional on real loaded-host proof.
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

Keep the pinned **v1.0.2** release in a permanent folder. Open or link that
folder in CodeBuddy or WorkBuddy, give the agent the GitHub repository link,
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard` in the agent
chat. Do not use a temporary copy or treat a package file as host proof:

```bash
git clone --branch v1.0.2 --depth 1 https://github.com/elvinzhao10/LazyBuddy.git /permanent/path/LazyBuddy
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
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. If Computer Use is unavailable, a user-pasted
verbatim status or screenshot can provide observation; otherwise **HOST
READINESS: PENDING**.

For CodeBuddy CLI, use the release root containing
`.codebuddy-plugin/marketplace.json` and enter these in order, one approved
action at a time:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

Wait after discovery, wait again after installation, then start a fresh
session as a third action and observe one Skill/command plus all six MCP
connections. `--plugin-dir <absolute-local-LazyBuddy-path>` is for
development/testing only, never persistent. The interactive `/plugin` menu is
equivalent.

CodeBuddy IDE's public fallback is Skills import plus manual MCP JSON; its
plugin flow remains build-specific until observed. WorkBuddy's supported
fallback is the same Skills-only import plus six individual manual local MCP
connectors. The fallback excludes commands, agents, and hooks. Do not run it
beside a full plugin route: stop the session, remove only the old LazyBuddy
entries through the host UI, choose one route, start a new session, and verify
it. A copied repository or load-check output never establishes host readiness.

Use `.codebuddy/settings.json` only for shareable non-secret project defaults.
`.codebuddy/settings.local.json` is ignored local/machine scope and must remain
unstaged; secrets must never be committed. Package checks preserve both files.

The repository link is [github.com/elvinzhao10/LazyBuddy](https://github.com/elvinzhao10/LazyBuddy),
and release notes are on the [v1.0.2 release page](https://github.com/elvinzhao10/LazyBuddy/releases/tag/v1.0.2).

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
