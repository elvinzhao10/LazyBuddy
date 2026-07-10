# LazyWorkBuddy

> **A practice project:** realizing [LazyCodex](https://github.com/code-yeongyu/lazycodex) (the OmO harness) on the [WorkBuddy](https://www.codebuddy.cn) platform. No longer maintained; open-sourced for learning.

LazyWorkBuddy brings LazyCodex/OmO's disciplined agent-harness workflows to WorkBuddy. It runs in **WorkBuddy** or via the **CodeBuddy CLI**.

> **Setup?** See [AGENTS.md](AGENTS.md) (the setup guide). This README is about **how to use** the harness once installed.

## Commands

All commands are `lazy-` prefixed.

| Command | Purpose |
|---|---|
| `/lazy-init-deep` | Generate hierarchical project memory |
| `/lazy-ulw-plan` | Decision-complete work plan |
| `/lazy-start-work` | Execute a plan with orchestrated subagents |
| `/lazy-ulw-loop` | Verified completion loop |
| `/lazy-ultrawork` | Binding high-precision mode |
| `/lazy-review-work` | 5-agent parallel review gate |
| `/lazy-verifier` `/lazy-reviewer` `/lazy-librarian` | Verify / review / update memory |

## Workflow

```
/lazy-init-deep                         # generate project memory
/lazy-ulw-plan "implement feature X"   # decision-complete plan
/lazy-start-work                        # execute with subagents + verification
/lazy-review-work                       # 5-agent review gate (all must pass)
```

Five phases: **Explore → Plan → Implement → Verify → Manually QA**. Each step closes only after **five evidence gates**: plan reread, automated verification, manual-QA, adversarial QA, cleanup.

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

1. **Structure:** `lazyworkbuddy-plugin/` is the plugin (skills/, commands/, agents/, hooks/, mcp/, scripts/). State lives in `.lazyworkbuddy/runs/<run_id>/`.
2. **Naming discipline:** all skills & commands are `lazy-` prefixed. Keep new ones prefixed.
3. **Test/verify:** `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` (50 PASS expected) + `lazyworkbuddy-smoke-test.sh` (105 PASS). Update the doctor's `EXPECTED_COMMANDS`/`EXPECTED_SKILLS` if you add/rename.
4. **Hooks are binding:** test with doctor + smoke after any hook change.
5. **Commit:** conventional, atomic, stage only files you changed, no `--no-verify`.

## Repository structure

```
lazyworkbuddy/
├── lazyworkbuddy-plugin/     # installable WorkBuddy plugin
│   ├── .workbuddy-plugin/    #   manifest (plugin.json)
│   ├── skills/               #   14 Skills (lazy-*)
│   ├── agents/               #   13 agent role definitions
│   ├── commands/             #   15 slash commands (lazy-*)
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   8 MCP servers
│   ├── scripts/              #   state/loop/verify/doctor scripts
│   ├── templates/            #   AGENTS.md (consumer setup guide, generated on install)
│   └── .mcp.json             #   MCP server config (auto-loaded by WorkBuddy)
├── docs/                     # user-facing: architecture, protocols, templates, plan/, prompts/
├── lazyworkbuddy-evaluation.md
├── AGENTS.md                 # setup guide
├── README.md                 # this file (how to use)
├── LICENSE                   # MIT
└── NOTICE                    # omo/lazycodex provenance
```

## Related

- **[LazyTrae](https://github.com/elvinzhao10/Trae)** — the sibling: the same harness on Trae. LazyWorkBuddy gates via host hooks; LazyTrae gates via CLI (Trae hooks can't block).

## License

[MIT](LICENSE) — derived from lazycodex/omo, Copyright (c) 2026 Yeongyu Kim. See [NOTICE](NOTICE) (omo is SUL at root; the lazycodex layer used as a local gitignored reference is MIT).

## Disclaimer

Practice project, not production-ready, no longer maintained. For production use, see the [original lazycodex/omo](https://github.com/code-yeongyu/lazycodex).

## Acknowledgments

- **[Yeongyu Kim](https://github.com/code-yeongyu)** — creator of [lazycodex/OmO](https://github.com/code-yeongyu/lazycodex)
- **[WorkBuddy](https://www.codebuddy.cn)** — the platform this was built for
