# Lazyworkbuddy Plugin Design

> v0.12 — Directory layout, manifest fields, component list, install/uninstall story

## Overview

The Lazyworkbuddy plugin (`lazyworkbuddy-plugin/`) is the installable WorkBuddy plugin that provides the LazyCodex agent harness. It packages Skills, Commands, Agents, Hooks, MCP servers, and verification scripts into a single installable unit.

**LazyCodex source:** [plugins/omo/.codex-plugin/plugin.json](../dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json) — the omo plugin manifest (version 4.16.0, 21 hooks, 5 MCP servers, 25 skills).

---

## Directory Layout

```
lazyworkbuddy-plugin/
├── .workbuddy-plugin/
│   └── plugin.json                  # Plugin manifest
│
├── skills/                          # 14 implemented WorkBuddy Skills
│   ├── init-deep/SKILL.md           # Deep project initialization
│   ├── ulw-plan/SKILL.md            # Prometheus planning
│   ├── start-work/SKILL.md          # Orchestrated execution
│   ├── ulw-loop/SKILL.md            # Verified completion loop
│   ├── ultrawork/SKILL.md           # Binding ultrawork directive
│   ├── review-work/SKILL.md         # 5-agent parallel review
│   ├── programming/SKILL.md         # Strict coding discipline
│   ├── remove-ai-slops/SKILL.md     # AI-looking code cleanup
│   ├── git-master/SKILL.md          # Git workflow discipline
│   ├── debugging/SKILL.md           # Systematic debugging
│   ├── refactor/SKILL.md            # Safe refactoring
│   ├── frontend/SKILL.md            # Frontend UI/UX discipline
│   ├── lsp/SKILL.md                 # LSP diagnostics
│   ├── comment-checker/SKILL.md     # Post-edit feedback
│   ├── rules/SKILL.md               # Project rules matching
│   ├── librarian/SKILL.md           # Memory/index maintenance
│   ├── migration-planner/SKILL.md   # Cross-platform migration
│   └── ... (additional skills from LazyCodex source)
│
├── commands/                        # Slash command wrappers
│   ├── init-deep.md                 # /lazy-init-deep
│   ├── ulw-plan.md                  # /lazy-ulw-plan
│   ├── start-work.md                # /lazy-start-work
│   ├── ulw-loop.md                  # /lazy-ulw-loop
│   ├── review-work.md               # /lazy-review-work
│   └── ultrawork.md                 # /lazy-ultrawork
│
├── agents/                          # 13 WorkBuddy subagents
│   ├── lazyworkbuddy-orchestrator.md # Root orchestrator (Sisyphus)
│   ├── lazyworkbuddy-planner.md      # Planning agent (Prometheus)
│   ├── lazyworkbuddy-explorer.md     # Codebase exploration agent
│   ├── lazyworkbuddy-implementer.md  # Implementation worker
│   ├── lazyworkbuddy-verifier.md     # Evidence verification (Oracle)
│   ├── lazyworkbuddy-reviewer.md     # Multi-angle code review
│   ├── lazyworkbuddy-qa-executor.md  # Hands-on QA execution
│   ├── lazyworkbuddy-gate-reviewer.md # Final gate approval
│   └── ...                          # librarian, context, security, migration agents
│
├── hooks/
│   └── hooks.json                   # 12 lifecycle hooks
│
├── mcp/                             # 8 MCP server implementations
│   ├── run-ledger/server.sh         # Run state query/append
│   ├── verification/server.sh       # Verification test runner
│   ├── parity/server.sh             # Parity state/docs tools
│   ├── source-map/server.sh         # Source/reference lookup
│   ├── status-dashboard/server.sh   # Status aggregation
│   ├── context-graph/server.sh      # Heuristic codegraph substitute
│   ├── code-intel/server.sh         # Project-tool/heuristic LSP substitute
│   └── docs/server.sh               # Heuristic docs lookup substitute
│
├── scripts/                         # Verification and utility scripts
│   ├── hooks/session-start.sh
│   ├── hooks/user-prompt-submit.sh
│   ├── hooks/pre-tool-use.sh
│   ├── hooks/post-tool-use.sh
│   ├── hooks/post-tool-use-failure.sh
│   ├── hooks/pre-compact.sh
│   ├── hooks/stop-gate.sh
│   ├── hooks/stop-failure.sh
│   ├── hooks/subagent-stop.sh
│   ├── hooks/task-created.sh
│   ├── hooks/task-completed.sh
│   ├── hooks/subagent-start.sh
│   ├── state/create-run.sh
│   ├── state/append-event.sh
│   ├── state/checkpoint.sh
│   ├── state/recover-run.sh
│   ├── loop/finalize-run.sh
│   ├── lazyworkbuddy-docs-check.sh
│   ├── lazyworkbuddy-plugin-doctor.sh
│   └── lazyworkbuddy-verify.sh
│
├── .mcp.json                        # MCP server configuration
├── .lsp.json                        # Optional LSP integration
└── README.md                        # Plugin documentation
```

---

## Plugin Manifest (`plugin.json`)

```jsonc
{
  "name": "lazyworkbuddy",
  "version": "0.12.0",
  "description": "LazyCodex agent harness reborn inside WorkBuddy — project memory, planning, execution, and verified completion.",
  "author": {
    "name": "Lazyworkbuddy",
    "url": "https://github.com/lazyworkbuddy"
  },
  "homepage": "https://github.com/lazyworkbuddy",
  "repository": "https://github.com/lazyworkbuddy",
  "license": "MIT",
  "keywords": [
    "workbuddy",
    "workbuddy-plugin",
    "lazycodex",
    "omo",
    "agent-harness",
    "hooks",
    "mcp",
    "skills",
    "planning",
    "verification"
  ],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Lazyworkbuddy",
    "shortDescription": "LazyCodex agent harness for WorkBuddy",
    "longDescription": "Lazyworkbuddy brings the LazyCodex/OmO agent harness to WorkBuddy: hierarchical project memory, Prometheus-style planning, orchestrated execution with subagents, verified completion with evidence gates, 5-agent parallel review, and durable run state with checkpoints. It's LazyCodex reborn inside WorkBuddy.",
    "developerName": "Lazyworkbuddy",
    "category": "Developer Tools",
    "capabilities": [
      "Hooks",
      "MCP Tools",
      "Workflow",
      "Context Injection",
      "Agent Orchestration",
      "Verification"
    ],
    "websiteURL": "https://github.com/lazyworkbuddy",
    "privacyPolicyURL": "https://github.com/lazyworkbuddy#privacy",
    "termsOfServiceURL": "https://github.com/lazyworkbuddy#license",
    "defaultPrompt": [
      "Use Lazyworkbuddy to plan and execute this task.",
      "Run /lazy-ulw-plan to create a decision-complete work plan.",
      "Run /lazy-start-work to execute the plan with verification."
    ],
    "brandColor": "#7C3AED",
    "screenshots": []
  }
}
```

### Field Mapping from LazyCodex

| LazyCodex Field | Lazyworkbuddy Field | Rationale |
|----------------|---------------------|-----------|
| `name: "omo"` | `name: "lazyworkbuddy"` | WorkBuddy-branded; clean-room name |
| `version: "4.16.0"` | `version: "0.12.0"` | v0 release line; metadata bump finalized by the v0.12 release metadata todo |
| `skills: "./skills/"` | `skills: "./skills/"` | Same structure |
| `hooks: [21 files]` | `hooks: "./hooks/hooks.json"` | WorkBuddy uses single hooks.json |
| `mcpServers: "./.mcp.json"` | `mcpServers: "./.mcp.json"` | Same structure |
| `interface.displayName: "OMO"` | `interface.displayName: "Lazyworkbuddy"` | WorkBuddy-branded |
| `interface.brandColor: "#7C3AED"` | `interface.brandColor: "#7C3AED"` | Kept LazyCodex purple for brand continuity |
| `interface.capabilities` | Updated for WorkBuddy | "Agent Orchestration" added |

---

## Component List

### Skills (14 implemented, with additional LazyCodex skills tracked)

| # | LazyCodex Skill | Lazyworkbuddy Skill | Status | Notes |
|---|----------------|---------------------|--------|-------|
| 1 | `init-deep` | `init-deep/SKILL.md` | Core | Hierarchical project memory |
| 2 | `ulw-plan` | `ulw-plan/SKILL.md` | Core | Prometheus planning |
| 3 | `start-work` | `start-work/SKILL.md` | Core | Orchestrated execution |
| 4 | `ulw-loop` | `ulw-loop/SKILL.md` | Core | Verified completion loop |
| 5 | `ultrawork` | `ultrawork/SKILL.md` | Core | Binding ultrawork directive |
| 6 | `review-work` | `review-work/SKILL.md` | Core | 5-agent parallel review |
| 7 | `programming` | `programming/SKILL.md` | Core | Strict coding discipline |
| 8 | `remove-ai-slops` | `remove-ai-slops/SKILL.md` | Core | AI-looking code cleanup |
| 9 | `git-master` | `git-master/SKILL.md` | Core | Git workflow discipline |
| 10 | `debugging` | `debugging/SKILL.md` | Core | Systematic debugging |
| 11 | `refactor` | `refactor/SKILL.md` | Extended | Safe refactoring |
| 12 | `frontend` | `frontend/SKILL.md` | Extended | Frontend UI/UX |
| 13 | `lsp` | `lsp/SKILL.md` | Extended | LSP diagnostics |
| 14 | `comment-checker` | `comment-checker/SKILL.md` | Extended | Post-edit feedback |
| 15 | `rules` | `rules/SKILL.md` | Extended | Project rules |
| 16 | `ast-grep` | `ast-grep/SKILL.md` | Optional | Structural search (if `sg` binary available) |
| 17 | `visual-qa` | `visual-qa/SKILL.md` | Optional | Visual QA evidence |
| 18 | `teammode` | `teammode/SKILL.md` | Optional | Team coordination |
| 19 | `ulw-research` | `ulw-research/SKILL.md` | Extended | Research mode |
| 20 | `lx-contribute-bug-fix` | `lx-contribute/SKILL.md` | Optional | Bug fix contribution |
| 21 | `lx-doctor` | `doctor/SKILL.md` | Extended | Health check |
| 22 | `lx-report-bug` | `report-bug/SKILL.md` | Optional | Bug reporting |
| 23 | `coding-agent-sessions` | `coding-agent-sessions/SKILL.md` | Optional | Multi-agent session management |
| 24 | `lsp-setup` | `lsp-setup/SKILL.md` | Optional | LSP configuration |
| 25 | `ultimate-browsing` | `browsing/SKILL.md` | Optional | Browser automation |
| 26 | — | `librarian/SKILL.md` | New | Memory/index/parity maintenance (Lazyworkbuddy addition) |
| 27 | — | `migration-planner/SKILL.md` | New | Cross-platform migration (Lazyworkbuddy addition) |

### Commands (6 from LazyCodex)

| # | Command | Invocation | Maps to Skill |
|---|---------|-----------|---------------|
| 1 | `/lazy-init-deep` | `/lazy-init-deep [--create-new] [--max-depth=N]` | `init-deep` |
| 2 | `/lazy-ulw-plan` | `/lazy-ulw-plan "what to build"` | `ulw-plan` |
| 3 | `/lazy-start-work` | `/lazy-start-work [plan-name] [--worktree <path>]` | `start-work` |
| 4 | `/lazy-ulw-loop` | `/lazy-ulw-loop "task" [--completion-promise=TEXT]` | `ulw-loop` |
| 5 | `/lazy-review-work` | `/lazy-review-work` | `review-work` |
| 6 | `/lazy-ultrawork` | `/lazy-ultrawork` | `ultrawork` |

Command invocation syntax follows LazyCodex conventions (traced to [README.md](../dev/reference/lazycodex/README.md) Commands section) but uses WorkBuddy slash command format.

### Agents (13)

| # | Agent | Role | LazyCodex Equivalent | Key Constraint |
|---|-------|------|---------------------|----------------|
| 1 | `orchestrator` | Root coordinator | Sisyphus | Never implements directly |
| 2 | `planner` | Strategic planner | Prometheus / plan | Never writes product code |
| 3 | `explorer` | Codebase exploration | explorer | Read-only tools |
| 4 | `implementer` | Implementation worker | Worker (spawned) | Scoped file access |
| 5 | `verifier` | Evidence verification | Oracle | Independent context |
| 6 | `reviewer` | Multi-angle review | momus + metis | 5-lane parallel |
| 7 | `qa-executor` | Hands-on QA | lazycodex-qa-executor | Test execution only |
| 8 | `gate-reviewer` | Final gate approval | lazycodex-gate-reviewer | Accept/reject/revise |
| 9 | `librarian` | Memory maintenance | librarian | Only writes to `.workbuddy/`, `docs/` |
| 10 | `security-auditor` | Security review | review-work security lane | Read-only review |
| 11 | `context-indexer` | Repo map generation | init-deep context indexing | Context writes only |
| 12 | `context-miner` | Review context mining | review-work context lane | Read-only investigation |
| 13 | `migration-planner` | Host adaptation planning | Lazyworkbuddy-only | Plan-only |

### Hooks (12 of LazyCodex's 21)

| # | WorkBuddy Event | LazyCodex Equivalent | Purpose |
|---|----------------|---------------------|---------|
| 1 | `SessionStart` | `session-start-loading-project-rules` | Load rules, check bootstrap |
| 2 | `UserPromptSubmit` | `user-prompt-submit-checking-ultrawork-trigger` | Detect ultrawork/loop keywords |
| 3 | `PreToolUse` | `pre-tool-use-enforcing-unlimited-goal-budget` | Budget enforcement |
| 4 | `PostToolUse` | `post-tool-use-checking-comments` | Diagnostics, rule matching |
| 5 | `PostToolUseFailure` | (new) | Log failures to run ledger |
| 6 | `PreCompact` | `post-compact-resetting-*` (combined) | Cache reset, state preservation |
| 7 | `Stop` | `stop-checking-start-work-continuation` | Continuation check |
| 8 | `StopFailure` | (new) | Recovery attempt |
| 9 | `SubagentStop` | `subagent-stop-verifying-lazycodex-executor-evidence` | Evidence verification |
| 10 | `SubagentStart` | (new) | Track subagent lifecycle |
| 11 | `TaskCreated` | (new) | Run ledger tracking |
| 12 | `TaskCompleted` | (new) | Progress update |

### MCP Servers (8)

| # | MCP Server | LazyCodex Equivalent | Purpose |
|---|-----------|---------------------|---------|
| 1 | `run-ledger` | (new) | Query/append run state and events |
| 2 | `parity` | (new) | Read and update parity/gap state |
| 3 | `verification` | (new) | Discover and run verification gates |
| 4 | `source-map` | (new) | Search/reference source excerpts and hashes |
| 5 | `status-dashboard` | (new) | Aggregate run, task, verification, and parity status |
| 6 | `context-graph` | `codegraph` | Heuristic WorkBuddy host substitution, not semantic call graph parity |
| 7 | `code-intel` | `lsp` | Project-tool diagnostics plus heuristic symbol navigation |
| 8 | `docs` | `context7` | Registry README/docs lookup, not curated Context7 |

`git_bash` and `grep_app` are platform gaps covered by WorkBuddy native shell/search tools, not MCP ports.

---

## Install/Uninstall Story

### Install

```
# Method 1: From WorkBuddy marketplace
# In WorkBuddy: /plugins → Add Marketplace → enter repository URL
# Repository: https://github.com/lazyworkbuddy

# Method 2: Manual install
git clone https://github.com/lazyworkbuddy ~/.workbuddy/plugins/lazyworkbuddy

# Method 3: From project workspace (for development)
ln -s /path/to/lazyworkbuddy-plugin ~/.workbuddy/plugins/lazyworkbuddy
```

**LazyCodex source:** [README.md](../dev/reference/lazycodex/README.md) Install section — "npx lazycodex-ai install" and Codex marketplace path.

### Post-Install

On first session after install:
1. `SessionStart` hook fires
2. Bootstrap check runs: are `.workbuddy/` and `.lazyworkbuddy/` directories set up?
3. If not: guide user through `init-deep` to create project memory
4. Hooks announce the active Lazyworkbuddy version from plugin metadata

### Verify Install

```
# Run health check
/doctor

# Should report:
# - Plugin: lazyworkbuddy current manifest version ✓
# - Skills: 14 loaded ✓
# - Agents: 13 configured ✓
# - Hooks: 12 active ✓
# - MCP: 8 servers configured ✓
# - Project memory: workbuddy.md present ✓
# - Run state: .lazyworkbuddy/ writable ✓
```

**LazyCodex source:** [README.md](../dev/reference/lazycodex/README.md) "Verify it worked" section — `npx lazycodex-ai doctor`.

### Uninstall

```
# Remove plugin directory
rm -rf ~/.workbuddy/plugins/lazyworkbuddy

# Optional: clean up project-local files
rm -rf .workbuddy/rules/lazyworkbuddy.md
rm -rf .lazyworkbuddy/
```

**LazyCodex source:** [README.md](../dev/reference/lazycodex/README.md) Uninstall section — "npx lazycodex-ai uninstall".

### Upgrade

```
# Pull latest plugin version
cd ~/.workbuddy/plugins/lazyworkbuddy && git pull

# On next session start:
# - Bootstrap hook re-runs provisioning
# - Project memory updated if needed
# - Hooks marked as Modified → re-approve
```

**LazyCodex source:** [README.md](../dev/reference/lazycodex/README.md) Marketplace upgrade — "codex plugin marketplace upgrade sisyphuslabs".

---

## Design Decisions

### Why a single plugin (not multiple)?

LazyCodex is a single `omo` plugin that packages everything. We follow the same pattern: one `lazyworkbuddy` plugin with all components. This keeps install simple and ensures components are versioned together.

**LazyCodex source:** [plugin.json](../dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json) — single plugin with skills, hooks, mcpServers.

### Why Skills + Commands (not just Commands)?

LazyCodex has both: Skills are the workflow knowledge; Commands are the invocation entry points. WorkBuddy supports both: Skills (`skills/<name>/SKILL.md`) for reusable workflow logic, Commands (`commands/*.md`) for user-invoked slash commands. We use both for the same purpose.

### Why `brandColor: "#7C3AED"`?

LazyCodex's omo plugin uses purple (`#7C3AED`) as its brand color. We keep this for brand continuity — Lazyworkbuddy is visually recognizable as "LazyCodex reborn inside WorkBuddy."

### Why 12 hooks instead of 21?

LazyCodex has hooks for Codex-specific components (comment-checker, codegraph, LSP daemon). WorkBuddy has different native capabilities. We map the lifecycle-critical hooks (continuation, evidence, rules) and skip the Codex-specific ones.

---

_Plugin design traces to LazyCodex `plugins/omo/` structure. WorkBuddy plugin conventions verified against [CodeBuddy plugin reference](https://staging-codebuddy.tencent.com/docs/cli/plugins-reference)._
