# Lazyworkbuddy Plugin

> LazyCodex agent harness reborn inside WorkBuddy.

## Quick Start

Lazyworkbuddy is a WorkBuddy plugin that brings the LazyCodex/OmO agent harness to your workspace.

1. **Install** — `mkdir -p ~/.workbuddy/plugins && ln -s "$(pwd)/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy`
2. **Verify** — `./lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh`
3. **Use** — run `/init-deep`, then `/ulw-plan`, then `/start-work`

**Status:** v0.12.0 release-hardening package with Todo 6 gates recorded. See the canonical current status in See [README](../README.md) for current status.. (Plugin must be enabled in `.workbuddy/settings.json` to activate.)

## What this plugin provides

Lazyworkbuddy brings the LazyCodex/OmO agent harness to WorkBuddy:

- **Hierarchical project memory** (`/init-deep`) — generates `workbuddy.md` with directory scoring
- **Prometheus planning** (`/ulw-plan`) — decision-complete work plans; never writes product code
- **Orchestrated execution** (`/start-work`) — delegates to subagents; never implements directly
- **Verified completion loop** (`/ulw-loop`) — evidence-backed done claims with adversarial verification
- **5-agent parallel review** (`/review-work`) — goal/QA/code/security/context; all 5 must pass
- **Ultrawork mode** (`/ultrawork`) — binding directive with tier triage and Manual-QA discipline

## Component Map

| Directory | Purpose | Status |
|-----------|---------|--------|
| `skills/` | 14 WorkBuddy Skills (workflow knowledge) | ✅ Implemented (v0.4) |
| `commands/` | Slash command entry points | ✅ Implemented (v0.4) |
| `agents/` | 13 WorkBuddy subagents | ✅ Implemented (v0.5) |
| `hooks/hooks.json` | 12 lifecycle hooks (3 enforcement + 9 advisory) | ✅ Implemented (v0.6) |
| `mcp/` | 8 MCP servers (5 run-management + 3 context-tooling substitutes) | Runtime-smoked in v0.12; context tooling remains heuristic |
| `scripts/` | State ledger (10) + loop (5) + hooks (12) + validation scripts | ✅ Implemented (v0.6–v0.7) |
| `schemas/` | State ledger schemas | ✅ Documented in docs/lazyworkbuddy-state-schema.md (v0.7) |

## Install

Use the symlink install for local development. Marketplace publication, tags, and external install locations are intentionally outside the v0.12 local release-hardening workflow.

### Development install

```bash
# Symlink the plugin into WorkBuddy's plugin directory
ln -s "$(pwd)/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy

# Verify the plugin loads
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
```

### Marketplace install

```bash
# From WorkBuddy: /plugins -> Add Marketplace -> enter repository URL
# Repository: https://github.com/lazyworkbuddy
```

## Uninstall

```bash
rm -rf ~/.workbuddy/plugins/lazyworkbuddy
```

## Verify

```bash
# Doctor: validates plugin structure
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh

# Smoke test: checks SKILL.md frontmatter and command stubs
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-smoke-test.sh

# Docs check: verifies no broken internal links
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh

# Aggregate verification: doctor, smoke, docs, parity, security, MCP, and hooks
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh
```

## Development Status

| Version | Phase | Status |
|---------|-------|--------|
| v0.1 | Architecture | ✅ Complete |
| v0.2 | Project memory | ✅ Complete |
| v0.3 | Plugin scaffold | ✅ Complete |
| v0.4 | Skills & commands | ✅ Complete |
| v0.5 | Subagents | ✅ Complete |
| v0.6 | Hooks & safety | ✅ Complete |
| v0.7 | Run ledger & loop | ✅ Complete |
| v0.8 | MCP & dashboard | ✅ Complete |
| v0.9 | Hardening | ✅ Complete |
| v0.10 | Migration planner | ✅ Complete |
| v0.11 | Dogfood | ✅ Superseded by v0.12 replay evidence |
| v0.12 | Release hardening | ✅ Todo 6 gates recorded |

## License

MIT — see [LICENSE](LICENSE) (or repository LICENSE file).

---

_This is the installable WorkBuddy plugin for Lazyworkbuddy. The project-local `.workbuddy/` layer provides repository-specific memory and rules. See [`workbuddy.md`](../workbuddy.md) for project memory._
