# Lazyworkbuddy Agent Inventory

> v0.5 — Complete inventory of all 12 WorkBuddy agents with role, model, tools, and LazyCodex mapping.

| # | File | Role | LazyCodex Source | Model | Effort | Max Turns | Key Constraint |
|---|------|------|-----------------|-------|--------|-----------|----------------|
| 1 | `lazyworkbuddy-orchestrator.md` | Orchestrator (Sisyphus) | [start-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) | default | high | 100 | Never implements directly |
| 2 | `lazyworkbuddy-planner.md` | Planner (Prometheus) | [ulw-plan/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md) | reasoning | xhigh | 80 | `disallowedTools: [Write, Edit]` |
| 3 | `lazyworkbuddy-explorer.md` | Explorer | [explorer.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/explorer.toml) | lite | low | 40 | Read-only |
| 4 | `lazyworkbuddy-implementer.md` | Implementer | [lazycodex-executor.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/lazycodex-executor.toml) | default | high | 60 | `disallowedTools: [Agent]` |
| 5 | `lazyworkbuddy-verifier.md` | Verifier (Oracle) | [lazycodex-gate-reviewer.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/lazycodex-gate-reviewer.toml) | reasoning | xhigh | 30 | Read-only |
| 6 | `lazyworkbuddy-reviewer.md` | Reviewer (Momus+Metis) | [momus.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/momus.toml), [metis.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/metis.toml) | reasoning | xhigh | 50 | Read-only |
| 7 | `lazyworkbuddy-qa-executor.md` | QA Executor | [lazycodex-qa-executor.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/lazycodex-qa-executor.toml) | default | medium | 60 | Write to evidence only |
| 8 | `lazyworkbuddy-gate-reviewer.md` | Gate Reviewer (Oracle) | [lazycodex-gate-reviewer.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/lazycodex-gate-reviewer.toml) | reasoning | xhigh | 30 | Read-only; APPROVE/REJECT |
| 9 | `lazyworkbuddy-librarian.md` | Librarian | [librarian.toml](../reference/lazycodex/plugins/omo/components/ultrawork/agents/librarian.toml) | lite | low | 20 | Write to memory files only |
| 10 | `lazyworkbuddy-migration-planner.md` | Migration Planner | WorkBuddy-native (no LazyCodex equivalent) | default | high | 50 | Write to adapter docs only |
| 11 | `lazyworkbuddy-context-indexer.md` | Context Indexer | [init-deep/SKILL.md](../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md) | lite | low | 40 | Write to .lazyworkbuddy/context/ only |
| 12 | `lazyworkbuddy-security-auditor.md` | Security Auditor | [review-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md) (Agent 4) | reasoning | high | 30 | Read-only |

## Model Routing

| Model | Agents | Rationale |
|-------|--------|-----------|
| **reasoning** (strong) | planner, verifier, reviewer, gate-reviewer, security-auditor | Complex analysis requiring deep reasoning |
| **default** (balanced) | orchestrator, implementer, qa-executor, migration-planner | General-purpose with good tool use |
| **lite** (fast) | explorer, librarian, context-indexer | Fast, read-heavy tasks; minimal reasoning needed |

## Status

All 12 agents are ✅ **active** (v0.5). Tool restrictions are enforced by both YAML frontmatter `disallowedTools` and system prompt Forbidden Actions sections. Agent spawning is done by the orchestrator via the WorkBuddy Agent tool with `isolation: true` for all spawned agents.

---

_See `docs/lazyworkbuddy-agent-orchestration.md` for the full lifecycle flow and `docs/lazyworkbuddy-handoff-protocol.md` for inter-agent communication._
