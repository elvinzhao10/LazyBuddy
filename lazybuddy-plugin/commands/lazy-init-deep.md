---
description: "Generate hierarchical project memory for the current WorkBuddy workspace. Inspects repo structure, identifies language/runtime/test/build commands, scores directories by complexity, generates workbuddy.md at root and subdirectory variants, and produces a .lazybuddy/context/ knowledge base."
---

# /lazybuddy:lazy-init-deep

Generate hierarchical project memory. Scores directories by complexity, produces `workbuddy.md` at root and subdirectory variants, and writes a `.lazybuddy/context/` knowledge base for future agents.

## Usage

```
/lazybuddy:lazy-init-deep [--create-new] [--max-depth=N]
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
- Plugin load-check result. Resolve it safely before discovery:
  ```bash
  PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:-}"
  if [ -z "$PLUGIN_ROOT" ] && [ -f "$PWD/lazybuddy-plugin/scripts/lazybuddy-load-check.sh" ]; then
    PLUGIN_ROOT="$PWD/lazybuddy-plugin"
  elif [ -z "$PLUGIN_ROOT" ] && [ -f "$PWD/scripts/lazybuddy-load-check.sh" ]; then
    PLUGIN_ROOT="$PWD"
  fi
  [ -n "$PLUGIN_ROOT" ] || { echo "LazyBuddy plugin root is unavailable; reopen the copied repository or install the plugin." >&2; exit 1; }
  bash "$PLUGIN_ROOT/scripts/lazybuddy-load-check.sh"
  ```

## Success Criteria

1. Root `workbuddy.md` exists and is 50-150 lines
2. No generic filler content
3. Hierarchy is correct (child does not repeat parent)
4. `.lazybuddy/context/` files exist and are parseable
5. Plugin load check passes before discovery and is included in the completion report. With no `CODEBUDDY_PLUGIN_ROOT`, run this command from the copied repository root or the plugin root; otherwise it fails clearly.

## Constitution

Link to command constitution: `../../docs/lazybuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/lazy-init-deep/SKILL.md` for the full workflow logic, phase-by-phase procedure, scoring matrix, and verification gates.
