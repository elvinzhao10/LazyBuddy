# LazyBuddy Self-Adapter

> v0.10 — How LazyBuddy migrated LazyCodex OmO into WorkBuddy. Every claim cites a specific
> source path under `dev/reference/lazycodex/`. This is the "show your work."

## Source: LazyCodex (OmO v4.16.0)

- **Source inspected:** `dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json` — 4.16.0, 21 hooks, 5 MCP, 25 skills
- **Key source files:** Skills: `dev/reference/lazycodex/plugins/omo/skills/*/SKILL.md` (init-deep, ulw-plan, start-work, ulw-loop, ultrawork, review-work, programming, remove-ai-slops, git-master, debugging, plus 15 more)
- **Agents:** `dev/reference/lazycodex/plugins/omo/components/ultrawork/agents/*.toml` (explorer, librarian, plan, lazycodex-executor, lazycodex-code-reviewer, lazycodex-gate-reviewer, lazycodex-qa-executor, metis, momus, lazycodex-clone-fidelity-reviewer)
- **Hooks:** `dev/reference/lazycodex/plugins/omo/hooks/*.json` (21 configs across SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostCompact, Stop, SubagentStop)
- **Components:** `dev/reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts` + `dev/reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/src/codex-hook.ts`
- **State:** `dev/reference/lazycodex/plugins/omo/.omo/boulder.json` + `.omo/start-work/ledger.jsonl`

## Target: WorkBuddy

- **Extension surfaces:** Skills (`skills/*/SKILL.md`), Commands (`commands/*.md`), Agents (`agents/*.md` with YAML frontmatter), Hooks (`hooks/hooks.json`), MCP (`.mcp.json`), Plugin manifest (`.codebuddy-plugin/plugin.json`)
- **Agent model:** YAML frontmatter — `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `isolation`
- **Hook model:** 26 event types, `command`/`http`/`prompt`/`agent` types, `${CODEBUDDY_PLUGIN_ROOT}` for paths

## The Migration: Phase by Phase

### v0.0: Discovery
Read all LazyCodex source, created method map. **Source:** `dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json` + all skills/agents/hooks

### v0.1: Architecture
Three-layer model: Plugin / Project Memory / Run State. **Source:** `dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json` manifest structure

### v0.2: Memory
`workbuddy.md` + `.workbuddy/rules/`. **Source:** `dev/reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md` (AGENTS.md generation), `dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json` + `user-prompt-submit-loading-project-rules.json` (rule loading)

### v0.3: Scaffold
Manifest + placeholder + validation. **Source:** `dev/reference/lazycodex/plugins/omo/.codex-plugin/plugin.json`

### v0.4: Skills — 15 ported
10 from LazyCodex + 5 native. All under `dev/reference/lazycodex/plugins/omo/skills/`:
1. `init-deep/SKILL.md` 2. `ulw-plan/SKILL.md` 3. `start-work/SKILL.md` 4. `ulw-loop/SKILL.md`
5. `ultrawork/SKILL.md` 6. `review-work/SKILL.md` 7. `programming/SKILL.md`
8. `remove-ai-slops/SKILL.md` 9. `git-master/SKILL.md` 10. `debugging/SKILL.md`

### v0.5: Agents — 13 created
9 from LazyCodex + 4 native. Under `dev/reference/lazycodex/plugins/omo/components/ultrawork/agents/`:
`explorer.toml`, `plan.toml`, `librarian.toml`, `lazycodex-executor.toml` → orchestrator,
`metis.toml` + `momus.toml` → reviewer (merged), `lazycodex-gate-reviewer.toml`, `lazycodex-qa-executor.toml`,
`lazycodex-code-reviewer.toml` → reviewer (merged), `lazycodex-clone-fidelity-reviewer.toml` → not ported

### v0.6: Hooks — 12 hooks with scripts
Mapped 21→12. Key sources:
- **Continuation:** `dev/reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json` + `subagent-stop-checking-start-work-continuation.json` +
  `dev/reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts`
- **Evidence verify:** `dev/reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/src/codex-hook.ts`
- **Session:** `dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json` + `session-start-checking-bootstrap-provisioning.json`
- **Prompt:** `dev/reference/lazycodex/plugins/omo/hooks/user-prompt-submit-checking-ultrawork-trigger.json` + `user-prompt-submit-checking-ulw-loop-steering.json` + `user-prompt-submit-loading-project-rules.json`
- 5 new hooks added: PostToolUseFailure, StopFailure, SubagentStart, TaskCreated, TaskCompleted

### v0.7: Run State
`.lazybuddy/` ledger. **Source:** `dev/reference/lazycodex/plugins/omo/.omo/boulder.json` → `state.json`,
`dev/reference/lazycodex/plugins/omo/.omo/start-work/ledger.jsonl` → `events.jsonl`. Enhanced: checkpoint protocol, progress tracking, iteration management.

### v0.8: MCP — 5 servers
`run-ledger`, `parity`, `verification`, `source-map`, `status-dashboard`. **Source:** `dev/reference/lazycodex/plugins/omo/.mcp.json` (pattern). Servers are LazyBuddy-native — not ported from LazyCodex.

### v0.9: Hardening — 9 gaps resolved
All semantic-loss gaps (G-007–G-015) resolved:
- `dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md` — G-007 (L118, 9 adversarial classes), G-008 (L71-92, worktree), G-009 (L176-184, debugging audit), G-010 (L136-160, Sisyphus schema)
- `dev/reference/lazycodex/plugins/omo/skills/ulw-loop/references/full-workflow.md` — G-011 (L144, iteration caps), G-012 (L206-220 steering, L183-204 quality gate, L35-61 delegation)
- `dev/reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md` — G-013 (L291-302, transition barriers), G-014 (L226-230 GREEN-step, L330-337 commits)
- G-015: context-miner agent created as `lazybuddy-plugin/agents/lazybuddy-context-miner.md`

### v0.10: Migration Planner
Extracted reusable methodology. Self-referential source: `docs/lazybuddy-versioned-execution-plan.md`, `docs/lazybuddy-parity-ledger.md`, `docs/lazybuddy-known-gaps.md`.

## Tool Translation Table

| LazyCodex | WorkBuddy | Notes |
|-----------|-----------|-------|
| `multi_agent_v1` / `spawn_agent` | Agent tool | `isolation: true` preserves `fork_context` |
| `.omo/` | `.lazybuddy/` | Renamed; no semantic change |
| `${PLUGIN_ROOT}` | `${CODEBUDDY_PLUGIN_ROOT}` | Renamed; same resolution |
| `AGENTS.md` | `workbuddy.md` | Renamed; same hierarchical structure |
| `fork_context` | `isolation: true` | Subagent isolation preserved |
| `agent_type` routing | Agent name-based routing | Type dispatch → name dispatch |
| `update_plan` | `TaskCreate`/`TaskUpdate` | WorkBuddy-native task management |
| `codegraph_*`/`lsp_*` | Glob/Grep/native LSP | WorkBuddy-native tools |
| `load_skills=[...]` | Standard skill activation | WorkBuddy-native skill loading |
| Codex task spawning | WorkBuddy Agent tool | Same semantics; different API |

## Parity Summary

From `docs/lazybuddy-parity-ledger.md`:
- **Total LazyCodex methods:** 48 | **Matched:** 1 | **Adapted:** 36 | **Skipped:** 11 | **Added:** 12
- **Coverage:** 75% adapted/matched (37 of 48 ported)
- **Gaps:** G-001 through G-015, all resolved or documented in `docs/lazybuddy-known-gaps.md`

## Deviations

From `docs/lazybuddy-known-gaps.md`:
- **21→12 hooks** (G-002): Codex-specific components skipped (comment-checker, codegraph, LSP daemon, telemetry, auto-update, thread title hygiene). WorkBuddy handles LSP/telemetry natively.
- **5→5 MCP servers** (G-003): Different servers — LazyBuddy-native (`run-ledger`, `verification`, `parity`, `source-map`, `status-dashboard`) instead of LazyCodex external servers (grep_app, context7, codegraph, git_bash, lsp).
- **25→15 skills** (v0.4): Core subset ported. Remaining 11 (frontend, ast-grep, lsp, lsp-setup, refactor, rules, comment-checker, visual-qa, teammode, ultimate-browsing, ulw-research) planned for v0.13.
- **10→13 agents** (v0.5): 9 LazyCodex roles ported (Metis+Momus→reviewer merged, code-reviewer→reviewer merged). 7 native agents added. Clone-fidelity-reviewer skipped.
- **Model routing** (G-004): Single model with per-agent `model` field. LazyCodex multi-model routing (quick/ultrabrain/coding) not available. Permanent gap.

---

*Updated by the Librarian after each version. Canonical reference for the migration planner methodology.*
