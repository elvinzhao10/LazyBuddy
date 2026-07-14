# LazyBuddy

> **A practice project:** a self-contained workflow harness for [WorkBuddy](https://www.workbuddy.cn), CodeBuddy IDE, and CodeBuddy CLI. No longer maintained; open-sourced for learning.

LazyBuddy provides disciplined planning, delegated execution, evidence-gated verification, review, and durable run-state workflows for **CodeBuddy IDE**, **CodeBuddy CLI**, and **WorkBuddy**. WorkBuddy documents plugin/marketplace capabilities, but this release has not verified a direct copied-repository LazyBuddy installer; its verified no-package-manager path is local skill import plus manual MCP configuration.

**Repository state:** v0.17 alignment candidate. Published package manifests
remain v0.16.0-alpha.1 until a separate release-version bump; candidate checks
are verified on macOS only.

> **Setup?** See [AGENTS.md](AGENTS.md) (the setup guide). This README is about **how to use** the harness once installed.

> **Repository map?** See [docs/handoff.md](docs/handoff.md). Private legacy
> root documentation belongs in ignored `dev/docs/root/`.

## Onboard with AI

1. Copy or clone [github.com/elvinzhao10/LazyBuddy](https://github.com/elvinzhao10/LazyBuddy) into a local folder.
2. Open that folder in your chosen host and type `onboard`.

The agent reads `AGENTS.md`, asks which installed host you use (**WorkBuddy**, **CodeBuddy IDE**, or **CodeBuddy CLI**), then performs the matching safe setup steps. It runs `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` and reports **package readiness**—the shared folders and CodeBuddy declarations are present. That check does not prove that a host loaded the package, emitted SessionStart, or connected an MCP server. A CodeBuddy SessionStart hook repeats that check only after CodeBuddy loads the plugin. For WorkBuddy, use its documented plugin/marketplace UI and verify the loaded session before relying on plugin capabilities; the verified no-package-manager fallback is local skill import with manual MCP connector configuration.

After onboarding, you can delete the copied repository if you only needed the installed setup, or keep it to explore and study how LazyBuddy works.

## Uninstall safely

Remove LazyBuddy through the selected host's plugin, marketplace, or Skills UI. LazyBuddy never guesses or deletes host-managed installation paths. In CodeBuddy IDE or CLI, use the host's plugin removal flow and then remove or disable only the LazyBuddy MCP servers you explicitly registered. In WorkBuddy, use its documented plugin/marketplace removal flow; for the verified local-import fallback, remove the imported `lazybuddy-plugin/skills/` entries through the Skills UI and remove the manual connectors in Settings. Do not delete `.workbuddy-plugin`, `.workbuddy`, MCP metadata, or another host's files to simulate uninstall. Keep the cloned repository until the host confirms removal; it can then be deleted independently.

## Optional v0.16 tooling

LazyBuddy's package-owned tooling selects the lightest useful capability:
local `rg` search, `sg` structural search, supported JavaScript/TypeScript or
Python LSP navigation, and repository-native verification are local-first.
CodeGraph is explicit for large-repository architecture work. Context7 is
explicit for current library documentation, while experimental, unpinned
`grep_app` is explicit for public-code examples when local evidence is not
enough. Context7 and `grep_app` are disabled by default; normal install,
status, and doctor stay offline. Their exported, namespaced MCP fragment has
endpoints only, so host environment credentials are never written or logged.
See the package [tooling guide](lazybuddy-plugin/README.md#optional-remote-documentation-and-example-search).

Automatic selection is temporary and task-scoped: it uses the packaged
provider contract without changing host MCP configuration. `setup` and
`providers` report provider cost, reachability, approval, and
credential-reference state; they do not contact remote providers. Persistent
compatibility remains explicit: `remote-enable` records an optional Context7
or `grep_app` selection in a verified tooling root, while `remote-export-mcp`
only prints a namespaced fragment for manual host-UI merging. Remote calls may
egress data or incur cost even if read-only. Browser automation (Playwright)
and CodeGraph require their own approval or explicit lifecycle steps; neither
is started or registered automatically. The package guide documents the exact
commands and receipt-safe tooling uninstall.

## A first task, from request to evidence

Start by describing the outcome and how you will recognize success, not the commands you think the agent should run. For example:

> Add project search. Results must work on a real project, have tests, and be checked in the UI before you call it done.

For a small, well-bounded change, ask normally. The agent should select the relevant skills from the task. For a larger or uncertain task, use this path:

```text
/lazybuddy:lazy-init-deep               # once for a new or unfamiliar repository
/lazybuddy:lazy-ulw-plan "add project search" # explore, decide, and write the plan
# review and approve the plan
/lazybuddy:lazy-start-work              # execute the planned work with evidence
/lazybuddy:lazy-review-work             # independently review significant work
```

In a CodeBuddy-installed plugin, commands are namespaced as `/lazybuddy:lazy-<command>`; use natural-language requests when the host does not expose slash commands. Use `/lazybuddy:lazy-ulw-loop "goal"` only when the outcome is long-running or open-ended and needs checkpoints. Use `/lazybuddy:lazy-ultrawork "task"` when a change needs maximum precision and an evidence-grade review gate. Finish any meaningful change with the real user surface as well as automated checks: run the CLI, use the page, or exercise the API. A passing test alone is evidence, not the whole result.

## Choosing skills and commands

Skills are the agent's playbooks. You normally invoke them by stating the job in plain language; use a slash command when you want to force a particular workflow.

| Situation | Say or run | Why |
|---|---|---|
| New or confusing repository | `/lazybuddy:lazy-init-deep` | Builds project memory and local instructions before work starts. |
| Multi-file, ambiguous, or architectural work | `/lazybuddy:lazy-ulw-plan "…"` | Produces a decision-complete plan before changing code. |
| An approved plan | `/lazybuddy:lazy-start-work` | Delegates planned work and verifies its evidence. |
| A bug | “Debug why … fails” | Selects the debugging playbook: reproduce, form hypotheses, then fix and prove it. |
| Behavior-preserving cleanup | “Refactor … without changing behavior” | Uses the refactor discipline; keep verification in place. |
| Git work | “Commit these changes” | Uses the Git workflow to inspect, stage, and commit intentionally. |
| A large finished change | `/lazybuddy:lazy-review-work` | Runs independent goal, QA, quality, security, and context review. |
| A long-running goal | `/lazybuddy:lazy-ulw-loop "…"` | Keeps durable state and continues until evidence proves completion. |

The mindset is simple: choose the **smallest** workflow that matches the risk, make acceptance criteria explicit, and do not accept “done” without observable evidence. The agent should ask for a decision only when it genuinely needs the project owner's choice.

## Commands

All command files are `lazy-` prefixed. In CodeBuddy's installed plugin surface, invoke them as `/lazybuddy:lazy-<command>` (for example, `/lazybuddy:lazy-init-deep`); a host that does not expose plugin slash commands should receive the equivalent natural-language request. `/lazybuddy:lazy-verifier`, `/lazybuddy:lazy-reviewer`, and `/lazybuddy:lazy-librarian` are targeted workflows for verification, review, and project memory.

## CodeBuddy enforcement

**Binding via CodeBuddy host hooks** (the inverse of the LazyTrae sibling's CLI-gate strategy):
- **Stop hook** — blocks session end if plan checkboxes remain unchecked.
- **SubagentStop hook** — validates `EVIDENCE_RECORDED` paths (inside root, exists, non-empty, not symlink).
- **PreToolUse hook** — blocks `rm -rf`, secret paths, force pushes, unauthorized publishes.

## What's included

| Component | Count | Examples |
|---|---|---|
| CodeBuddy skills | 14 | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-programming, lazy-git-master, lazy-debugging, lazy-remove-ai-slops |
| CodeBuddy agents | 13 | orchestrator, planner, explorer, implementer, verifier, reviewer, qa-executor, gate-reviewer, librarian, migration-planner, context-indexer, security-auditor, context-miner |
| CodeBuddy commands | 14 current workflows | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-new-run, lazy-status, lazy-resume, lazy-verify |
| CodeBuddy hooks | 12 | Stop, SubagentStop, PreToolUse, + 9 lifecycle |
| CodeBuddy MCP declarations | 6 | run-ledger, verification, status-dashboard, context-graph, code-intel, docs |
| WorkBuddy | documented plugin/marketplace UI or 14-skill local import | plugin capabilities require session verification; verified local fallback is `lazybuddy-plugin/skills/` plus manual MCP |

## Developing on this repo (open-source)

Practice repo; contributions welcome as learning exercises.

1. **Structure:** `lazybuddy-plugin/` is the plugin (skills/, commands/, agents/, hooks/, mcp/, scripts/). State lives in `.lazybuddy/runs/<run_id>/`.
2. **Naming discipline:** all skills & commands are `lazy-` prefixed. Keep new ones prefixed.
3. **Test/verify:** `bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh` + `bash lazybuddy-plugin/scripts/lazybuddy-smoke-test.sh`. Update the doctor's expected component lists if you add or rename one.
4. **Hooks are binding:** test with doctor + smoke after any hook change.
5. **Commit:** conventional, atomic, stage only files you changed, no `--no-verify`.

## Repository structure

```
lazybuddy/
├── .codebuddy-plugin/    # CodeBuddy marketplace entry
├── lazybuddy-plugin/     # installable CodeBuddy plugin; skills/ is the WorkBuddy import source
│   ├── .codebuddy-plugin/    #   manifest (plugin.json)
│   ├── skills/               #   14 Skills (lazy-*)
│   ├── agents/               #   13 agent role definitions
│   ├── commands/             #   current slash-command workflows (lazy-*)
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   6 MCP servers
│   ├── scripts/              #   state/loop/verify/doctor scripts
│   ├── templates/            #   consumer AGENTS.md setup-guide template
│   └── .mcp.json             #   six MCP declarations; host connection is verified separately
├── docs/                     # tracked handoff only; private root docs are in ignored dev/docs/root/
├── lazybuddy-evaluation.md   # v0.17 alignment evidence; v0.16.0-alpha.1 package baseline
├── AGENTS.md                 # setup guide
├── README.md                 # this file (how to use)
├── LICENSE                   # MIT
└── NOTICE                    # legal attribution and provenance
```

## Related

- **[LazyTrae](https://github.com/elvinzhao10/LazyTrae)** — the sibling: the same harness on Trae. LazyBuddy gates via host hooks; LazyTrae gates via CLI (Trae hooks can't block).

## License

[MIT](LICENSE) — see [NOTICE](NOTICE) for the scoped legal attribution and provenance record.

## Disclaimer

Practice project, not production-ready, and no longer maintained.

## Acknowledgments

- **[WorkBuddy](https://www.workbuddy.cn)** — the platform this was built for
