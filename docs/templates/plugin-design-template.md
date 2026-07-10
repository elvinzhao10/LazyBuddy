# Plugin Design Template

Architectural blueprint for plugin packaging, directory layout, manifest, and lifecycle on a target platform.

## Manifest (`[MANIFEST_PATH]`)

| Field | Type | Req | Description |
|-------|------|-----|------------|
| `name` | string | YES | Plugin identifier |
| `version` | string | YES | Semantic version |
| `description` | string | YES | One-line purpose |
| `skills` | array | YES | Skill directories to load |
| `agents` | array | YES | Agent definition files |
| `hooks` | array | NO | Hook configurations |
| `mcp_servers` | array | NO | MCP server definitions |
| `scripts` | object | NO | Paths to doctor/install/uninstall |
| `min_host_version` | string | NO | Minimum host version |

Example: LazyBuddy `manifest.json`: `"name":"lazybuddy-plugin"`, `"version":"0.10.0"`, skills: init-deep, start-work, auto-work, migration-planner, etc.

## Layout & Components

Layout: `[PLUGIN_ROOT]/{manifest.json, skills/, agents/, hooks/, mcp/, scripts/, docs/, state/}` (state is runtime, not shipped).

| Component | Format | Count | Details |
|-----------|--------|-------|---------|
| Skills | SKILL.md (YAML+md) | [N] | Triggered by description match or tool call |
| Commands | `/cmd-name` wrapper | [N] | Thin wrapper exposing a skill to users |
| Agents | MD/TOML/YAML/JSON | [N] | Spawned via Agent tool; per-agent tool restrictions |
| Hooks | JSON config + script | [N] | Event-driven; script-hook or prompt-hook model |
| MCP | .mcp.json | [N] | stdio or HTTP transport |
| Scripts | bash/Python/Node | [N] | Doctor, install, uninstall, migration |

Example: LazyBuddy — 20 skills, 15 agents, 8 hooks, 47-check doctor script.

## Install / Uninstall

- **Install:** [STEP_1] → [STEP_2] → verify: `[DOCTOR]` → expect `[RESULT]`
- **Uninstall:** [STEP_1] → verify: [CHECK]

Example: Clone `lazybuddy-plugin/` → auto-discovery via manifest.json → `bash scripts/lazybuddy-plugin-doctor.sh` → `47/47 PASS`. Uninstall: remove plugin dir + optional `.lazybuddy/` state dirs.

## Status

| Component | Count | Ported | Pending | Skipped |
|-----------|-------|--------|---------|---------|
| Skills | [N] | [N] | [N] | [N] |
| Agents | [N] | [N] | [N] | [N] |
| Hooks | [N] | [N] | [N] | [N] |
| MCP | [N] | [N] | [N] | [N] |
| Scripts | [N] | [N] | [N] | [N] |

**Last updated:** [YYYY-MM-DD] | **Version:** [X.Y.Z]
