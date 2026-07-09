# Lazyworkbuddy Command Constitution

> The design doc for all commands: naming, structure, composition, and invocation.

## Command Philosophy

Lazyworkbuddy commands follow LazyCodex's command philosophy:

1. **Commands are entry points, Skills are engines.** A command (`commands/*.md`) describes what to invoke and when. The corresponding Skill (`skills/<name>/SKILL.md`) contains the workflow logic. Commands are thin wrappers; Skills are thick.

2. **Three pillars.** The core workflow is: `/ulw-plan` (decide) → `/start-work` (execute) → `/ulw-loop` (verify). These three compose into any workflow size.

3. **Commands compose.** `/start-work` can invoke `/ulw-plan` (no-plan bootstrap). `/start-work` can invoke `/review-work` (completion gate). `/ulw-loop` delegates to `/start-work` for implementation waves.

**LazyCodex source:** [README.md](../reference/lazycodex/README.md) Commands section — the three pillar commands with their invocation syntax.

## Command Structure

Every command file must have:

```markdown
# /command-name

Brief one-line description of what this command does.

## Usage

```
/command-name [arguments]
```

## When to Use

Bullet list of triggering conditions.

## What It Does

Step-by-step workflow description. Reference the Skill it loads.

## Stop Conditions

When this command terminates (plan approved, execution complete, review passed).

## Related Commands

Cross-references to composing commands.
```

## Six Canonical Commands

### 1. `/init-deep`

**Purpose:** Generate hierarchical project memory. Creates `workbuddy.md` at root and subdirectory variants where complexity warrants.

**Invocation:** `/init-deep [--create-new] [--max-depth=N]`

**LazyCodex equivalent:** `$init-deep` — traced to [skills/init-deep/SKILL.md](../reference/lazycodex/plugins/omo/skills/init-deep/SKILL.md).

**Composition:** Standalone. Run first in any new workspace.

**Stop condition:** Final report with file count, analyzed directories, hierarchy tree.

### 2. `/ulw-plan`

**Purpose:** Create a decision-complete work plan. Prometheus planner mode — explores, researches, writes a plan to `.lazyworkbuddy/plans/`. Never writes product code.

**Invocation:** `/ulw-plan "what to build"`

**LazyCodex equivalent:** `$ulw-plan` — traced to [skills/ulw-plan/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-plan/SKILL.md).

**Composition:** Produces plans consumed by `/start-work`. Can be called from `/start-work` (no-plan bootstrap).

**Stop condition:** Plan file written; approval gate presented; awaits user "approved" or `/start-work`.

### 3. `/start-work`

**Purpose:** Orchestrate plan execution. Reads a plan, creates bootstrap state, decomposes into sub-tasks, spawns worker subagents, verifies evidence, marks progress. Root agent is orchestrator only — never implements.

**Invocation:** `/start-work [plan-name] [--worktree <path>]`

**LazyCodex equivalent:** `$start-work` — traced to [skills/start-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/start-work/SKILL.md).

**Composition:** Consumes `/ulw-plan` output. Invokes `/review-work` on completion. Driven by Stop/SubagentStop hooks for continuation.

**Stop condition:** All checkboxes marked done, final verification passed, global review gate passed, prints `ORCHESTRATION COMPLETE`.

### 4. `/ulw-loop`

**Purpose:** Verified completion loop for open-ended tasks. Creates goals with binding success criteria, decomposes into evidence-bound steps, runs until all criteria have real-surface proof.

**Invocation:** `/ulw-loop "task" [--completion-promise=TEXT] [--strategy=reset|continue]`

**LazyCodex equivalent:** `$ulw-loop` — traced to [skills/ulw-loop/SKILL.md](../reference/lazycodex/plugins/omo/skills/ulw-loop/SKILL.md).

**Composition:** Can delegate implementation waves to `/start-work`. Manages its own goal state in `.lazyworkbuddy/ulw-loop/`.

**Stop condition:** All success criteria have verified evidence; 500-iteration cap (ultrawork) / 100-iteration cap (normal) reached.

### 5. `/review-work`

**Purpose:** 5-agent parallel post-implementation review. Spawns Goal Verifier, QA Executor, Code Reviewer, Security Auditor, and Context Miner in parallel. All 5 must PASS.

**Invocation:** `/review-work`

**LazyCodex equivalent:** `review-work` skill — traced to [skills/review-work/SKILL.md](../reference/lazycodex/plugins/omo/skills/review-work/SKILL.md).

**Composition:** Invoked by `/start-work` on completion. Also invocable standalone after any implementation.

**Stop condition:** All 5 lanes have terminal state (PASS/FAIL/INCONCLUSIVE); aggregate verdict printed.

### 6. `/ultrawork`

**Purpose:** Binding ultrawork mode directive. Injects tier triage, success criteria requirements, Manual-QA channels, and the full ultrawork bootstrap. Caps at 500 iterations.

**Invocation:** `/ultrawork`

**LazyCodex equivalent:** `ultrawork` skill — traced to [skills/ultrawork/SKILL.md](../reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md).

**Composition:** Modifies all other workflows when active. Detected by `UserPromptSubmit` hook.

**Stop condition:** Task complete with evidence, or iteration cap reached.

## Command Naming Convention

- **Prefix:** `/` (WorkBuddy slash command convention)
- **Hyphenated:** `ulw-plan`, `start-work`, `init-deep` (matching LazyCodex `$command-name` convention)
- **Consistent:** Lazyworkbuddy commands keep the LazyCodex name where it communicates parity; add WorkBuddy-native aliases where useful (e.g., both `/review-work` and `/review`)

## Command Composition Flow

```
/init-deep
    │
    ▼
/ulw-plan ──────────► .lazyworkbuddy/plans/<slug>.md
    │
    ▼
/start-work ────────► .lazyworkbuddy/runs/<run_id>/state.json
    │                       │
    │  (Stop hook)          │ (unchecked work)
    │  ◄────────────────────┘
    │
    ▼
/review-work ───────► 5-agent review report
    │
    ▼
ORCHESTRATION COMPLETE

/ulw-loop (parallel track)
    │
    ├──► /start-work (implementation waves)
    │
    └──► .lazyworkbuddy/ulw-loop/ goals + evidence
```

---

_Command design traces to LazyCodex README Commands section and the SKILL.md files for all 6 core skills in `reference/lazycodex/plugins/omo/skills/`._
