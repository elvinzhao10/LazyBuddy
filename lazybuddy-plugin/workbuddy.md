# workbuddy.md — lazybuddy-plugin (package internals)

> Package-internal navigation for agents editing the LazyBuddy package itself.
> For user-facing install/usage see `README.md` in this dir; for repo-wide context see root `workbuddy.md`.

## OVERVIEW
This directory is the self-contained installable CodeBuddy/WorkBuddy package. v0.16.0-alpha.1. Everything here must work when copied without root docs. Editing here affects 14 skills, 14 commands, 13 agents, 12 hooks, 6 MCP servers.

## WHERE TO LOOK (package editing)
| Change | Location | Notes |
|---|---|---|
| Workflow playbook logic | `skills/lazy-<name>/SKILL.md` | frontmatter (`name`, `description`, `trigger`) + procedure body |
| Slash command stub | `commands/<name>.md` or `commands/<name>/` | routes to a skill |
| Agent role definition | `agents/<name>.md` | role scope, tools, must-not-do constraints |
| Hook lifecycle policy | `hooks/hooks.json` | 12 event declarations; host-loaded only |
| MCP server code | `mcp/<server>/` | `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, `docs` |
| MCP registration | `.mcp.json` | 6 server entries |
| Verification scripts | `scripts/lazybuddy-{load-check,doctor,verify,smoke-test,docs-check}.sh` | |
| Tooling/capability broker | `scripts/lazybuddy-tooling.sh` | rg/sg/LSP/CodeGraph/remote policy |
| Capability contract fixtures | `contracts/fixtures/v017/` | v0.17.0 readiness (separate from package version) |
| Onboarding template | `templates/AGENTS.md` | template only; root `AGENTS.md` is the live one |
| Package manifests | `.codebuddy-plugin/plugin.json`, `.workbuddy-plugin/plugin.json` | versions must agree + match root `.codebuddy-plugin/marketplace.json` |

## CONVENTIONS (package-internal)
- Version must agree across: this `.codebuddy-plugin/plugin.json`, this `.workbuddy-plugin/plugin.json`, AND root `.codebuddy-plugin/marketplace.json`. Bump all three together.
- `.workbuddy-plugin/plugin.json` is compatibility metadata, NOT an executable WorkBuddy installer — do not add installer claims to it.
- New skill → also add matching command stub in `commands/` and update load-check expectations if inventory changes.
- New MCP server → add to `.mcp.json`, create `mcp/<name>/`, update doctor/load-check counts, and update docs inventory (root README, handoff).
- Tests are shell scripts in `tests/`. Run `bash scripts/lazybuddy-verify.sh` before claiming a change is safe.
- `context-graph` is grep heuristic. Do not implement or document it as semantic CodeGraph.

## ANTI-PATTERNS
- Adding a runtime dependency from this package to root `README.md`/`AGENTS.md`/`docs/`.
- Stating inventory counts without comparing to manifests + load-check output.
- Editing host-managed state (`.workbuddy/`, plugin locations) from package scripts.

## COMMANDS (from this directory)
```bash
bash scripts/lazybuddy-load-check.sh     # package readiness
bash scripts/lazybuddy-plugin-doctor.sh  # 50-check health
bash scripts/lazybuddy-verify.sh         # aggregate verification
bash scripts/lazybuddy-docs-check.sh     # internal link integrity
bash tests/v017-documentation-regression.sh
```
