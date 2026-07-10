# LazyBuddy

> **A practice project:** realizing [LazyCodex](https://github.com/code-yeongyu/lazycodex) (the OmO harness) on the [WorkBuddy](https://www.workbuddy.cn) platform. No longer maintained; open-sourced for learning.

LazyBuddy brings LazyCodex/OmO's disciplined agent-harness workflows to **WorkBuddy**, **CodeBuddy IDE**, and **CodeBuddy CLI**.

> **Setup?** See [AGENTS.md](AGENTS.md) (the setup guide). This README is about **how to use** the harness once installed.

## Onboard with AI

1. Copy or clone [github.com/elvinzhao10/LazyBuddy](https://github.com/elvinzhao10/LazyBuddy) into a local folder.
2. Open that folder in your chosen host and type `onboard`.

The agent reads `AGENTS.md`, asks which installed version you are using (**WorkBuddy**, **CodeBuddy IDE**, or **CodeBuddy CLI**), then performs the matching safe setup steps. It runs `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` after installation, reports the exact loaded component count, verifies the expected result, and gives exact manual directions for anything it cannot perform. When a host opens a new repository, LazyBuddy's SessionStart hook repeats that check so a partial plugin load is visible immediately.

After onboarding, you can delete the copied repository if you only needed the installed setup, or keep it to explore and study how LazyBuddy works.

## A first task, from request to evidence

Start by describing the outcome and how you will recognize success, not the commands you think the agent should run. For example:

> Add project search. Results must work on a real project, have tests, and be checked in the UI before you call it done.

For a small, well-bounded change, ask normally. The agent should select the relevant skills from the task. For a larger or uncertain task, use this path:

```text
/lazy-init-deep                         # once for a new or unfamiliar repository
/lazy-ulw-plan "add project search"    # explore, decide, and write the plan
# review and approve the plan
/lazy-start-work                        # execute the planned work with evidence
/lazy-review-work                       # independently review significant work
```

Use `/lazy-ulw-loop "goal"` only when the outcome is long-running or open-ended and needs checkpoints. Use `/lazy-ultrawork "task"` when a change needs maximum precision and an evidence-grade review gate. Finish any meaningful change with the real user surface as well as automated checks: run the CLI, use the page, or exercise the API. A passing test alone is evidence, not the whole result.

## Choosing skills and commands

Skills are the agent's playbooks. You normally invoke them by stating the job in plain language; use a slash command when you want to force a particular workflow.

| Situation | Say or run | Why |
|---|---|---|
| New or confusing repository | `/lazy-init-deep` | Builds project memory and local instructions before work starts. |
| Multi-file, ambiguous, or architectural work | `/lazy-ulw-plan "…"` | Produces a decision-complete plan before changing code. |
| An approved plan | `/lazy-start-work` | Delegates planned work and verifies its evidence. |
| A bug | “Debug why … fails” | Selects the debugging playbook: reproduce, form hypotheses, then fix and prove it. |
| Behavior-preserving cleanup | “Refactor … without changing behavior” | Uses the refactor discipline; keep verification in place. |
| Git work | “Commit these changes” | Uses the Git workflow to inspect, stage, and commit intentionally. |
| A large finished change | `/lazy-review-work` | Runs independent goal, QA, quality, security, and context review. |
| A long-running goal | `/lazy-ulw-loop "…"` | Keeps durable state and continues until evidence proves completion. |

The mindset is simple: choose the **smallest** workflow that matches the risk, make acceptance criteria explicit, and do not accept “done” without observable evidence. The agent should ask for a decision only when it genuinely needs the project owner's choice.

## Commands

All commands are `lazy-` prefixed. The main controls are `/lazy-init-deep`, `/lazy-ulw-plan`, `/lazy-start-work`, `/lazy-ulw-loop`, `/lazy-ultrawork`, and `/lazy-review-work`; `/lazy-verifier`, `/lazy-reviewer`, and `/lazy-librarian` are targeted tools for verification, review, and project memory.

## Enforcement

**Binding via host hooks** (the inverse of the LazyTrae sibling's CLI-gate strategy):
- **Stop hook** — blocks session end if plan checkboxes remain unchecked.
- **SubagentStop hook** — validates `EVIDENCE_RECORDED` paths (inside root, exists, non-empty, not symlink).
- **PreToolUse hook** — blocks `rm -rf`, secret paths, force pushes, unauthorized publishes.

## What's included

| Component | Count | Examples |
|---|---|---|
| Skills | 14 | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-programming, lazy-git-master, lazy-debugging, lazy-remove-ai-slops |
| Agents | 13 | orchestrator, planner, explorer, implementer, verifier, reviewer, qa-executor, gate-reviewer, librarian, migration-planner, context-indexer, security-auditor, context-miner |
| Commands | 15 | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-new-run, lazy-status, lazy-resume, lazy-verify, lazy-parity-report |
| Hooks | 12 | Stop, SubagentStop, PreToolUse, + 9 lifecycle |
| MCP servers | 8 | run-ledger, parity, verification, source-map, status-dashboard, context-graph, code-intel, docs |

## Developing on this repo (open-source)

Practice repo; contributions welcome as learning exercises.

1. **Structure:** `lazybuddy-plugin/` is the plugin (skills/, commands/, agents/, hooks/, mcp/, scripts/). State lives in `.lazybuddy/runs/<run_id>/`.
2. **Naming discipline:** all skills & commands are `lazy-` prefixed. Keep new ones prefixed.
3. **Test/verify:** `bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh` (50 PASS expected) + `lazybuddy-smoke-test.sh` (99 PASS). Update the doctor's `EXPECTED_COMMANDS`/`EXPECTED_SKILLS` if you add/rename.
4. **Hooks are binding:** test with doctor + smoke after any hook change.
5. **Commit:** conventional, atomic, stage only files you changed, no `--no-verify`.

## Repository structure

```
lazybuddy/
├── .codebuddy-plugin/    # CodeBuddy marketplace entry
├── lazybuddy-plugin/     # installable CodeBuddy plugin; skills also work in WorkBuddy
│   ├── .codebuddy-plugin/    #   manifest (plugin.json)
│   ├── skills/               #   14 Skills (lazy-*)
│   ├── agents/               #   13 agent role definitions
│   ├── commands/             #   15 slash commands (lazy-*)
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   8 MCP servers
│   ├── scripts/              #   state/loop/verify/doctor scripts
│   ├── templates/            #   AGENTS.md (consumer setup guide, generated on install)
│   └── .mcp.json             #   MCP server config (auto-loaded by WorkBuddy)
├── docs/                     # user-facing: architecture, protocols, templates, plan/, prompts/
├── lazybuddy-evaluation.md
├── AGENTS.md                 # setup guide
├── README.md                 # this file (how to use)
├── LICENSE                   # MIT
└── NOTICE                    # omo/lazycodex provenance
```

## Related

- **[LazyTrae](https://github.com/elvinzhao10/Trae)** — the sibling: the same harness on Trae. LazyBuddy gates via host hooks; LazyTrae gates via CLI (Trae hooks can't block).

## License

[MIT](LICENSE) — derived from lazycodex/omo, Copyright (c) 2026 Yeongyu Kim. See [NOTICE](NOTICE) (omo is SUL at root; the lazycodex layer used as a local gitignored reference is MIT).

## Disclaimer

Practice project, not production-ready, no longer maintained. For production use, see the [original lazycodex/omo](https://github.com/code-yeongyu/lazycodex).

## Acknowledgments

- **[Yeongyu Kim](https://github.com/code-yeongyu)** — creator of [lazycodex/OmO](https://github.com/code-yeongyu/lazycodex)
- **[WorkBuddy](https://www.workbuddy.cn)** — the platform this was built for
