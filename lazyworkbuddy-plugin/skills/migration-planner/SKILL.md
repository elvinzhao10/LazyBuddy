---
name: migration-planner
description: "Creates host-adapter plans for porting LazyCodex semantics to a new platform. Requires canonical repo inspection + semantic mapping. Read-only except for writing adapter docs under .lazyworkbuddy/adapters/. Use when porting skills to a new agent harness, migrating from Codex to another runtime, or creating platform-agnostic skill definitions. Triggers: port to, migrate to, adapter plan, create adapter, platform migration, harness adapter, port skills."
---

# migration-planner

> **LazyCodex source:** None direct — this is a Lazyworkbuddy innovation generalized from our own adaptation experience (porting LazyCodex skills from Codex to WorkBuddy). It formalizes the adapter pattern we used to translate `multi_agent_v1` → WorkBuddy Agent tool, `.omo/` → `.lazyworkbuddy/`, `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`, and every Codex-specific tool call into WorkBuddy-native equivalents.

## Purpose

The migration-planner produces a **host-adapter plan** — a decision-complete document that maps every platform-specific primitive in a source skill set onto the target platform's native equivalents. It is a planning skill: it reads, searches, inspects, and writes only adapter documentation. It never modifies product code or source skills.

A host-adapter plan answers one question: "What must change for these skills to run natively on the target platform?" The answer is a semantic mapping, not a rewrite — every source behavior is preserved; only its invocation surface changes.

## Trigger Conditions

- "Port the skills to <platform>"
- "Create an adapter plan for <platform>"
- "Migrate from Codex to <target>"
- "How would these skills run on <harness>?"
- "Generate a platform-agnostic skill layer"
- "Build an adapter for <source> → <target>"

## Required Context

- **Canonical source skills:** The full skill set under `${CODEBUDDY_PLUGIN_ROOT}/skills/` or the specified source directory
- **Reference skills:** The LazyCodex originals under `reference/lazycodex/plugins/omo/skills/` (if adapting from LazyCodex)
- **Target platform spec:** The target harness's tool catalog, agent model, directory conventions, and capability boundaries
- **Existing adapter docs:** Any prior adapter plans under `.lazyworkbuddy/adapters/`
- **Parity ledger:** `.lazyworkbuddy/parity-ledger.jsonl` for prior migration decisions

If the target platform spec is not provided, the planner surveys the target's documentation, README, or tool schemas to infer the capability catalog before making any mapping decision.

## Tool Access

This skill is **read-only for product files**. It writes **only** to `.lazyworkbuddy/adapters/`.
- Allowed: Read, Grep, Glob, Bash (read-only inspection), Write (`.lazyworkbuddy/adapters/` only), Edit (`.lazyworkbuddy/adapters/` only)
- Strictly disallowed: Write or Edit to any skill SKILL.md under `${CODEBUDDY_PLUGIN_ROOT}/skills/` or any product source file

## Step-by-Step Procedure

### 1. Inspect the canonical source

**Mark "inspect-source" as in_progress.**

Read every source skill in the set. For each skill, extract:
- YAML frontmatter (name, description, trigger keywords)
- Tool usage patterns: every tool the skill invokes directly
- Agent spawning patterns: every subagent role and how it is spawned
- Directory paths: `.omo/`, `${PLUGIN_ROOT}`, skill-root references
- Harness-specific directives: hooks, continuation protocols, mailbox signals
- State file formats: JSON, JSONL, TOML files the skill reads or writes

Produce an **Inventory** — one row per skill, listing every platform dependency:

```markdown
| Skill | Tools Used | Agent Roles | State Paths | Harness Directives |
|-------|-----------|-------------|-------------|-------------------|
| start-work | Read, Write, Edit, Bash | explorer, librarian, plan, reviewer, worker | .omo/boulder.json, .omo/start-work/ledger.jsonl | Stop/SubagentStop hook, multi_agent_v1.spawn_agent |
```

### 2. Survey the target platform capability catalog

**Mark "survey-target" as in_progress.**

Survey the target harness's available tools, agent model, and constraints:
- What is the file read/write tool set?
- Does the platform have an agent/subagent spawning mechanism? What are its parameters?
- What directory conventions does it use? (e.g., `.lazyworkbuddy/` vs `.omo/`)
- Does it support hooks, continuation, or mailbox signals?
- What is its task/plan tracking model? (e.g., `TaskCreate/TaskUpdate` vs `update_plan`)
- Does it have a skill loading mechanism? How are skills discovered and activated?
- Are there capability gaps? (e.g., no browser automation, no tmux, no LSP)

Produce a **Target Capability Catalog**:

```markdown
| Capability | Available? | Native Tool | Notes |
|-----------|-----------|-------------|-------|
| File Read/Write | Yes | Read, Write, Edit | In-place Edit supported |
| Agent Spawning | Yes | Agent tool | fork_context → isolation parameter |
| Task Tracking | Yes | TaskCreate/TaskUpdate | Status workflow: pending→in_progress→completed |
| Browser Automation | Partial | WebFetch only | No full browser; surface-level HTTP proxy needed for browser QA |
```

### 3. Build the semantic mapping table

**Mark "build-mapping" as in_progress.**

For every platform dependency in the Inventory, produce a mapping onto the Target Capability Catalog. Three outcomes for each item:

| Outcome | Meaning |
|---------|---------|
| **Direct map** | The target has a native equivalent. Map explicitly. |
| **Adapted map** | The target has a similar capability; behavior preserved but invocation surface changes. Describe the adaptation. |
| **Gap** | The target lacks the capability. Propose a workaround or declare the feature limited. |

Example mapping table:

```markdown
| Source Primitive | Source Context | Target Primitive | Adaptation |
|-----------------|---------------|-----------------|------------|
| `multi_agent_v1.spawn_agent({"agent_type":"explorer","fork_context":false})` | start-work Phase 3 task dispatch | WorkBuddy Agent tool with `"message":"TASK: act as an explorer..."` and `isolation: true` | Direct map: agent_type → described in message; fork_context:false → isolation:true |
| `.omo/boulder.json` | start-work Phase 2 state | `.lazyworkbuddy/runs/<run_id>/state.json` | Adapted map: directory prefix change; state schema preserved with `schema_version` bump |
| `Stop/SubagentStop` continuation hook | start-work continuation | WorkBuddy background task polling via TaskOutput | Adapted map: hook → poll-based; semantics preserved (re-check undone work on next turn) |
| `browser:control-in-app-browser` | ultrawork Manual-QA browser channel | WebFetch (HTTP-level) + screenshot fallback via Read on PNG | Gap: no full browser automation; downgrade to HTTP verification for browser-shaped criteria; mark as limited in adapter notes |
```

### 4. Write the adapter plan

**Mark "write-adapter" as in_progress.**

Write the host-adapter plan to `.lazyworkbuddy/adapters/<target-platform>-<YYYYMMDD>.md`. The plan document must be decision-complete: a downstream worker executing it has ZERO judgment calls about how to translate a source primitive.

Plan structure:

```markdown
# Host-Adapter Plan: <source> → <target-platform>

**Generated:** <ISO timestamp>
**Source skill set:** <path or reference>
**Target platform:** <name + version>
**Adapter version:** 1.0

## Executive Summary

<2-3 paragraphs: what is being ported, how many skills, what the target platform is, the key mapping categories>

## Target Capability Catalog

<the survey from Phase 2>

## Semantic Mapping Table

<the full mapping from Phase 3 — every platform dependency, sorted by skill>

## Skill-by-Skill Adaptation Notes

<one section per skill: what changes, what stays the same, any capability gaps>

## Gap Analysis

<every gap from Phase 3, with impact assessment and workaround>

## Verification Plan

How to verify the adapter is correct:
- For each mapped primitive, a test that the target equivalent produces the same behavior
- For each gap, a test that the workaround produces acceptable results

## Migration Sequence

Order-dependent steps: which skills to port first, which depend on earlier ports
```

### 5. Record in parity ledger

**Mark "record" as in_progress.**

Append an entry to `.lazyworkbuddy/parity-ledger.jsonl`:

```json
{
  "event": "adapter-plan-created",
  "timestamp": "<ISO 8601>",
  "adapter_plan": ".lazyworkbuddy/adapters/<target-platform>-<YYYYMMDD>.md",
  "source_platform": "<source>",
  "target_platform": "<target>",
  "skills_inventoried": <count>,
  "direct_maps": <count>,
  "adapted_maps": <count>,
  "gaps": <count>
}
```

## Expected Output Artifacts

1. `Inventory` (in-memory or inline in the adapter plan — the per-skill dependency table)
2. `Target Capability Catalog` (inline in the adapter plan)
3. `Semantic Mapping Table` (inline in the adapter plan)
4. `.lazyworkbuddy/adapters/<target-platform>-<YYYYMMDD>.md` — the full host-adapter plan
5. `.lazyworkbuddy/parity-ledger.jsonl` — appended migration entry

## Verification Gates

1. Every source skill in the set has an entry in the Inventory
2. Every platform dependency in the Inventory has a row in the Semantic Mapping Table
3. Every gap has an impact assessment and workaround proposal
4. The adapter plan is self-contained: a downstream worker can execute it with zero further interviews
5. No source skill file was modified

## Failure Behavior

- If the target platform spec is unavailable: attempt to infer capabilities from the target's documentation, README, or tool schemas. If inference fails, mark the entire capability as a gap and note "target spec unavailable — manual verification required"
- If a source skill references a tool with no known target equivalent: mark it as a gap; do NOT silently drop the capability
- If the source skill set contains circular dependencies: record the cycle in the Migration Sequence section with a note about which skill to port first to break the cycle
- If an existing adapter plan for the same target already exists: create a new version (bump the date stamp); append a `supersedes` field to the parity ledger pointing to the previous plan

## Handoff Format

```
Migration planner complete.
  Adapter plan: .lazyworkbuddy/adapters/<target-platform>-<YYYYMMDD>.md
  Source skills inventoried: <count>
  Direct maps: <count> | Adapted maps: <count> | Gaps: <count>
  Next step: review the adapter plan, then use /start-work to execute the port
```

## The 9-Step Migration Workflow (v0.10)

The migration lifecycle is a sequence of nine ordered steps, each producing concrete artifacts. A migration is "done" when Step 9's parity report says so. Skip no step.

### Step 1: Canonical Repo Inspection
Clone or read the source repository. For LazyCodex, use `reference/lazycodex/`. Identify every method: skills (SKILL.md files), agents (TOML/MD definitions), hooks (JSON/TOML configs), MCP servers (`.mcp.json`), and components. Produce a flat file index. **Never guess from memory** — every claim must trace to a file path and line.

### Step 2: Method Extraction
Extract exact method names and source paths. For each skill: name + trigger conditions from YAML frontmatter. For each agent: name + model + tool restriction list from TOML/YAML. For each hook: event type + script path from JSON/TOML config. For each MCP server: name + transport + exposed tools. The output is a **structured inventory** — one row per method, no ambiguity.

### Step 3: Host Capability Inventory
Survey the target host's extension model. Does it support Skills? Commands? Agents? Hooks? MCP? Rules? Dashboard? For each yes, capture: manifest format, plugin packaging story, agent model (YAML frontmatter fields, tool scoping mechanism), hook model (event types, script vs prompt hooks), MCP transport (stdio vs HTTP), and filesystem conventions (mutable state dirs vs immutable plugin dirs). This catalog is the constraint set for Step 4.

### Step 4: Semantic Mapping
Classify every source method against the host catalog:
- **matched** — exact semantic equivalent exists natively on target (map directly)
- **adapted** — behavior preserved, but implementation surface changes (design the adaptation)
- **skipped** — intentionally not ported; must state reason (out of scope, platform limitation, legal boundary, superseded)
- **added** — target-native enhancement that has no source equivalent (explicitly label as `added`; do not inflate parity counts)
Record for each: source path, target implementation, status, and behavioral equivalence proof.

### Step 5: Host-Native Adaptation
Design each `adapted` method using host-native primitives. Replace source-specific tools with target equivalents. Replace source-specific paths with target conventions. Preserve semantic behavior; change only the invocation surface. Example: `multi_agent_v1.spawn_agent({"agent_type":"explorer"})` → WorkBuddy `Agent` tool with `message:"TASK: act as an explorer..."` and `isolation:true` (same subagent semantics, different API).

### Step 6: Verification Design
For each adapted method, define verification gates: What does success look like? What test proves it? What host-native tool runs the check? What evidence artifact confirms it? Assemble these into a **verification matrix** — a table of `<workflow, command, expected result, evidence artifact>` rows. Every row must be executable by a downstream worker.

### Step 7: Implementation Sequence
Order the port by dependency: project memory before agents, agents before hooks, hooks before run state, run state before MCP, MCP before dogfood. Create a versioned plan (v0.0 → v0.N). Each version has: objective statement, list of artifacts produced, success criteria, and verification gates from Step 6. Lazyworkbuddy's own sequence serves as the reference: v0.0 discovery → v0.1 architecture → v0.2 project memory → v0.3 plugin scaffold → v0.4 skills → v0.5 agents → v0.6 hooks → v0.7 run state → v0.8 MCP → v0.9 hardening → v0.10 migration → v0.11 dogfood → v0.12 release.

### Step 8: Dogfood Run
Run the adapted system on its own source code. The validation threshold: when you can `init-deep` your own repo and `start-work` on a real migration task, the cycle is proven. Record everything: what worked, what broke, what needed manual intervention. Update the parity ledger with every new gap discovered during the dogfood run. The dogfood run is not optional — an untested adapter is a draft.

### Step 9: Final Parity Report
Produce the final comparison: total source methods, matched/adapted/skipped/added breakdown, percentage of behavior preserved. Document every deviation in a `known-gaps` file (one row per gap: method name, what's missing, impact, mitigation). Append the summary to the parity ledger. The report must be honest — never claim parity where gaps remain. A truthful 87%-adaptation report is more valuable than a dishonest 100% claim.

## WorkBuddy-Native Features

- **Agent tool:** When the source skill set is large (>5 skills), spawn explorer subagents via the WorkBuddy Agent tool to read each skill in parallel. Use `isolation: true` and a self-contained `message` that names DELIVERABLE/SCOPE/VERIFY.
- **TaskCreate/TaskUpdate:** Track each phase (inspect-source, survey-target, build-mapping, write-adapter, record) as a task step.
- **Read-only enforcement:** The migration-planner is architecturally read-only for product files. WorkBuddy's tool permission model enforces this: Write and Edit are only called against `.lazyworkbuddy/adapters/` paths.
- **Parity ledger integration:** The adapter plan creation is a first-class parity event in `.lazyworkbuddy/parity-ledger.jsonl`, linking the migration to the broader Lazyworkbuddy knowledge lifecycle.
- **Directory convention:** All adapter artifacts live under `.lazyworkbuddy/adapters/`, following the WorkBuddy-native state directory convention (not LazyCodex `.omo/`).

## Required Disciplines

Every migration-planner execution must uphold these 11 disciplines. No exceptions, no shortcuts.

| # | Discipline | Requirement |
|---|-----------|-------------|
| 1 | **Local source repo inspection** | Read source files from disk. Never reason from memory or documentation summaries. Every assertion must cite a file path and line. |
| 2 | **Exact method names + paths** | Extract methods by name and full path. "The start-work skill" is not enough — you need `skills/start-work/SKILL.md:42` for the spawn_agent call. |
| 3 | **Host feature inventory** | Survey the target platform's actual capabilities before mapping. Ground-truth check: what tools does it expose? What event model? What packaging format? |
| 4 | **Behavior-vs-implementation distinction** | Preserve *what* a method does; it's fine to change *how* it does it. The adapter's job is semantic fidelity, not syntactic fidelity. |
| 5 | **Legal / license / IP boundary** | Check source license before copying. Do not port code that is GPL into MIT projects without legal review. If uncertain, mark as `skipped` with reason "license boundary". |
| 6 | **Semantic mapping** | Every source method gets a `matched`/`adapted`/`skipped`/`added` classification. No method is silently dropped. Skipped methods carry an explicit reason. |
| 7 | **Creative host-native adaptation** | When no direct equivalent exists, design a creative adaptation using the host's primitives. The `multi_agent_v1.spawn_agent` → WorkBuddy `Agent` tool mapping is the canonical example: different API, same subagent semantics. |
| 8 | **Versioned implementation plan** | Port in dependency order. Each version has an objective, artifact list, success criteria, and verification gates. Never skip versions. |
| 9 | **Verification gates** | Every adapted method has a concrete, runnable verification gate. A downstream worker must be able to execute `doctor` and get PASS/FAIL for every row in the verification matrix. |
| 10 | **Dogfood run** | The adapted system must run on its own source code before the migration is declared complete. If `init-deep` and `start-work` don't work on the migration itself, the adapter is a draft. |
| 11 | **Final parity report** | Honest accounting. Count every method. Report matched/adapted/skipped/added truthfully. Document every gap in a `known-gaps` file. Append to the parity ledger. |

These disciplines are not aspirational. A migration-planner run that violates any one of them has produced a draft, not a plan. Reject it and re-run.

---
_This is a Lazyworkbuddy innovation — there is no direct LazyCodex equivalent. It formalizes the adapter pattern discovered during the v0.4 port of LazyCodex skills to WorkBuddy. The semantic mapping approach (direct map / adapted map / gap) is the same triage we applied to translate `multi_agent_v1` → WorkBuddy Agent tool, `.omo/` → `.lazyworkbuddy/`, `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`, and every Codex-specific tool invocation._
