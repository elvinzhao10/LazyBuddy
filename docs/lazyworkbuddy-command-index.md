# Lazyworkbuddy Command Index

> Master index of every command, Skill, and agent. Every canonical LazyCodex method must appear here or in the parity ledger.
>
> Status codes: ✅ implemented | 🔧 planned | ⛔ skipped (with reason) | ✨ added (Lazyworkbuddy-only)

## Core Commands (6)

| # | Command | LazyCodex Equivalent | Status | v0 Target |
|---|---------|---------------------|--------|-----------|
| 1 | `/init-deep` | `$init-deep` | ✅ | v0.4 |
| 2 | `/ulw-plan` | `$ulw-plan` | ✅ | v0.4 |
| 3 | `/start-work` | `$start-work` | ✅ | v0.4 |
| 4 | `/ulw-loop` | `$ulw-loop` | ✅ | v0.4 |
| 5 | `/review-work` | `review-work` skill | ✅ | v0.4 |
| 6 | `/ultrawork` | `ultrawork` skill | ✅ | v0.4 |

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

## Lazyworkbuddy-Only Skills (2)

| # | Skill | Status | v0 Target | Description |
|---|-------|--------|-----------|-------------|
| 26 | `librarian` | ✅ | v0.9 | Memory/index/parity maintenance |
| 27 | `migration-planner` | ✅ | v0.10 | Cross-platform migration workflow |

## Agents (9)

| # | Agent | LazyCodex Equivalent | Status | v0 Target |
|---|-------|---------------------|--------|-----------|
| 1 | `orchestrator` | Sisyphus | 🔧 | v0.5 |
| 2 | `planner` | Prometheus / `plan` | 🔧 | v0.5 |
| 3 | `explorer` | `explorer` | 🔧 | v0.5 |
| 4 | `implementer` | Spawned worker | 🔧 | v0.5 |
| 5 | `verifier` | Oracle | ✅ | v0.5 |
| 6 | `reviewer` | `momus` + `metis` | ✅ | v0.5 |
| 7 | `qa-executor` | `lazycodex-qa-executor` | 🔧 | v0.5 |
| 8 | `gate-reviewer` | `lazycodex-gate-reviewer` | 🔧 | v0.5 |
| 9 | `librarian` | `librarian` | 🔧 | v0.9 |

## Hooks (12)

| # | Event | LazyCodex Equivalent | Status | v0 Target |
|---|-------|---------------------|--------|-----------|
| 1 | `SessionStart` | `session-start-loading-project-rules` | 🔧 | v0.6 |
| 2 | `UserPromptSubmit` | `user-prompt-submit-checking-ultrawork-trigger` | 🔧 | v0.6 |
| 3 | `PreToolUse` | `pre-tool-use-enforcing-unlimited-goal-budget` | 🔧 | v0.6 |
| 4 | `PostToolUse` | `post-tool-use-checking-comments` (combined) | 🔧 | v0.6 |
| 5 | `PostToolUseFailure` | (new — Lazyworkbuddy addition) | ✨ | v0.6 |
| 6 | `PreCompact` | `post-compact-resetting-*` (combined) | 🔧 | v0.6 |
| 7 | `Stop` | `stop-checking-start-work-continuation` | 🔧 | v0.6 |
| 8 | `StopFailure` | (new — Lazyworkbuddy addition) | ✨ | v0.6 |
| 9 | `SubagentStop` | `subagent-stop-verifying-lazycodex-executor-evidence` | 🔧 | v0.6 |
| 10 | `SubagentStart` | (new — Lazyworkbuddy addition) | ✨ | v0.6 |
| 11 | `TaskCreated` | (new — Lazyworkbuddy addition) | ✨ | v0.6 |
| 12 | `TaskCompleted` | (new — Lazyworkbuddy addition) | ✨ | v0.6 |

## MCP Servers (3-5)

| # | Server | LazyCodex Equivalent | Status | v0 Target |
|---|--------|---------------------|--------|-----------|
| 1 | `run-ledger` | (new — Lazyworkbuddy addition) | ✨ | v0.8 |
| 2 | `verification` | (new — Lazyworkbuddy addition) | ✨ | v0.8 |
| 3 | `parity-dashboard` | (new — Lazyworkbuddy addition) | ✨ | v0.8 |
| 4 | `git` | `git_bash` | 🔧 | v0.8 |
| 5 | `codegraph` | `codegraph` | ⛔ (not applicable to WorkBuddy) | — |
| 6 | `lsp` | `lsp` | ⛔ (WorkBuddy native LSP) | — |
| 7 | `grep_app` | `grep_app` | ⛔ (external service) | v0.13 |
| 8 | `context7` | `context7` | ⛔ (external service) | v0.13 |

## Summary

| Category | Total | ✅ Implemented | 🔧 Planned | ✨ Added | ⛔ Skipped |
|----------|-------|----------------|------------|----------|-----------|
| Core Commands | 6 | 6 | 0 | 0 | 0 |
| Extended Skills | 19 | 4 | 11 | 0 | 4 |
| Lazyworkbuddy Skills | 2 | 2 | 0 | 0 | 0 |
| Agents | 9 | 2 | 7 | 0 | 0 |
| Hooks | 12 | 0 | 7 | 5 | 0 |
| MCP Servers | 8 | 0 | 2 | 3 | 3 |
| **TOTAL** | **56** | **14** | **27** | **8** | **7** |

---

_This index is the source of truth for all Lazyworkbuddy commands and skills. Updated by the Librarian after every version that adds or changes components. See `docs/lazyworkbuddy-parity-ledger.md` for per-method parity detail._
