# LazyBuddy Command Index

> Master index of every command, Skill, and agent. Every canonical LazyCodex method must appear here or in the parity ledger.
>
> Status codes: ✅ implemented | 🔧 planned | ⛔ skipped (with reason) | ✨ added (LazyBuddy-only)
> Current release status, evidence labels, and component counts live in See [README](../README.md) for current status..

## Core Commands (6)

| # | Command | LazyCodex Equivalent | Status | v0 Target |
|---|---------|---------------------|--------|-----------|
| 1 | `/lazy-init-deep` | `$init-deep` | ✅ | v0.4 |
| 2 | `/lazy-ulw-plan` | `$ulw-plan` | ✅ | v0.4 |
| 3 | `/lazy-start-work` | `$start-work` | ✅ | v0.4 |
| 4 | `/lazy-ulw-loop` | `$ulw-loop` | ✅ | v0.4 |
| 5 | `/lazy-review-work` | `review-work` skill | ✅ | v0.4 |
| 6 | `/lazy-ultrawork` | `ultrawork` skill | ✅ | v0.4 |

## Extended Skills (19)

*Adapted from LazyCodex's 25 skills (excludes the 6 core commands above, includes librarian + migration-planner additions)*

| # | Skill | LazyCodex Equivalent | Status | v0 Target |
|---|-------|---------------------|--------|-----------|
| 7 | `programming` | `programming` skill | ✅ | v0.4 |
| 8 | `remove-ai-slops` | `remove-ai-slops` skill | ✅ | v0.4 |
| 9 | `git-master` | `git-master` skill | ✅ | v0.4 |
| 10 | `debugging` | `debugging` skill | ✅ | v0.4 |
| 11 | `refactor` | `refactor` skill | 🔧 | v0.4 |
| 12 | `frontend` | `frontend-ui-ux` skill | 🔧 | v0.4 |
| 13 | `lsp` | `LSP` skill | 🔧 | v0.4 |
| 14 | `comment-checker` | `comment-checker` skill | 🔧 | v0.4 |
| 15 | `rules` | `rules` skill | 🔧 | v0.4 |
| 16 | `ast-grep` | `AST-grep` skill | ⛔ (requires `sg` binary) | v0.13 |
| 17 | `visual-qa` | `visual-qa` skill | 🔧 | v0.7 |
| 18 | `teammode` | `teammode` skill | 🔧 | v0.5 |
| 19 | `ulw-research` | `ulw-research` skill | 🔧 | v0.4 |
| 20 | `lx-contribute` | `lcx-contribute-bug-fix` skill | ⛔ (project-specific) | v0.13 |
| 21 | `doctor` | `lcx-doctor` skill | 🔧 | v0.8 |
| 22 | `report-bug` | `lcx-report-bug` skill | ⛔ (project-specific) | v0.13 |
| 23 | `coding-agent-sessions` | `coding-agent-sessions` skill | 🔧 | v0.5 |
| 24 | `lsp-setup` | `lsp-setup` skill | 🔧 | v0.8 |
| 25 | `browsing` | `ultimate-browsing` skill | 🔧 | v0.8 |

## LazyBuddy-Only Skills (2)

| # | Skill | Status | v0 Target | Description |
|---|-------|--------|-----------|-------------|
| 26 | `librarian` | ✅ | v0.9 | Memory/index/parity maintenance |
| 27 | `migration-planner` | ✅ | v0.10 | Cross-platform migration workflow |

## Agents (13)

| # | Agent | LazyCodex Equivalent | Status | v0 Target |
|---|-------|---------------------|--------|-----------|
| 1 | `orchestrator` | Sisyphus | ✅ | v0.5 |
| 2 | `planner` | Prometheus / `plan` | ✅ | v0.5 |
| 3 | `explorer` | `explorer` | ✅ | v0.5 |
| 4 | `implementer` | Spawned worker | ✅ | v0.5 |
| 5 | `verifier` | Oracle | ✅ | v0.5 |
| 6 | `reviewer` | `momus` + `metis` | ✅ | v0.5 |
| 7 | `qa-executor` | `lazycodex-qa-executor` | ✅ | v0.5 |
| 8 | `gate-reviewer` | `lazycodex-gate-reviewer` | ✅ | v0.5 |
| 9 | `librarian` | `librarian` | ✅ | v0.9 |
| 10 | `security-auditor` | review-work security lane | ✅ | v0.5 |
| 11 | `context-indexer` | init-deep context indexing | ✅ | v0.5 |
| 12 | `context-miner` | review-work context lane | ✅ | v0.5 |
| 13 | `migration-planner` | LazyBuddy-only adapter | ✨ | v0.10 |

## Hooks (12)

| # | Event | LazyCodex Equivalent | Status | v0 Target |
|---|-------|---------------------|--------|-----------|
| 1 | `SessionStart` | `session-start-loading-project-rules` | ✅ | v0.6 |
| 2 | `UserPromptSubmit` | `user-prompt-submit-checking-ultrawork-trigger` | ✅ | v0.6 |
| 3 | `PreToolUse` | `pre-tool-use-enforcing-unlimited-goal-budget` | ✅ | v0.6 |
| 4 | `PostToolUse` | `post-tool-use-checking-comments` (combined) | ✅ | v0.6 |
| 5 | `PostToolUseFailure` | (new — LazyBuddy addition) | ✨ | v0.6 |
| 6 | `PreCompact` | `post-compact-resetting-*` (combined) | ✅ | v0.6 |
| 7 | `Stop` | `stop-checking-start-work-continuation` | ✅ | v0.6 |
| 8 | `StopFailure` | (new — LazyBuddy addition) | ✨ | v0.6 |
| 9 | `SubagentStop` | `subagent-stop-verifying-lazycodex-executor-evidence` | ✅ | v0.6 |
| 10 | `SubagentStart` | (new — LazyBuddy addition) | ✨ | v0.6 |
| 11 | `TaskCreated` | (new — LazyBuddy addition) | ✨ | v0.6 |
| 12 | `TaskCompleted` | (new — LazyBuddy addition) | ✨ | v0.6 |

## MCP Servers (8)

Capability labels: `semantic`, `project-tool-backed`, `heuristic`, `state-only`. Parity classes: `reference parity`, `host-substitution`, `native-enhancement`, `platform-gap`.

| # | Server | LazyCodex Equivalent | Status | Capability / Parity Label | v0 Target |
|---|--------|---------------------|--------|---------------------------|-----------|
| 1 | `run-ledger` | (new — LazyBuddy addition) | ✨ | `native-enhancement`; `project-tool-backed`, `state-only`; `runtime-verified` by `bash lazybuddy-plugin/scripts/lazybuddy-mcp-test.sh` (transcript: `.omo/evidence/task-4-diagnosis-v0-12-lazybuddy.txt`) | v0.8 |
| 2 | `parity` | (new — LazyBuddy addition) | ✨ | `native-enhancement`; `state-only`; `runtime-verified` by `bash lazybuddy-plugin/scripts/lazybuddy-mcp-test.sh` (transcript: `.omo/evidence/task-4-diagnosis-v0-12-lazybuddy.txt`) | v0.8 |
| 3 | `verification` | (new — LazyBuddy addition) | ✨ | `native-enhancement`; `project-tool-backed`, `state-only`; initialize/tools-list `runtime-verified` by `bash lazybuddy-plugin/scripts/lazybuddy-mcp-test.sh` (transcript: `.omo/evidence/task-4-diagnosis-v0-12-lazybuddy.txt`) | v0.8 |
| 4 | `source-map` | (new — LazyBuddy addition) | ✨ | `native-enhancement`; `heuristic` search/index plus direct file reads; `runtime-verified` by `bash lazybuddy-plugin/scripts/lazybuddy-mcp-test.sh` (transcript: `.omo/evidence/task-4-diagnosis-v0-12-lazybuddy.txt`) | v0.8 |
| 5 | `status-dashboard` | (new — LazyBuddy addition) | ✨ | `native-enhancement`; `state-only`; initialize/tools-list `runtime-verified` by `bash lazybuddy-plugin/scripts/lazybuddy-mcp-test.sh` (transcript: `.omo/evidence/task-4-diagnosis-v0-12-lazybuddy.txt`) | v0.8 |
| 6 | `context-graph` | `codegraph` | ✅ | `host-substitution`; `heuristic-substitute`; not full semantic codegraph parity | v0.11 |
| 7 | `code-intel` | `lsp` | ✅ | `host-substitution`; `project-tool-backed` diagnostics/typecheck when checkers exist; `heuristic-substitute` symbols/references/goto; not full LSP parity | v0.11 |
| 8 | `docs` | `context7` | ✅ | `host-substitution`; `heuristic-substitute`; npm/PyPI README fetch, not curated Context7 parity | v0.11 |

`git_bash` and `grep_app` are `platform-gap` host substitutions through WorkBuddy native shell/search surfaces, not MCP ports. Treat any stronger claim as `implemented-unverified` unless a concrete command transcript is cited.

## Summary

| Category | Total | ✅ Implemented | 🔧 Planned | ✨ Added | ⛔ Skipped |
|----------|-------|----------------|------------|----------|-----------|
| Core Commands | 6 | 6 | 0 | 0 | 0 |
| Extended Skills | 19 | 4 | 12 | 0 | 3 |
| LazyBuddy Skills | 2 | 2 | 0 | 0 | 0 |
| Agents | 13 | 12 | 0 | 1 | 0 |
| Hooks | 12 | 7 | 0 | 5 | 0 |
| MCP Servers | 8 | 3 | 0 | 5 | 0 |
| **TOTAL** | **60** | **34** | **12** | **11** | **3** |

---

_This index is the source of truth for all LazyBuddy commands and skills. Updated by the Librarian after every version that adds or changes components. See `docs/lazybuddy-parity-ledger.md` for per-method parity detail._
