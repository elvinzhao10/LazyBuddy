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
- InitDeep readiness evidence. Run the load check first, then verify its reported skills, commands, agents, hooks, and MCP declarations. This is package readiness only and does not prove a live host session or MCP connection. Do not enable optional capabilities, select providers, initialize optional architecture tooling, or export MCP configuration without a separate explicit user request. Record these exact fields in the completion report:
  ```text
  readiness_result: {load-check result}
  readiness_host: {package readiness boundary}
  capability_statuses: {observed read-only status summary}
  optional_policy: {unchanged unless separately explicitly requested}
  receipt_state: {observed receipt/ownership state or not inspected}
  evidence_paths: {load-check output and inspected package paths}
  ```
- Consumer compatibility pointer. After generating or updating `workbuddy.md`, explicitly run:
  ```bash
  CWD="$PWD" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" \
    bash "$PLUGIN_ROOT/scripts/ensure-consumer-agents.sh"
  ```
  Record whether the helper reports `AGENTS_STATUS=created` or `AGENTS_STATUS=preserved`. It never merges or overwrites an existing `AGENTS.md`.

## Success Criteria

1. Root `workbuddy.md` exists and is 50-150 lines
2. No generic filler content
3. Hierarchy is correct (child does not repeat parent)
4. `.lazybuddy/context/` files exist and are parseable
5. Plugin load check passes before discovery and is included in the completion report. With no `CODEBUDDY_PLUGIN_ROOT`, run this command from the copied repository root or the plugin root; otherwise it fails clearly.
6. The post-`workbuddy.md` consumer helper reports `AGENTS_STATUS=created` or `AGENTS_STATUS=preserved`.

## Constitution

This command is governed by its package-local skill contract below.

Do not claim completion without verification.

## Skill

See `../skills/lazy-init-deep/SKILL.md` for the full workflow logic, phase-by-phase procedure, scoring matrix, and verification gates.
