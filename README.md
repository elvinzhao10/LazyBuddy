# Lazyworkbuddy

> **A practice project: realizing [LazyCodex](https://github.com/code-yeongyu/lazycodex) (the OmO agent harness) on the [WorkBuddy](https://www.codebuddy.cn) platform.**
>
> This repo is **no longer maintained**. It was built as a learning exercise to study how an agent harness like LazyCodex can be adapted to a different host platform. The entire realization process is open-sourced to help others studying agent-harness design and cross-platform adaptation.

## What this is

**Lazyworkbuddy** is a clean-room adaptation of [LazyCodex/omo](https://github.com/code-yeongyu/lazycodex) — the OmO agent harness originally built for OpenAI Codex. It preserves LazyCodex's core workflows (deep init, planning, delegated execution, verification loops, review, durable run state) while reimplementing them on WorkBuddy-native surfaces: Skills, Agents, Hooks, MCP servers, and plugin structure.

**Original project credit:** LazyCodex/omo is Copyright (c) 2026 Yeongyu Kim, licensed under MIT. This project derives concepts and semantics from that work but contains no copied source code, prompts, or protected material. See [NOTICE](NOTICE) for full license provenance.

## Quick Install (Let WorkBuddy configure itself)

The easiest way to install: **give this repo to WorkBuddy and let it handle everything.**

### Option A: Let WorkBuddy auto-discover the plugin

1. **Clone this repo** anywhere on your machine:
   ```bash
   git clone https://github.com/YOUR_USERNAME/lazyworkbuddy.git
   ```

2. **Open WorkBuddy** and start a new session in the cloned directory.

3. **Tell WorkBuddy:**
   > "Install the lazyworkbuddy plugin from `lazyworkbuddy-plugin/` in this repo. Read the plugin.json, enable the plugin, and activate all hooks and MCP servers."

4. WorkBuddy will:
   - Read `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` (the manifest)
   - Load all 14 Skills from `skills/`
   - Register all 13 Agents from `agents/`
   - Wire all 12 Hooks from `hooks/hooks.json`
   - Start all 8 MCP servers from `.mcp.json`
   - Enable the plugin in `.workbuddy/settings.json`

5. **Verify:**
   ```bash
   bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS`

### Option B: Manual install (if auto-discover doesn't work)

1. **Clone and symlink:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/lazyworkbuddy.git
   ln -s "$(pwd)/lazyworkbuddy/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy
   ```

2. **Enable in `.workbuddy/settings.json`:**
   ```json
   {
     "plugin": {
       "lazyworkbuddy": {
         "enabled": true
       }
     }
   }
   ```

3. **Restart WorkBuddy** and verify with `doctor.sh`.

## How to Use

### Core commands

| Command | Purpose | When to use |
|---------|---------|-------------|
| `/lazy-init-deep` | Generate hierarchical project memory | First time in a new workspace |
| `/lazy-ulw-plan` | Create a decision-complete work plan | Before any multi-file or ambiguous change |
| `/lazy-start-work` | Execute a plan with orchestrated subagents | When a plan is approved and ready to build |
| `/lazy-ulw-loop` | Verified completion loop | For open-ended tasks needing evidence-backed done |
| `/lazy-ultrawork` | Binding high-precision mode | When maximum rigor and evidence are required |
| `/lazy-review-work` | 5-agent parallel review gate | After every significant implementation |
| `/lazy-verifier` | Run verification checks | After implementation, before claiming done |
| `/lazy-reviewer` | Review changed files | After verification, before accepting |
| `/lazy-librarian` | Update memory after changes | After accepted changes |

### Quick start workflow

```
/lazy-init-deep                         # generates project memory
/lazy-ulw-plan "implement feature X"   # creates a plan with checkboxes
/lazy-start-work                        # executes plan with subagents + verification
/lazy-review-work                       # 5-agent review gate (all must pass)
```

### What WorkBuddy gets

| Component | Count | What it does |
|-----------|-------|--------------|
| Skills | 14 | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-programming, lazy-git-master, lazy-debugging, lazy-remove-ai-slops |
| Agents | 13 | orchestrator, planner, explorer, implementer, verifier, reviewer, qa-executor, gate-reviewer, librarian, migration-planner, context-indexer, security-auditor, context-miner |
| Commands | 15 | lazy-init-deep, lazy-ulw-plan, lazy-start-work, lazy-ulw-loop, lazy-ultrawork, lazy-review-work, lazy-verifier, lazy-reviewer, lazy-librarian, lazy-migration-planner, lazy-new-run, lazy-status, lazy-resume, lazy-verify, lazy-parity-report |
| Hooks | 12 | Stop (blocks premature completion), SubagentStop (verifies evidence), PreToolUse (blocks destructive ops), + 9 lifecycle hooks |
| MCP servers | 8 | run-ledger, parity, verification, source-map, status-dashboard (run management) + context-graph, code-intel, docs (context tooling) |
| State scripts | 17 | create-run, update-task, checkpoint, recover-run, finalize-run, next-task, run-cycle, etc. |

### How enforcement works

The harness is **binding, not advisory**:

- **Stop hook** — if you try to end a session with unchecked plan items, it blocks and tells you what's left
- **SubagentStop hook** — when an implementer claims done, it verifies the `EVIDENCE_RECORDED` path points to a real non-empty file inside `.lazyworkbuddy/`
- **PreToolUse hook** — blocks `rm -rf`, secret file access, force pushes, and unauthorized publishes
- **Finalize-run** — refuses to mark a run complete unless all verification gates passed AND the reviewer accepted AND all plan checkboxes are checked

## LazyCodex Parity Evaluation

**Overall: ~70% structural, ~85% semantic.** Core workflow semantics fully ported; structural gaps are in secondary/tooling layers. See [lazyworkbuddy-evaluation.md](lazyworkbuddy-evaluation.md) for the full assessment.

### Summary

| Dimension | LazyCodex | Lazyworkbuddy | Coverage |
|-----------|-----------|---------------|----------|
| Skills | 25 | 14 + 4 native | 56% (core workflows fully ported; secondary skills skipped) |
| Agent roles | 10 | 13 | 100% + 3 enhancements (context-miner, security-auditor, migration-planner) |
| Hooks | 21 | 12 | 57% (9 skipped = Codex-specific infra: LSP, codegraph, telemetry, auto-update) |
| MCP servers | 5 | 8 | 100% + 3 context-tooling substitutes |
| Plugin fields | 12 | 12 | 100% |
| State ledger | boulder.json | state.json + events.jsonl | Adapted (richer schema, same semantics) |
| Completion contract | DoneClaim/AdversarialVerify/FullyDone | Same | Matched (verbatim) |

### What's fully ported

- **Core workflow semantics:** tier triage (LIGHT/HEAVY), PIN→RED→GREEN→SURFACE→CLEAN loop, 5 verification gates, Sisyphus completion contract
- **Orchestrator-delegate pattern:** orchestrator never implements directly; spawns implementer subagents
- **5-agent parallel review:** Goal Verifier, QA Executor, Code Reviewer, Security Auditor, Context Miner — ALL-MUST-PASS
- **Durable run state:** `.lazyworkbuddy/runs/<run_id>/` with state.json, events.jsonl, checkpoints, evidence
- **Evidence verification:** SubagentStop hook validates evidence paths (exists, non-empty, not symlink, inside root)
- **Premature-completion blocking:** Stop hook parses plan checkboxes and blocks if unchecked work remains

### Known gaps (17 documented)

See [docs/lazyworkbuddy-known-gaps.md](docs/lazyworkbuddy-known-gaps.md). Key categories:
- **Host-inherent (can't fix):** 21→12 hooks (LSP/codegraph/telemetry skipped); single-model routing; no path-scoped tool permissions in WorkBuddy
- **Resolved in v0.9:** worktree discipline, debugging audit, Sisyphus schema, iteration caps, dynamic steering, transition barriers (9 gaps)
- **Resolved in v0.12:** G-016 (audit hook), G-017 (plan/state drift sync)

## Version History

| Tag | Phase | Key deliverable |
|-----|-------|-----------------|
| `v0.0` | Discovery | LazyCodex method map, WorkBuddy host surface map |
| `v0.1` | Architecture | Three-layer model, plugin design, state ledger design |
| `v0.2` | Project memory | workbuddy.md, 4 rule files, settings.json, command constitution |
| `v0.3` | Plugin scaffold | Installable plugin shell (manifest, placeholders, validation scripts) |
| `v0.4` | Skills & commands | 14 Skills ported from LazyCodex (2,154 lines) |
| `v0.5` | Subagents | 13 agent role definitions + 4 orchestration docs |
| `v0.6` | Hooks & safety | 12 lifecycle hook scripts with real enforcement |
| `v0.7` | Run ledger | 15 state/loop scripts, durable `.lazyworkbuddy/` run state |
| `v0.8` | MCP & dashboard | 8 MCP servers (30+ tools), optional HTML dashboard |
| `v0.9` | Hardening | Verifier/reviewer/librarian hardened, 9 known gaps resolved |
| `v0.10` | Migration | 7 templates + self-adapter doc + migration planner |
| `v0.11` | Dogfood | End-to-end self-test PASS, 5 UX problems found + fixed |
| `v0.12` | Diagnostics | G-016 audit hook, G-017 drift sync, enhanced doctor/verify |

> **MVP = v0.0–v0.7.** Strong benchmark = v0.0–v0.12. Add-ons deferred to v1.

## Repository structure

```
lazyworkbuddy/
├── lazyworkbuddy-plugin/     # THE installable WorkBuddy plugin
│   ├── .workbuddy-plugin/    #   Plugin manifest (plugin.json)
│   ├── skills/               #   14 Skills (init-deep, ulw-plan, start-work, ...)
│   ├── agents/               #   13 agent role definitions
│   ├── commands/             #   15 slash commands
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   8 MCP servers
│   ├── scripts/              #   State/loop/check scripts (27 total)
│   └── .mcp.json             #   MCP server config
├── docs/                     # Architecture docs, protocols, templates
├── plan/                     # Versioned implementation plan (v0.0 → v0.12)
├── prompts/                  # Worker delegation prompts (study reference)
├── .github/                  # CI workflow + issue/PR templates
├── README.md                 # This file
├── LICENSE                   # MIT
└── NOTICE                    # MIT provenance for derived works
```

## Related

- **[LazyTrae](https://github.com/elvinzhao10/Trae)** — the sibling project: the same LazyCodex/OmO harness realized on the Trae IDE. Where LazyWorkBuddy bets on host hook blocking, LazyTrae moves the completion gate into a CLI/MCP layer (Trae hooks can't block). Comparing the two shows how host binding drives divergence.

## License

[MIT](LICENSE) — same license as the original [lazycodex/omo](https://github.com/code-yeongyu/lazycodex).

Portions derived from lazycodex/omo, Copyright (c) 2026 Yeongyu Kim. See [NOTICE](NOTICE) for full provenance.

## Disclaimer

**This is a practice project.** It was built to study how LazyCodex's agent-harness design can be adapted to a different host platform (WorkBuddy). The repo is **no longer maintained**.

The entire realization process — architecture decisions, versioned plan, worker prompts, evaluation, known gaps — is open-sourced to help others studying:
- Agent-harness architecture (planning → execution → verification → review → memory)
- Cross-platform adaptation (Codex → WorkBuddy tool translation)
- Clean-room reimplementation (preserving semantics without copying code)
- Evidence-based completion (DoneClaim/AdversarialVerify/FullyDone contract)

## Acknowledgments

- **[Yeongyu Kim](https://github.com/code-yeongyu)** — creator of [lazycodex/OmO](https://github.com/code-yeongyu/lazycodex), whose MIT-licensed work made this practice project possible
- **[WorkBuddy](https://www.codebuddy.cn)** — the platform this was built for
