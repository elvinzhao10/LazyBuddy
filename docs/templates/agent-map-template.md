# Agent Map Template

Every agent (subagent, specialist, role) in the system, documented with its implementation, model, toolset, and authority boundaries.

## Agent Map

| # | Role | Implementation File | Model | Tools | Authority Boundaries | Auth Notes | Status |
|---|------|---------------------|-------|-------|---------------------|-----------|--------|
| 1 | [ROLE_NAME] | [IMPLEMENTATION_FILE] | [MODEL_ID] | [TOOL_LIST] | [BOUNDARIES] | [AUTH_NOTES] | [active/pending/skipped] |
| 2 | [ROLE_NAME] | [IMPLEMENTATION_FILE] | [MODEL_ID] | [TOOL_LIST] | [BOUNDARIES] | [AUTH_NOTES] | [active/pending/skipped] |

## Field Descriptions

- **Role** — the agent's role name (for example, "explorer", "plan", or "reviewer")
- **Implementation File** — path to the agent definition (TOML, YAML, JSON, or Markdown)
- **Model** — the AI model assigned (for example, `claude-sonnet-4-20250514`)
- **Tools** — the allowed tool set for this agent
- **Authority Boundaries** — what this agent is explicitly forbidden from doing
- **Auth Notes** — special authentication requirements
- **Status** — `active` (verified working), `pending` (planned but not yet built), or `skipped` (intentionally excluded with reason)

## Agent Tool Restriction Patterns

| Pattern | Tools Allowed | Use Case |
|---------|---------------|----------|
| **Read-only explorer** | `Read, Glob, Grep, Bash(read-only)` | File system exploration; no modifications |
| **Full worker** | `Read, Write, Edit, Glob, Grep, Bash` | Implementation agent; can modify code |
| **Subagent spawner** | `Read, Write, Edit, Glob, Grep, Bash, Agent` | Orchestrator; can spawn child agents |
| **Web researcher** | `Read, WebFetch, WebSearch` | Information gathering; no file I/O |
| **Code reviewer** | `Read, Glob, Grep` | Audit-only; can read but not write |

## Example — LazyBuddy Agent Map (partial)

| # | Role | Implementation File | Model | Tools | Authority Boundaries | Auth Notes | Status |
|---|------|---------------------|-------|-------|---------------------|-----------|--------|
| 1 | Orchestrator | `lazybuddy-plugin/agents/lazybuddy-orchestrator.md` | claude-opus-4-20250514 | `Read,Write,Edit,Glob,Grep,Bash,Agent,TaskCreate,TaskUpdate,TaskList` | Must not spawn >5 subagents concurrently; must track all spawned agents in task ledger | Needs full tool access for taskloop coordination | active |
| 2 | Explorer | `lazybuddy-plugin/agents/lazybuddy-explorer.md` | claude-sonnet-4-20250514 | `Read,Glob,Grep,Bash(read-only)` | Read-only; no Write/Edit; no agent spawning | File system exploration only | active |
| 3 | Librarian | `lazybuddy-plugin/agents/lazybuddy-librarian.md` | claude-sonnet-4-20250514 | `Read,Glob,Grep,Write` | Can write to `.lazybuddy/knowledge/` only; no writes to skill/agent/hook files | Semantic memory and knowledge indexing | active |
| 4 | Plan | `lazybuddy-plugin/agents/lazybuddy-plan.md` | claude-opus-4-20250514 | `Read,Glob,Grep,TaskCreate,TaskUpdate` | Read-only for code; can write task definitions only | Task decomposition and dependency analysis | active |
| 5 | Worker | `lazybuddy-plugin/agents/lazybuddy-worker.md` | claude-sonnet-4-20250514 | `Read,Write,Edit,Glob,Grep,Bash` | Must follow plan task assignments; one task at a time; must update task status | Implementation-only agent | active |
| 6 | Reviewer | `lazybuddy-plugin/agents/lazybuddy-reviewer.md` | claude-sonnet-4-20250514 | `Read,Glob,Grep,Bash(read-only)` | Read-only audit; reports findings; never modifies code | Quality gate; runs before task is marked complete | active |

## Summary

| Status | Count |
|--------|-------|
| active | [N] |
| pending | [N] |
| skipped | [N] |
| **Total** | **[N]** |
