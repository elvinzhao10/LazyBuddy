---
description: "Generate hierarchical project memory for the current WorkBuddy workspace. Inspects repo structure, identifies language/runtime/test/build commands, scores directories by complexity, generates workbuddy.md at root and subdirectory variants, and produces a .lazybuddy/context/ knowledge base."
---

# /lazy-init-deep

Generate hierarchical project memory. Scores directories by complexity, produces `workbuddy.md` at root and subdirectory variants, and writes a `.lazybuddy/context/` knowledge base for future agents.

## Usage

```
/lazy-init-deep [--create-new] [--max-depth=N]
```

## Inputs

- Current workspace directory tree
- Project manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.)
- Existing `workbuddy.md` if present (update mode)
- CI/CD configuration, test directories, existing docs

## Outputs

- `workbuddy.md` at root (50-150 lines, quality-gate passing)
- Subdirectory `workbuddy.md` variants where complexity score warrants
- `.lazybuddy/context/index.md` — structured project overview
- `.lazybuddy/context/commands.json` — discovered dev/test/build/lint commands
- `.lazybuddy/context/project-map.json` — directory-to-purpose mapping
- Plugin load-check result from `bash "${CODEBUDDY_PLUGIN_ROOT}/scripts/lazybuddy-load-check.sh"`

## Success Criteria

1. Root `workbuddy.md` exists and is 50-150 lines
2. No generic filler content
3. Hierarchy is correct (child does not repeat parent)
4. `.lazybuddy/context/` files exist and are parseable
5. Plugin load check passes before discovery and is included in the completion report

## Constitution

Link to command constitution: `../../docs/lazybuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/lazy-init-deep/SKILL.md` for the full workflow logic, phase-by-phase procedure, scoring matrix, and verification gates.
