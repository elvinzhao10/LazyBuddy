# LazyBuddy Migration Planner

> **Historical/non-operational record.** This dated record is retained for context only. Current guidance: [README.md](../README.md), [AGENTS.md](../AGENTS.md), and [plugin README](../lazybuddy-plugin/README.md).

> v0.10 — Reusable 9-step workflow for porting LazyCodex semantics to any agent host
> while preserving behavior, documenting every adaptation, and maintaining clean-room boundaries.

## Overview

The migration planner is a proven methodology extracted from LazyBuddy's own experience
migrating LazyCodex OmO (v4.16.0, 21 hooks, 5 MCP, 25 skills, 10 agents) into WorkBuddy.
It produces a versioned execution plan, parity ledger, self-adapter document, and gaps register.
The workflow is host-agnostic: whether the target is WorkBuddy, "HostX", or a custom harness,
the same 9 steps apply.

## The 9 Steps

1. **Discovery (v0.0)** — Read every source file in the origin plugin. Build a complete method
   inventory with file paths and line ranges. Flag opaque/encrypted components.

2. **Architecture (v0.1)** — Map origin extension surfaces to target surfaces. Identify structural
   equivalents and gaps. Output: three-layer model (Plugin/Project Memory/Run State).

3. **Memory (v0.2)** — Port project memory conventions: rename reserved files, adapt hierarchical
   rule loading, update variable references. Output: `workbuddy.md` + `.workbuddy/rules/`.

4. **Scaffold (v0.3)** — Create target plugin manifest, empty directories, install/uninstall story.
   Output: structurally valid plugin that loads without error.

5. **Skills (v0.4)** — Port core workflow skills one per source file. Replace all platform-specific
   tool calls. Translate paths and variables. Add "Adapted from..." citations.

6. **Agents (v0.5)** — Port agent roles with YAML frontmatter. Preserve role constraints (e.g.,
   planner never writes product code), tool allow/deny lists, isolation settings.

7. **Hooks (v0.6)** — Map origin hook events to target hooks. Merge multiple origin hooks sharing
   the same target event. Write hook scripts using target-native scripting.

8. **Run State (v0.7)** — Port run lifecycle: boulder/ledger → state.json + events.jsonl. Preserve
   schema fields. Add target-native enhancements.

9. **Hardening (v0.9)** — Audit every adaptation for semantic loss. Recover dropped constraints.
   Document remaining gaps. Output: gaps register with all G-### entries resolved.

10. **Generalization (v0.10)** — Extract reusable method: templates, decision trees, the
    self-adapter format itself. This doc.

## Legal/IP Boundary

- **Clean-room adaptation:** Never copy protected material verbatim. Re-implement semantics from
  public behavior descriptions.
- **Trace every claim to a source file.** Every "LazyCodex does X" cites a specific path in
  `dev/reference/lazycodex/`.
- **Document deviations honestly.** If a method can't be adapted, say so and explain why in the
  gaps register (`docs/lazybuddy-known-gaps.md`).
- **Source inspection only.** No code is copied; all re-implementations are original work
  targeting the new host.

## Using the Templates

| Template | Step | Purpose |
|----------|------|---------|
| `templates/self-adapter-template.md` | 1-9 | Structure self-adapter for any migration |
| `templates/parity-ledger-template.md` | 1-9 | Track every method: matched/adapted/skipped/added |
| `templates/versioned-plan-template.md` | 2-9 | Per-version objectives, files, verification, risks |
| `templates/gaps-register-template.md` | 1-9 | Documented deviations with impact and mitigation |
| `templates/method-map-template.md` | 1 | Raw method inventory before mapping |

## Example Scenario: LazyCodex → WorkBuddy

The canonical migration that produced this planner. 48 total methods, 36 adapted (75%), 11
skipped, 12 added as WorkBuddy-native enhancements. Full details in
`docs/lazybuddy-self-adapter.md`.

## Decision Points

**When a method has no target equivalent:** Skip with documented reason. Add G-### entry with
what LazyCodex does, why it can't be ported, impact, and future target version possibility.
Example: G-002 (21→12 hooks — Codex-specific components skipped).

**When behavior-preserving adaptation is impossible:** Document as a gap. Mark as `skipped` with
gap reference. Example: G-004 model routing — WorkBuddy's agent model is simpler; LazyCodex
multi-model routing is not available in the target.

**When the target has a better way:** Add as `added` enhancement. Do not claim adaptation — it's
a target-native improvement. Examples: checkpoint protocol, PostToolUseFailure hook,
parity-dashboard MCP, status-dashboard MCP.

**When adaptation is possible but lossy:** Adapt with gap reference. Mark as `adapted` but add
G-### recording what was lost. Recover in v0.9 hardening if significant. Examples: G-007 through
G-014 (semantic losses during skill condensation, all recovered).

**When source behavior is undocumented:** Do not guess. Mark as `unverified` and file G-###.
Return during v0.9 hardening with fresh source inspection.

---

*Self-referential: the migration planner Skill was created using this workflow, documenting its
own creation in v0.10 of the LazyBuddy execution plan.*
