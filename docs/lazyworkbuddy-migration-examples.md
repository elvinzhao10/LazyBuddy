# Lazyworkbuddy Migration Examples

> v0.10 — Worked examples: a hypothetical host without native extension surfaces,
> and a single-skill migration with full method extraction.

## Example A: LazyCodex → Hypothetical "HostX"

HostX has no Skills, Agents, or Hooks — just a system prompt, flat tool roster (Bash, Read,
Write, Edit, Glob, Grep, WebFetch), and `/tmp/` for file state. The migration planner adapts
LazyCodex's extension model to this primitive surface.

### Adaptation Strategy

- **Skill → System prompt:** Each skill's step-by-step process becomes a system prompt section.
  Quality gates become assertion blocks. Activation triggers become prefix sections.
- **Agent → Tool with restricted access:** Each agent role becomes a role-mode block: "When acting
  as Explorer, you may only use Read, Glob, and Grep." `fork_context: false` → context reset
  instructions between roles.
- **Hook → Pre/post prompt wrapping:** SessionStart hooks → preamble block. PreToolUse constraints
  → inline: "Before every tool call, verify..." PostToolUse → post-tool instructions. Stop hooks
  cannot be replicated (no lifecycle events); continuation → explicit user prompting.
- **State → File-based:** `/tmp/hostx/state.json` + `/tmp/hostx/events.jsonl`. Manual Write calls
  at phase boundaries replace automatic state updates.

### Adaptation Table

| LazyCodex Method | HostX Adaptation | Status |
|-----------------|------------------|--------|
| 21 hooks (lifecycle injection) | System prompt preamble + tool-call constraint blocks | adapted (no async events) |
| 25 skills (structured workflows) | System prompt sections with numbered phases | adapted |
| 10 agents (role isolation + fork_context) | Role-mode blocks + context reset instructions | adapted (no true isolation) |
| 5 MCP servers | Direct tool calls (Bash, Grep, Read/Write) | adapted (reduced capability) |
| State ledger (.omo/ events.jsonl) | `/tmp/hostx/events.jsonl` via Write | adapted (manual only) |
| Stop-hook continuation | Explicit user prompt: "Continue start-work" | skipped (no lifecycle hooks) |

### Versioned Plan

- **v0.1 — Discovery:** Read all LazyCodex source. Map every method to HostX surface or gap.
- **v0.2 — System Prompt Core:** Flatten 25 skills into prompt sections. Add role-mode blocks.
- **v0.3 — State & Checkpoints:** Implement `/tmp/hostx/` file-based state.
- **v0.4 — Verification:** Test all workflows end-to-end. Document behavior gaps.
- **v0.5 — Templates:** Extract HostX adapter template for reuse.

Key gaps: no subagent isolation, no lifecycle hooks, no MCP tool abstraction, no automatic state.

## Example B: Single Skill — remove-ai-slops

Source: `reference/lazycodex/plugins/omo/skills/remove-ai-slops/SKILL.md`

### Method Extraction (10 categories + 6 phases)

| Category | Source | WB Equivalent | Status |
|----------|--------|---------------|--------|
| Scope detection (Phase 1) | `git diff merge-base main` via Bash | Same command | matched |
| Regression test lock (Phase 2) | Write tests, run green BEFORE edits | Same — non-negotiable safety invariant | matched |
| Deletion ladder (Phase 3) | Delete→Reuse→Platform→Simplify | Same logic | matched |
| Parallel agent cleanup (Phase 4) | `multi_agent_v1.spawn_agent` batches of 5 | Agent tool, sequential batch | adapted |
| Quality gate verify (Phase 5) | 5 gates via lsp_diagnostics + runner | Grep/Glob + Bash test runner + native lint | adapted |
| Critical review (Phase 5) | 16 checkboxes across Safety/Behavior/Quality | Identical checklist | matched |
| Fix-and-retry (Phase 6) | `git checkout` revert + Edit + re-verify | Same — Bash + Edit | matched |
| 10 slop categories | Defined with KEEP/REFACTOR rules per category | All 10 preserved verbatim | matched |
| Report format | 9-section Markdown output | Identical format | matched |
| Oversized module refactor | `check-no-excuse-rules.py` → split plan | Same logic; paths adapted | adapted |

### Key Adaptation: Phase 4 Tool Call

**Before (LazyCodex):**
```
multi_agent_v1.spawn_agent({
  message: "TASK: act as deep slop-cleanup agent for file X...",
  agent_type: "deep", load_skills: ["remove-ai-slops"],
  run_in_background: true, fork_context: false
})
// All 5 files in one message, wait via wait_agent + background_output
```

**After (WorkBuddy):**
```
Agent({
  subagent_type: "general-purpose",
  description: "Slop removal: src/foo.ts",
  prompt: "Remove AI slops from src/foo.ts using remove-ai-slops skill.
  Evaluate all 10 categories. Apply deletion ladder first.
  Report changes grouped by category with before/after/why-slop/why-safe."
})
// Sequential batch; next starts after current batch results collected
```

**Safety invariant preserved:** Regression tests FIRST, edits SECOND.
**All 10 categories + deletion ladder + 5 quality gates preserved.**
**Report format:** 9-section output structure identical to LazyCodex.

---

*These examples demonstrate the planner's adaptability: from full platform migration (HostX) to
single-skill port, the same 9-step methodology applies — discovery, mapping, adaptation,
verification, and documentation of every decision.*
