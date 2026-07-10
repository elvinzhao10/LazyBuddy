# Agent Map Template

Every agent (subagent, specialist, role) in the system, mapped from source to target with model, toolset, and authority boundaries.

## Agent Map

| # | Source Role | Source File | Host Agent File | Model | Tools | Authority Boundaries | Auth Notes | Status |
|---|------------|------------|----------------|-------|-------|---------------------|-----------|--------|
| 1 | [ROLE_NAME] | [SOURCE_FILE] | [TARGET_FILE] | [MODEL_ID] | [TOOL_LIST] | [BOUNDARIES] | [AUTH_NOTES] | [ported/pending/skipped] |
| 2 | [ROLE_NAME] | [SOURCE_FILE] | [TARGET_FILE] | [MODEL_ID] | [TOOL_LIST] | [BOUNDARIES] | [AUTH_NOTES] | [ported/pending/skipped] |

## Field Descriptions

- **Source Role** — the agent's role name in the source platform (e.g., "explorer", "plan", "reviewer")
- **Source File** — path to the source agent definition (TOML, YAML, JSON, MD)
- **Host Agent File** — path to the target agent definition on WorkBuddy or target platform
- **Model** — the AI model assigned (e.g., `claude-sonnet-4-20250514`, `claude-opus-4-20250514`)
- **Tools** — the allowed tool set for this agent (e.g., `Read,Glob,Grep,Bash(read-only)`)
- **Authority Boundaries** — what this agent is explicitly forbidden from doing (e.g., "no Write/Edit to skill files", "no agent spawning", "read-only")
- **Auth Notes** — special authentication requirements (e.g., "needs GitHub token", "needs MCP server access")
- **Status** — `ported` (verified working), `pending` (planned but not yet built), `skipped` (intentionally excluded with reason)

## Agent Tool Restriction Patterns

| Pattern | Tools Allowed | Use Case |
|---------|-------------|----------|
| **Read-only explorer** | `Read, Glob, Grep, Bash(read-only)` | File system exploration; no modifications |
| **Full worker** | `Read, Write, Edit, Glob, Grep, Bash` | Implementation agent; can modify code |
| **Subagent spawner** | `Read, Write, Edit, Glob, Grep, Bash, Agent` | Orchestrator; can spawn child agents |
| **Web researcher** | `Read, WebFetch, WebSearch` | Information gathering; no file I/O |
| **Code reviewer** | `Read, Glob, Grep` | Audit-only; can read but not write |

## Example — LazyBuddy Agent Map (partial)

| # | Source Role | Source File | Host Agent File | Model | Tools | Authority Boundaries | Auth Notes | Status |
|---|------------|------------|----------------|-------|-------|---------------------|-----------|--------|
| 1 | Orchestrator (Sisyphus) | `dev/reference/lazycodex/plugins/omo/agents/orchestrator.toml` | `lazybuddy-plugin/agents/lazybuddy-orchestrator.md` | claude-opus-4-20250514 | `Read,Write,Edit,Glob,Grep,Bash,Agent,TaskCreate,TaskUpdate,TaskList` | Must not spawn >5 subagents concurrently; must track all spawned agents in task ledger | Needs full tool access for taskloop coordination | ported |
| 2 | Explorer | `dev/reference/lazycodex/plugins/omo/agents/explorer.toml` | `lazybuddy-plugin/agents/lazybuddy-explorer.md` | claude-sonnet-4-20250514 | `Read,Glob,Grep,Bash(read-only)` | Read-only; no Write/Edit; no agent spawning | File system exploration only | ported |
| 3 | Librarian | `dev/reference/lazycodex/plugins/omo/agents/librarian.toml` | `lazybuddy-plugin/agents/lazybuddy-librarian.md` | claude-sonnet-4-20250514 | `Read,Glob,Grep,Write` | Can write to `.lazybuddy/knowledge/` only; no writes to skill/agent/hook files | Semantic memory and knowledge indexing | ported |
| 4 | Plan | `dev/reference/lazycodex/plugins/omo/agents/plan.toml` | `lazybuddy-plugin/agents/lazybuddy-plan.md` | claude-opus-4-20250514 | `Read,Glob,Grep,TaskCreate,TaskUpdate` | Read-only for code; can write task definitions only | Task decomposition and dependency analysis | ported |
| 5 | Worker | `dev/reference/lazycodex/plugins/omo/agents/worker.toml` | `lazybuddy-plugin/agents/lazybuddy-worker.md` | claude-sonnet-4-20250514 | `Read,Write,Edit,Glob,Grep,Bash` | Must follow plan task assignments; one task at a time; must update task status | Implementation-only agent | ported |
| 6 | Reviewer | `dev/reference/lazycodex/plugins/omo/agents/reviewer.toml` | `lazybuddy-plugin/agents/lazybuddy-reviewer.md` | claude-opus-4-20250514 | `Read,Glob,Grep,Bash(read-only)` | Read-only audit; reports findings; never modifies code | Quality gate; runs before task is marked complete | ported |

## Summary

| Status | Count |
|--------|-------|
| ported | [N] |
| pending | [N] |
| skipped | [N] |
| **Total** | **[N]** |
