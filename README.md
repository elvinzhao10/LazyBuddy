# Lazyworkbuddy

> **A practice project: realizing [LazyCodex](https://github.com/code-yeongyu/lazycodex) (the OmO agent harness for Codex) on the [WorkBuddy](https://www.codebuddy.cn) platform.**
>
> This repo is **no longer maintained**. It was built as a learning exercise to study how an agent harness like LazyCodex can be adapted to a different host platform. The entire realization process — architecture, plan, prompts, evaluation — is open-sourced here to help others studying agent-harness design and cross-platform adaptation.

## What this is

**Lazyworkbuddy** is a clean-room adaptation of [LazyCodex/omo](https://github.com/code-yeongyu/lazycodex) — the OmO agent harness originally built for OpenAI Codex. It preserves LazyCodex's core workflows (deep init, planning, delegated execution, verification loops, review, durable run state) while reimplementing them on WorkBuddy-native surfaces: Skills, Agents, Hooks, MCP servers, and plugin structure.

**Original project credit:** LazyCodex/omo is Copyright (c) 2026 Yeongyu Kim, licensed under MIT. This project derives concepts and semantics from that work but contains no copied source code, prompts, or protected material. See [NOTICE](NOTICE) for full license provenance.

## What's in this repo

```
lazyworkbuddy/
├── lazyworkbuddy-plugin/     # The installable WorkBuddy plugin (103 files)
│   ├── .workbuddy-plugin/    #   Plugin manifest (plugin.json)
│   ├── skills/               #   14 Skills (init-deep, ulw-plan, start-work, ...)
│   ├── agents/               #   13 agent role definitions (orchestrator, planner, ...)
│   ├── commands/             #   15 slash commands
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   8 MCP servers (run-ledger, parity, verification, ...)
│   ├── scripts/              #   State/loop/check scripts (27 total)
│   └── .mcp.json             #   MCP server config
├── docs/                     # Architecture docs, protocols, evaluation, templates
│   ├── project-memory/       #   workbuddy.md + AGENTS.md (project memory used during dev)
│   ├── templates/            #   7 reusable migration templates
│   └── examples/             #   Example run logs
├── plan/                     # Versioned implementation plan (v0.0 → v0.12)
├── prompts/                  # 11 worker delegation prompts (one per version)
├── .github/                  # CI workflow + issue/PR templates
├── LICENSE                   # MIT
└── NOTICE                    # MIT provenance for derived works
```

## Installation

### Prerequisites

- [WorkBuddy](https://www.codebuddy.cn) (CodeBuddy) desktop app
- Python 3.13+ (for hook scripts and MCP servers)
- Bash (macOS/Linux, or Git Bash on Windows)

### Steps

1. **Clone this repo:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/lazyworkbuddy.git
   cd lazyworkbuddy
   ```

2. **Install the plugin** (symlink to WorkBuddy's plugins directory):
   ```bash
   ln -s "$(pwd)/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy
   ```

3. **Enable the plugin** in `.workbuddy/settings.json`:
   ```json
   {
     "plugin": {
       "lazyworkbuddy": {
         "enabled": true
       }
     }
   }
   ```

4. **Verify the installation:**
   ```bash
   bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS` (50/50 checks).

5. **Restart WorkBuddy** — the plugin, hooks, and MCP servers activate on next session.

## Usage

### Core commands

| Command | Purpose |
|---------|---------|
| `/init-deep` | Generate hierarchical project memory (run first in a new workspace) |
| `/ulw-plan` | Create a decision-complete work plan (Prometheus-style planning) |
| `/start-work` | Execute a plan with orchestrated subagents + verification |
| `/ulw-loop` | Verified completion loop for open-ended tasks |
| `/ultrawork` | Binding high-precision mode (tier triage, evidence gates) |
| `/review-work` | 5-agent parallel review gate |
| `/verifier` | Run verification checks and summarize results |
| `/reviewer` | Review changed files and produce accept/reject/revise |
| `/librarian` | Update memory, parity ledger, known gaps after changes |

### Quick start

```
# In a WorkBuddy session:
/init-deep                    # generates project memory
/ulw-plan "implement X"      # creates a plan
/start-work                   # executes the plan with verification
/review-work                  # 5-agent review gate
```

### MCP tools

8 MCP servers provide 30+ structured tools: run state management, parity tracking, verification, source mapping, and a status dashboard. See [docs/lazyworkbuddy-mcp-and-tools.md](docs/lazyworkbuddy-mcp-and-tools.md).

### Hooks

12 lifecycle hooks enforce deterministic behavior: the Stop hook blocks premature completion, the SubagentStop hook verifies evidence, the PreToolUse hook blocks destructive operations. See [docs/lazyworkbuddy-hooks.md](docs/lazyworkbuddy-hooks.md).

## Evaluation: LazyCodex parity

### Summary

| Dimension | LazyCodex | Lazyworkbuddy | Coverage |
|-----------|-----------|---------------|----------|
| Skills | 25 | 14 | 56% (14 ported + 4 WorkBuddy-native) |
| Agent roles | 10 | 13 | 100% + 3 enhancements |
| Hooks | 21 | 12 | 57% (9 skipped = Codex-specific infra) |
| MCP servers | 5 | 8 | 100% + 3 enhancements (context-tooling substitutes) |
| Plugin fields | 12 | 12 | 100% |
| State ledger | boulder.json | state.json + events.jsonl | Adapted (richer schema) |
| Completion contract | DoneClaim/AdversarialVerify/FullyDone | Same | Matched (verbatim) |

### What's fully ported

- **Core workflow semantics:** tier triage (LIGHT/HEAVY), PIN→RED→GREEN→SURFACE→CLEAN loop, 5 verification gates, Sisyphus completion contract (DoneClaim → AdversarialVerify → FullyDone)
- **Orchestrator-delegate pattern:** orchestrator never implements directly; spawns implementer subagents
- **5-agent parallel review:** Goal Verifier, QA Executor, Code Reviewer, Security Auditor, Context Miner — ALL-MUST-PASS
- **Durable run state:** `.lazyworkbuddy/runs/<run_id>/` with state.json, events.jsonl, checkpoints, evidence, verification, review
- **Evidence verification:** SubagentStop hook validates `EVIDENCE_RECORDED` paths (inside root, exists, non-empty, not symlink)
- **Premature-completion blocking:** Stop hook parses plan checkboxes and blocks if unchecked work remains
- **Context-pressure detection:** hooks pass through gracefully when context is degraded

### Known gaps (17 documented)

The 17 gaps are documented in [docs/lazyworkbuddy-known-gaps.md](docs/lazyworkbuddy-known-gaps.md). Key categories:

- **Host-inherent (can't fix):** 21→12 hooks (LSP/codegraph/telemetry/auto-update skipped or native-substituted); single-model vs multi-tier routing; path-scoped tool permissions don't exist in WorkBuddy
- **Resolved in v0.9 hardening:** worktree discipline, debugging audit, Sisyphus JSON schema, iteration caps, dynamic steering, transition barriers (9 gaps G-007–G-015)
- **Resolved in v0.12 diagnostics:** G-016 (audit hook for orchestrator write-boundary), G-017 (plan/state drift sync)

### Capability labels

| Label | Meaning | Examples |
|-------|---------|----------|
| `semantic` | Structured/parsed source of truth | state.json, events.jsonl, DoneClaim schema |
| `project-tool-backed` | Invokes real project scripts/checkers | doctor.sh, verify.sh, security-check.sh |
| `heuristic` | Grep-based approximation (not full semantic engine) | context-graph MCP, code-intel MCP symbol ops |
| `state-only` | State management without behavioral enforcement | settings.json permission patterns |

## Project structure (study guide)

This repo doubles as a study guide for cross-platform agent-harness adaptation:

- **[plan/](plan/)** — 13 versioned phases (v0.0 discovery → v0.12 release), each with objectives, steps, and verification criteria
- **[prompts/](prompts/)** — 11 worker delegation prompts showing how each phase was briefed to an AI worker
- **[docs/](docs/)** — 44 docs covering architecture, protocols, operations, parity tracking, migration planning, and evaluation
- **[docs/project-memory/](docs/project-memory/)** — The workbuddy.md and AGENTS.md project memory files used during development
- **[docs/templates/](docs/templates/)** — 7 reusable templates for adapting agent harnesses to new platforms

## Disclaimer

**This is a practice project.** It was built to study how LazyCodex's agent-harness design can be adapted to a different host platform (WorkBuddy). The repo is **no longer maintained**.

The entire realization process — architecture decisions, versioned plan, worker prompts, evaluation, known gaps — is open-sourced to help others studying:
- Agent-harness architecture (planning → execution → verification → review → memory)
- Cross-platform adaptation (Codex → WorkBuddy tool translation)
- Clean-room reimplementation (preserving semantics without copying code)
- Evidence-based completion (DoneClaim/AdversarialVerify/FullyDone contract)

## License

[MIT](LICENSE) — same license as the original [lazycodex/omo](https://github.com/code-yeongyu/lazycodex) project.

Portions derived from lazycodex/omo, Copyright (c) 2026 Yeongyu Kim. See [NOTICE](NOTICE) for full provenance.
