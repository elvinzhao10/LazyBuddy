---
name: librarian
description: "Update project memory after accepted changes: workbuddy.md, command index, parity ledger, known gaps, risk register."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# librarian

> **LazyCodex source:** [reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md) (update mode concept — modify existing + create new where warranted) and the librarian agent role from [reference/lazycodex/plugins/omo/skills/start-work/SKILL.md](../../../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) (knowledge-management agent).

## Purpose

The librarian is a **read-mostly knowledge curator**. After every accepted change wave — a review gates pass, a `/start-work` orchestration completes, a `/ulw-loop` criteria set is verified — the librarian inspects what changed, updates the durable memory files, and records the delta in the parity ledger. It never rewrites the canonical method map (the authoritative architecture summary generated from repo evidence) unless the repo structure itself changed.

## Trigger Conditions

- `/start-work` prints `ORCHESTRATION COMPLETE` with a passing Global Review Gate
- `/ulw-loop` marks all success criteria verified
- `/review-work` returns all 5 lanes PASS
- A manual-QA evidence set is committed to `.lazyworkbuddy/runs/<run_id>/events.jsonl`
- User says "update memory", "update docs", "refresh docs", "librarian", "after review"

## Required Context

- The changed files diff (from the completed work unit)
- The plan file that drove the work (`.lazyworkbuddy/plans/<slug>.md`)
- The evidence ledger (`.lazyworkbuddy/runs/<run_id>/events.jsonl`)
- Existing memory files: `workbuddy.md` (root), any subdirectory `workbuddy.md` files
- The parity ledger (`.lazyworkbuddy/parity-ledger.jsonl`)
- The known gaps register (`.lazyworkbuddy/known-gaps.md`)
- The risk register (`.lazyworkbuddy/risk-register.md`)
- The command index (`.lazyworkbuddy/command-index.md`)
- The canonical method map (`.lazyworkbuddy/canonical-method-map.md`) — **READ ONLY, never rewrite unless repo evidence changes**

## Tool Access

This skill is **read-mostly**. It writes only to `.lazyworkbuddy/` memory files, never to product code.
- Allowed: Read, Grep, Glob, Write (`.lazyworkbuddy/` only), Edit (`.lazyworkbuddy/` only), Bash (read-only inspection)
- Strictly disallowed: Write or Edit to any product source file

## Step-by-Step Procedure

### 1. Ingest the change evidence

Read the completed work's diff (changed files, lines added/removed), the plan file, and the evidence ledger. Identify:
- Which modules, packages, or layers were touched
- Whether new abstractions, APIs, or patterns were introduced
- Whether existing conventions were altered or deprecated
- Whether new commands, skills, or workflows were added

### 2. Update the durable memory files

Apply updates to each file in priority order. Use `Edit` when the file exists; use `Write` only for new files. **Never rewrite an entire section from scratch — append or modify in place.**

#### workbuddy.md (root + subdirectory)

Follow the init-deep update-mode semantics:
- **STRUCTURE** section: update only if directory layout changed
- **WHERE TO LOOK** table: add entries for new modules; remove entries for deleted modules
- **CODE MAP** table: add symbols that were introduced; remove symbols that were deleted. Update ref counts if LSP/codegraph revealed changes
- **CONVENTIONS** section: add new conventions; strike deprecated ones
- **ANTI-PATTERNS** section: add newly discovered anti-patterns; remove those no longer observed
- **UNIQUE STYLES** section: add if the change introduced a project-specific style
- **COMMANDS** section: update if build/test/dev commands changed
- **NOTES** section: add gotchas discovered during implementation

Subdirectory `workbuddy.md` files follow the same rules but at reduced scope — 30-80 lines, never repeat parent content.

#### command-index.md

If the change added a new skill or command:
- Add an entry: command name, invocation, purpose, source skill, composition relationships
- Update cross-references if an existing command's composition changed

#### parity-ledger.jsonl

Append one JSONL line recording the update:

```json
{
  "event": "librarian-update",
  "timestamp": "<ISO 8601>",
  "source_work": "<plan slug or work id>",
  "changed_files": ["workbuddy.md", "command-index.md"],
  "sections_updated": ["CODE MAP", "WHERE TO LOOK"],
  "new_entries": 3,
  "deprecated_entries": 1,
  "canonical_map_unchanged": true
}
```

#### known-gaps.md

If the work revealed a gap — missing test coverage, unimplemented edge case, incomplete documentation — add it. If the work closed a previously known gap, mark it resolved with the source work id and date. Format each gap as:

```markdown
- [ ] **GAP-<id>** — <one-line description> — discovered: <date> — severity: LOW|MEDIUM|HIGH — source: <work id>
```

#### risk-register.md

If the work introduced a new risk (new dependency, increased blast radius, known limitation) or retired an existing one, update the register. Format each risk as:

```markdown
- **RISK-<id>**: <description> — likelihood: LOW|MEDIUM|HIGH — impact: LOW|MEDIUM|HIGH — mitigation: <one-line> — status: OPEN|MITIGATED|CLOSED
```

#### CHANGELOG.md

After every accepted change, add a CHANGELOG entry. Format:

```markdown
## [<version>] — <YYYY-MM-DD>

- <one-line summary of what changed>
- <one-line summary of verification status>
```

This is mandatory — do not skip. The CHANGELOG is the user-facing record of what changed and why.

### 3. Guard: never rewrite the canonical method map

The canonical method map (`.lazyworkbuddy/canonical-method-map.md`) is the authoritative architecture summary. It is generated from repo evidence — LSP symbol inventory, codegraph call graphs, module boundaries. **Only update it when the repo structure changed**, not when conventions, notes, or usage patterns changed.

Before touching the method map, verify the trigger:
- Was a new top-level module created or removed? → Update module entry
- Was a public API surface (exported symbol) added, changed, or removed? → Update symbol entry
- Was a cross-cutting dependency chain added or broken? → Update dependency arcs

If none of these hold, record `"canonical_map_unchanged": true` in the parity ledger and move on.

**v0.9 hardening:** The canonical method map is regenerated ONLY when `reference/lazycodex/` evidence changes AND the diff justifies a structural update. Conventions, usage notes, and WorkBuddy-specific adaptations recorded in `workbuddy.md` or the parity ledger do NOT trigger a method map rewrite. The method map is a mirror of the LazyCodex architecture, not a design document.

### 4. Post-accept update scope (v0.9)

After every accepted change (review verdict `accept`), the librarian updates these seven artifacts in priority order:

1. **workbuddy.md** (root) — Update STRUCTURE, WHERE TO LOOK, CODE MAP, CONVENTIONS, COMMANDS, NOTES sections as applicable. Use diff-before-write: only append new information or modify existing entries; never delete human-authored content.
2. **command-index.md** — Add entries for new skills/commands; update cross-references for changed compositions.
3. **parity-ledger.jsonl** — Append a `librarian-update` event recording the source work, changed files, sections updated, and whether the canonical map was modified.
4. **known-gaps.md** — Add newly discovered gaps; mark resolved gaps with the source work id and resolution date.
5. **risk-register.md** — Add new risks introduced by the change; retire risks that no longer apply.
6. **operating-manual.md** — If the change introduced new operational procedures (new commands, new startup sequences, new deployment steps), append to the operating manual. Do not rewrite existing procedures unless the change explicitly deprecated them.
7. **Subdirectory workbuddy.md files** — If the change touched code in a subdirectory that has its own `workbuddy.md`, update that file with the same append/modify discipline at reduced scope (30-80 lines, never repeat parent content).

### 5. Update records (v0.9)

All memory updates are recorded in `.lazyworkbuddy/runs/<run_id>/memory_updates/` for traceability:

| File | Content |
|------|---------|
| `changes.json` | List of files modified, sections touched, entry counts (new/deprecated/modified) |
| `diff_summary.md` | Human-readable before/after for each modified file |
| `source_map.json` | For every updated entry: source file path, line range, timestamp of the change that triggered the update |
| `validation.json` | Post-update validation results: no duplicates, no orphans, no product file touched, all parity entries referenced |

### 6. Validate consistency

After all writes:
- Re-read every file that was modified
- Confirm no duplicate entries were created
- Confirm the parity ledger's `changed_files` list matches what was actually written
- Confirm no product file was touched
- Confirm every entry in `source_map.json` references a valid source file and line range

## Expected Output Artifacts

1. Updated `workbuddy.md` files (root + any affected subdirectories)
2. Updated `command-index.md` (if commands/skills changed)
3. Appended `.lazyworkbuddy/parity-ledger.jsonl` entry
4. Updated `.lazyworkbuddy/known-gaps.md` (if gaps were discovered or closed)
5. Updated `.lazyworkbuddy/risk-register.md` (if risks changed)
6. Updated `operating-manual.md` (if operational procedures changed)
7. Optionally updated `.lazyworkbuddy/canonical-method-map.md` (only if repo structure changed)
8. `.lazyworkbuddy/runs/<run_id>/memory_updates/` record files (`changes.json`, `diff_summary.md`, `source_map.json`, `validation.json`)

## Verification Gates

1. All memory files parse correctly (no JSONL syntax errors, no markdown corruption)
2. No duplicate entries in any index or register
3. Every updated section references the source work id in the parity ledger
4. The canonical method map was NOT rewritten without a triggering repo structure change
5. No product source file was modified

## Failure Behavior

- If a memory file is missing: create it from scratch using the init-deep discovery procedure (Read + Grep + Glob + LSP), record it as a bootstrap in the parity ledger
- If a memory file is corrupted (unparseable): back it up to `.lazyworkbuddy/backups/<filename>.bak.<timestamp>`, recreate the file, record the recovery
- If the diff is too large (>50 files changed): spawn an explorer subagent via the WorkBuddy Agent tool to survey the changes before updating memory
- If the librarian cannot determine whether a change is a convention or a one-off: record it in a `## Unclassified` section with a `NEEDS-TRIAGE` tag and file:line reference

## Handoff Format

```
Librarian update complete.
  Source work: <plan slug or work id>
  Files updated: <count>
  Sections modified: <list>
  New gaps: <count> | Closed gaps: <count>
  New risks: <count> | Closed risks: <count>
  Canonical method map: <unchanged | updated for <reason>>
  Parity ledger entry: appended
```

## State Ledger Integration (v0.7)

The librarian now writes memory update records through the state/ script layer, linking each update to the originating run's evidence trail.

- **Memory update recording:** After completing all memory file updates (workbuddy.md, command-index.md, parity-ledger.jsonl, known-gaps.md, risk-register.md, canonical-method-map.md), the librarian calls `${CODEBUDDY_PLUGIN_ROOT}/scripts/state/append-event.sh <run_id> librarian_update "<json>"` to write a structured record to `events.jsonl`. The JSON payload includes `source_work`, `changed_files[]`, `sections_updated[]`, `new_entries`, `deprecated_entries`, and `canonical_map_unchanged`.
- **Traceability:** Each `librarian_update` event in `events.jsonl` creates a durable link between the originating run's execution trail and the project memory changes, enabling future agents to trace why a convention was added or a gap was closed.
- **Read-mostly discipline:** The librarian uses the state/ scripts only for writing events — it never modifies `state.json` directly. All memory file writes use WorkBuddy's standard Read/Edit/Write tools, restricted exclusively to `.lazyworkbuddy/` paths.

## WorkBuddy-Native Features

- **Agent tool:** Librarian runs as a dedicated agent spawned by the orchestrator. When spawned, use `"message":"TASK: act as a librarian — update durable memory after accepted changes. DELIVERABLE: updated memory files + parity ledger entry. SCOPE: .lazyworkbuddy/ files only. VERIFY: re-read all modified files, confirm no duplicates, confirm no product file touched."`
- **TaskCreate/TaskUpdate:** Track each memory file update as a task step. Mark `in_progress` when starting a file, `completed` when done.
- **Read/Write/Edit discipline:** Use `Read` to inspect every file before modifying. Use `Edit` for in-place changes. Use `Write` only for new files.
- **Subdirectory parallelism:** When multiple subdirectory `workbuddy.md` files need updating, use the WorkBuddy Agent tool to spawn parallel librarian subagents — one per subdirectory — with `isolation: true` and the specific subdirectory diff as context.
- **Parity ledger:** All `.lazyworkbuddy/` state paths use the WorkBuddy-native directory convention instead of LazyCodex `.omo/`.

---
_Adapted from LazyCodex init-deep update mode (modify existing, create new where warranted, never blind-regenerate) and the librarian agent role from start-work (external docs, knowledge management, read-mostly curation). The canonical method map guard is a Lazyworkbuddy pattern: the architecture summary is repo-evidence-derived, never hand-curated. Adapted: `AGENTS.md` → `workbuddy.md`; `.omo/` → `.lazyworkbuddy/`; `multi_agent_v1` → WorkBuddy Agent tool; `call_omo_agent(librarian)` → WorkBuddy Agent tool with librarian role in message._
