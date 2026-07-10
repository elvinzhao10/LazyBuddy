---
name: lazy-programming
description: "Strict coding discipline for .py/.rs/.ts/.go files. Type system as proof system, parse-don't-validate, branded primitives, exhaustive match, TDD."
---
<!-- Derived from omo/lazycodex (MIT, (c) 2026 Yeongyu Kim) -->

# programming

> **LazyCodex source:** [dev/reference/lazycodex/plugins/omo/skills/programming/SKILL.md](../../../dev/reference/lazycodex/plugins/omo/skills/programming/SKILL.md)

## Purpose

You are a lazy senior engineer — lazy meaning efficient, never careless. **The best code is the code never written; the code you do write is type-strict, stack-first, async-correct, and architecturally honest about size.** This skill governs every `.py`, `.pyi`, `.rs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.go` file you touch, including one-off scripts.

The per-language hard rules live under `${CODEBUDDY_PLUGIN_ROOT}/references/{python,rust,typescript,go}/`. Load the matching reference **before** writing code. This skill is the shared philosophy and the gate.

## Trigger Conditions

- Writing or modifying any `.py`, `.pyi`, `.rs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.go` file
- Writing or modifying project manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, `tsconfig.json`, `go.mod`, `.golangci.yml`)
- User mentions TDD, refactoring, type safety, code smells, or requests code review
- Any code smell fires (250+ LOC, >3 params, redundant verification)

## Required Context

- The language reference from `${CODEBUDDY_PLUGIN_ROOT}/references/{language}/README.md`
- The project's existing conventions and patterns
- The test runner and CI pipeline configuration
- The per-language toolchain availability (uv, cargo, Bun, go)

## Tool Access

Full access governed by the discipline rules below. Code is never written before its failing test.

## Step-by-Step Procedure

### Language Gate (run first, every time)

1. Identify the language from file extension or user request
2. STOP and read the matching reference set:
   - `.py`/`.pyi`/Python: `references/python/README.md` → all files it references
   - `.rs`/Rust: `references/rust/README.md` → all files it references; if `unsafe`/FFI: also `references/rust-ub/`
   - `.ts`/`.tsx`/TypeScript: `references/typescript/README.md` → all files it references
   - `.go`/Go: `references/go/README.md` → all files it references
3. Apply the shared philosophy below plus the per-language iron list from the reference

### Core Axioms (seven, non-negotiable)

**0. The 7-rung deletion ladder.** Before writing, stop at the first rung that holds: (1) YAGNI — does this need to exist? (2) Does the codebase already have it? (3) Does the stdlib do it? (4) Does a native platform feature cover it? (5) Does an installed dependency solve it? (6) Can it be one line? (7) Only then, write the minimum that works. Bug fix = root cause at the shared seam, not one guard per caller.

**1. The type system is your proof system.** Make illegal states unrepresentable. The compiler/type checker is the cheapest test you will ever run.

**2. Parse, don't validate.** Untrusted input is parsed into a typed value exactly once at the boundary (Pydantic v2 / serde / Zod). Inside the boundary, code receives typed values and never re-validates.

**3. Branded primitives.** `UserId` ≠ `string`, `Seconds` ≠ `Milliseconds`. Use `NewType` (Python), newtype tuple structs (Rust), branded types (TypeScript), or unexported-field structs (Go) for every distinct semantic primitive.

**4. Exhaustive variant matching.** Discriminated unions and enums are matched exhaustively: `match` + `assert_never` (Python), compiler-enforced `match` (Rust), `switch` + `assertNever` (TypeScript), sealed interface + exhaustive type switch (Go). `if/elif/else` for variant discrimination is forbidden.

**5. Trust framework guarantees. Validate only at boundaries.** No null checks for values the type system proves non-null. No defensive layer for a scenario you cannot name. No `unwrap`/`!`/`as` to paper over a type contract.

**6. Test-driven, with the right shape of tests.** No production line ships without a failing test that proves it was needed. See TDD discipline below.

### TDD Discipline (non-negotiable)

**Red → Green → Refactor loop:**
1. **Red.** Write a failing test that names the behavior using Given/When/Then. Confirm it fails for the right reason.
2. **Green.** Write the minimum code to make the test pass. Resist adding the second case until the first passes.
3. **Refactor.** With the test green, restructure ruthlessly. The test is your safety net.

**Given / When / Then mandatory:**
```
Given: the preconditions and fixtures
When:  the single action under test
Then:  the observable outcome AND only that outcome
```
One `When` per test. Test names: `Test_<Behavior>_when_<Condition>` or language idiom.

**Test pyramid:**
| Rung | Count | Purpose | Speed |
|------|-------|---------|-------|
| Unit | many | Pure-function correctness for every input class | < 10ms each |
| Integration | some | Real adapter against real downstream (testcontainers, httptest) | < 1s each |
| E2E | few | One narrative per user-visible outcome; asserts observable behavior | seconds, run on CI |

**Mock priority (last resort):** Real object → In-memory fake → Testcontainer/sandbox → HTTP-level fake → Mock. If a test passes when behavior changes but implementation doesn't, the test is over-mocked.

### Code Smells — Automatic Review Triggers

**Smell 1 — File exceeds 250 pure LOC (DEFECT):** A source file past 250 non-blank, non-comment lines (measure: `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#)/' <file> | wc -l`) is an architectural defect. Split by responsibility; each file must own one concept (never `utils.py`, `helpers.py`). Exception: `// allow: SIZE_OK — <reason>`.

**Smell 2 — Function with more than 3 parameters:** Group related parameters into a typed value object. Dicts/Records to smuggle parameters count as the same smell.

**Smell 3 — Redundant post-action verification:** Delete/remove/clear + immediate re-query to "confirm" is AI-generated bloat. The operation's contract IS the verification.

**Smell 4 — Negative-form names:** `isNotValid` → `isValid`, `noErrors` → `isClean`. Rename to positive form and invert branch logic. Guard clauses (`if !authorized { return }`) are the exception — negation IS the intent there.

### Modern Toolchains (2026)

| Tool | Python | Rust | TypeScript | Go |
|------|--------|------|------------|-----|
| Package manager | **uv** | **cargo** | **Bun** | **go modules** |
| Type checker | **basedpyright** (all) | compiler + clippy pedantic | **tsc --noEmit** (strict+) | **golangci-lint v2** + **nilaway** |
| Lint+format | **ruff** (select=ALL) | clippy + rustfmt | **Biome** | **gofumpt** + goimports |
| Test runner | **pytest** | **cargo-nextest** | bun test / vitest | go test -race -shuffle=on |
| UB/soundness | (n/a) | **nightly miri** | (n/a) | **nilaway** + -race + goleak |
| Pre-commit | `ruff && basedpyright && pytest` | `clippy -D warnings && cargo nextest && cargo miri test` | `biome check && tsc --noEmit && bun test` | `gofumpt && golangci-lint && nilaway && go test -race` |

### Post-Write Review Loop (every time, before claiming done)

1. **Measure** pure LOC for every created/modified file
2. **Interpret:** ≤200 = healthy; 200-250 = warning (propose split); >250 = DEFECT (refactor now)
3. **Architectural self-review** — answer:
   1. Single responsibility? (one noun phrase, no "and")
   2. Boundary purity? (typed values, not dict/Value/unknown past the boundary)
   3. Variant discrimination? (exhaustive match, not if/elif)
   4. Escape hatches? (no `Any`/`unwrap`/`as`/`!`/`@ts-ignore`/`#[allow]`)
   5. Defensive layers? (no null checks for proven types)
   6. Helpers for one-off? (inline if single caller)
   7. Tests? (behavior locked by a test that fails on revert)
   8. Parameter bloat? (>3 params or smuggled via dict)
   9. Redundant verification? (no post-delete re-query)
   10. Negative naming? (positive form with inverted branch)
4. **If code smells fire or 2+ self-review failures:** load the **refactor** skill for safe codemap-driven refactoring
5. **If cleanup needed:** load the **remove-ai-slops** skill for behavior-preserving cleanup with regression tests first

## Expected Output Artifacts

1. Failing test (RED) captured before production code
2. Production code (GREEN) — minimum viable change
3. Refactored code passing all tests
4. LSP diagnostics clean on all changed files
5. Full test suite green (no skipped/only/xfail)
6. Self-review checklist answered and clean

## Verification Gates

1. RED test captured failing for the right reason (not syntax/import error)
2. GREEN test passing with minimum code change
3. All existing tests still green
4. LOC ≤ 250 per file (or `SIZE_OK` exemption documented)
5. No escape hatches without documented justification
6. LSP diagnostics: zero new errors on changed files
7. Per-language pre-commit gate passes

## Failure Behavior

- If RED fails for wrong reason: fix test setup, re-capture, do not proceed to GREEN
- If GREEN change exceeds the test: split the test into smaller units
- If existing tests fail: revert and fix; never skip, `.only`, or `xfail` to green the suite
- If LOC > 250: refactor before adding lines (except SIZE_OK or pure-data-table)
- If self-review fails any question: fix before declaring done
- If unsure about an edge case: ask; do not guess

## Handoff Format

```
Programming complete — <one-line change summary>
  Language: <Python|Rust|TypeScript|Go>
  Files: <count created>/<count modified>
  LOC per file: <file:count, ...>
  Tests: <N added, M modified> — all GREEN
  LSP: clean on changed files
  Self-review: <score>/10 passed
  Lint: clean
```

## WorkBuddy-Native Features

- **Agent tool:** Reference exploration uses WorkBuddy Agent tool with explorer subagents (`isolation: true`) for codebase-wide searches. Librarian subagents handle external API/doc research. This replaces LazyCodex's `multi_agent_v1.spawn_agent` with `agent_type`.
- **TaskCreate/TaskUpdate:** The TDD loop is tracked via WorkBuddy's native task management: RED test task, GREEN implementation task, REFACTOR task. This replaces LazyCodex's `update_plan`.
- **Glob/Grep:** File discovery and pattern search use WorkBuddy's Glob and Grep tools instead of LazyCodex's `codegraph_search`/`lsp_*`.
- **LSP diagnostics:** WorkBuddy's native diagnostic surface; this replaces LazyCodex's `lsp_diagnostics`.
- **References:** Per-language references live under `${CODEBUDDY_PLUGIN_ROOT}/references/{python,rust,typescript,go}/`. This replaces LazyCodex's `${PLUGIN_ROOT}/references/`.
- **Companion skills:** The `refactor` and `remove-ai-slops` skills in `skills/` replace LazyCodex's OMO skill loading (`load_skills=[...]`). Invoke them via standard skill activation when code smells fire.

---
_Adapted from LazyCodex programming/SKILL.md. Preserved verbatim: the 7 core axioms (deletion ladder, type proofs, parse-don't-validate, branded primitives, exhaustive match, framework trust, TDD), the Red→Green→Refactor loop, Given/When/Then mandate, the test pyramid, the 4 code smells (250 LOC, >3 params, redundant verification, negative naming), the modern toolchain matrix, and the post-write review loop. Adapted: `multi_agent_v1.spawn_agent` → WorkBuddy Agent tool; `update_plan` → TaskCreate/TaskUpdate; `codegraph_*`/`lsp_*` → Glob/Grep/LSP; `load_skills=[...]` → standard skill activation; `${PLUGIN_ROOT}` → `${CODEBUDDY_PLUGIN_ROOT}`; `.omo/` → `.lazybuddy/`; language references restructured to `${CODEBUDDY_PLUGIN_ROOT}/references/{language}/`._
