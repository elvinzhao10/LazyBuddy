---
name: init-deep
description: "MUST USE for initializing or updating hierarchical project memory in a Workspace. Inspects repo structure, identifies language/runtime/test/build commands, scores directories by complexity, generates .lazyworkbuddy/context/ knowledge base. Triggers: init-deep, initialize project, create project memory, update project memory, understand this codebase, what's in this repo, map this project."
---

# init-deep

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md)

## Purpose

Generate hierarchical project memory for the current WorkBuddy workspace. Scores directories by complexity (file count, subdir count, code ratio, symbol density, reference centrality), generates `workbuddy.md` at root and subdirectory variants where warranted, and produces a `.lazyworkbuddy/context/` knowledge base for future agents.

## Trigger Conditions

- User types `/init-deep` or requests project initialization
- New workspace where no `workbuddy.md` exists
- Workspace structure has changed significantly
- User says "understand this codebase", "map this project", "create project memory"

## Required Context

Before generating, inspect:
- `workbuddy.md` if it already exists (update mode)
- Root directory structure (`ls -la`, `find` for file counts)
- `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or equivalent project manifest
- Existing docs, README files, CONTRIBUTING files
- Test directories and test runner configuration
- CI/CD configuration (`.github/workflows/`, `Makefile`, etc.)

## Tool Access

This skill is **read-only** — it never modifies product code.
- Allowed: Read, Glob, Grep, Bash (read-only analysis commands), WebSearch
- Disallowed: Write, Edit (on product paths)

## Step-by-Step Procedure

### Phase 1: Discovery + Analysis (concurrent)

1. **Fire exploration in parallel.** Spawn subagents (WorkBuddy Agent tool) to map structure, entry points, conventions, anti-patterns, build/CI, and test patterns. Use `isolation: true` (no parent history) for each.

2. **While subagents run**, in the main session:
   - Run structural analysis: `find . -type d` for directory depth, `find . -type f` for file counts, code concentration by extension
   - Read existing `workbuddy.md` if present
   - Check for LSP diagnostics on key files

3. **Collect subagent results.** Merge bash analysis + subagent findings.

### Phase 2: Scoring & Location Decision

Score each significant directory using this matrix:

| Factor | Weight | High Threshold |
|--------|--------|----------------|
| File count | 3x | >20 |
| Subdir count | 2x | >5 |
| Code ratio | 2x | >70% |
| Unique patterns | 1x | Own config |
| Module boundary | 2x | Has index file |
| Symbol density | 2x | >30 symbols |

- Score >15: create `workbuddy.md` variant in that directory
- Score 8-15: create if distinct domain
- Score <8: skip (parent covers)
- Root: ALWAYS create

### Phase 3: Generate workbuddy.md

Write root `workbuddy.md` with:
- **OVERVIEW:** 1-2 sentence project summary + core stack
- **STRUCTURE:** Directory tree with non-obvious purposes
- **WHERE TO LOOK:** Task → location → notes mapping
- **CONVENTIONS:** Only deviations from standard
- **ANTI-PATTERNS:** Explicitly forbidden in this project
- **COMMANDS:** dev/test/build commands

Quality gates: 50-150 lines, no generic advice, no obvious info.

### Phase 4: Generate context knowledge base

Write to `.lazyworkbuddy/context/`:
- `index.md` — structured project overview
- `commands.json` — discovered dev/test/build/lint commands
- `project-map.json` — directory → purpose, language, complexity score mapping

### Phase 5: Review & Deduplicate

- Remove generic advice from all generated files
- Remove parent duplicates from subdirectory variants
- Trim to size limits
- Verify telegraphic style

## Expected Output Artifacts

- `workbuddy.md` at root (50-150 lines, quality-gate passing)
- Subdirectory `workbuddy.md` variants where score warrants
- `.lazyworkbuddy/context/index.md`
- `.lazyworkbuddy/context/commands.json`
- `.lazyworkbuddy/context/project-map.json`

## Verification Gates

1. `workbuddy.md` exists and is 50-150 lines
2. No generic filler content (tested by checking for common phrases)
3. Hierarchy is correct (child does not repeat parent)
4. `.lazyworkbuddy/context/` files exist and are parseable

## Failure Behavior

- If repo is too large for single-pass: document the gap and recommend `--max-depth=N`
- If no project manifest found: note in generated files that stack was inferred
- If scoring produces no subdirectory variants: that is valid — only root is mandatory

## Handoff Format

After completion, report:
```
=== init-deep Complete ===
Mode: {update | create-new}
Files:
  [OK] ./workbuddy.md (root, {N} lines)
Dirs Analyzed: {N}
workbuddy.md Created: {N}
workbuddy.md Updated: {N}
Hierarchy:
  ./workbuddy.md
  └── src/.../workbuddy.md
```

## WorkBuddy-Native Features

- **Subagent spawning:** Use WorkBuddy Agent tool for parallel exploration with `isolation: true` (matching LazyCodex `fork_context: false`)
- **Skills:** Self-referencing — this is itself a WorkBuddy Skill
- **Project memory:** Writes to `workbuddy.md` (WorkBuddy-native project memory format)
- **`.lazyworkbuddy/`:** Context knowledge base goes in the run state directory

---

_Adapted from LazyCodex init-deep. All semantics preserved; paths adapted to WorkBuddy conventions. `multi_agent_v1.spawn_agent` → WorkBuddy Agent tool; `AGENTS.md` → `workbuddy.md`; `.omo/` → `.lazyworkbuddy/`._
