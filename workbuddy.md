# Lazyworkbuddy

> Project memory for any agent working in this workspace. Read this first.
> AGENTS.md is kept as the LazyCodex-style compat alias; this file is primary.

## What this is

**Lazyworkbuddy** is a WorkBuddy-native recreation of [LazyCodex](https://github.com/code-yeongyu/lazycodex) — the OmO agent harness for Codex. Rebuilds deep init, planning, autonomous execution, verification loops, review, and memory on WorkBuddy surfaces: Skills, Agents, Hooks, MCP, and plugin structure.

**Clean-room adaptation.** Preserve LazyCodex semantics; reimplement on WorkBuddy-native surfaces. Do not copy source code or prompts. The canonical LazyCodex source lives at `reference/lazycodex/` — inspect it directly, never guess from memory.

## Versioning

Pre-1.0 build: every phase is `v0.N`. Currently at **v0.2** (project memory foundation). MVP = v0.0–v0.7; strong benchmark = v0.0–v0.12.

## Structure

```
lazyworkbuddy/
├── workbuddy.md              # THIS FILE — primary project memory
├── AGENTS.md                 # LazyCodex compat alias (points here)
├── plan/                     # Versioned implementation plan (v0.0–v0.14)
├── docs/                     # Architecture, parity ledger, operating manuals
├── reference/lazycodex/      # Canonical LazyCodex repo (READ-ONLY)
├── scripts/                  # Migration and verification utilities
├── prompts/                  # Worker delegation prompts per version
├── .workbuddy/               # WorkBuddy workspace config
│   ├── rules/                # Project rules (loaded on session start)
│   ├── memory/               # Daily work logs + MEMORY.md
│   └── skills/               # Local Skills (future)
├── lazyworkbuddy-plugin/     # Installable plugin (v0.3+)
└── .lazyworkbuddy/           # Durable run state (v0.7+)
```

## Where to look

| Task | Location | Notes |
|------|----------|-------|
| Version plan | `plan/v0.<N>-*.md` | One file per version; read the matching phase |
| Architecture | `docs/lazyworkbuddy-architecture-plan.md` | Three-layer model, component map, data flow |
| Execution roadmap | `docs/lazyworkbuddy-versioned-execution-plan.md` | Per-version objectives, steps, verification |
| LazyCodex source | `reference/lazycodex/plugins/omo/` | Canonical truth for all LazyCodex behavior |
| Rule violations | `.workbuddy/rules/lazyworkbuddy.md` | Core operating rules |
| Parity tracking | `docs/lazyworkbuddy-parity-ledger.md` | What's matched, adapted, skipped, added |
| Known gaps | `docs/lazyworkbuddy-known-gaps.md` | Documented deviations from LazyCodex |
| Run log template | `docs/lazyworkbuddy-run-log-template.md` | Required output format for every version |
| Daily log | `.workbuddy/memory/YYYY-MM-DD.md` | Append-only work log |

## Conventions

- **v0.N naming only.** Never `v1`, `v2`, etc. — this is a pre-1.0 build.
- **Env vars:** `${CODEBUDDY_PLUGIN_ROOT}`, `${CODEBUDDY_PLUGIN_DATA}` — official, verified. Never ad-hoc names.
- **Plugin manifest:** `.workbuddy-plugin/plugin.json` — compat fallback to `.codebuddy-plugin/`.
- **Git identity:** Lazyworkbuddy `<lazyworkbuddy@local>` (local config).
- **`.gitignore`** excludes `reference/` and `.workbuddy/`.
- **No secrets in memory, logs, or evidence.** Redact tokens, credentials, PII before writing any file.
- **Trace every LazyCodex claim** to a file path in `reference/lazycodex/`. Never claim from memory.

## Six core commands

| Command | Purpose | When to use |
|---------|---------|-------------|
| `/init-deep` | Hierarchical project memory generation | First time in a workspace; after major restructure |
| `/ulw-plan` | Decision-complete work planning (Prometheus) | Before any multi-file or ambiguous change |
| `/start-work` | Orchestrated plan execution | When a plan is approved and ready to build |
| `/ulw-loop` | Verified completion loop | For open-ended tasks needing evidence-backed done |
| `/review-work` | 5-agent parallel review | After every significant implementation |
| `/ultrawork` | Binding ultrawork mode | When maximum precision and evidence are required |

## Anti-patterns (do NOT do these here)

- **Guessing LazyCodex behavior from memory.** Always trace to `reference/lazycodex/`.
- **Implementing without a plan.** Use `/ulw-plan` or Plan Mode before multi-file changes.
- **Claiming done without evidence.** Every completion needs commands run + artifacts produced.
- **Skipping review.** A separate reviewer agent must accept before work is considered done.
- **Stale memory.** Update `workbuddy.md`, parity ledger, and known gaps after accepted changes.
- **Claiming parity without evidence.** Log deviations in `docs/lazyworkbuddy-known-gaps.md`.
- **Blindly copying LazyCodex files.** Preserve semantics, reimplement natively.
- **Writing product code from root.** The orchestrator spawns workers; it never implements directly.

## Memory hygiene

- Daily work logs: `.workbuddy/memory/YYYY-MM-DD.md` — append-only, one line per substantive action.
- Long-term notes: `.workbuddy/memory/MEMORY.md` — curated, distill from daily logs older than 30 days.
- After accepted changes: update parity ledger + known gaps. Update `workbuddy.md` if conventions changed.

_See `.workbuddy/rules/` for detailed operating rules, verification discipline, safety gates, and memory maintenance policy._
