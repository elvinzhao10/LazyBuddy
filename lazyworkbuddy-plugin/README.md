# Lazyworkbuddy Plugin

> LazyCodex agent harness reborn inside WorkBuddy.

**Status:** 🔧 Scaffold (v0.3.0) — structural skeleton only. Skills, agents, and hooks are implemented in v0.4+.

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
| `skills/` | 25+ WorkBuddy Skills (workflow knowledge) | 🔧 8 placeholders (v0.4+) |
| `commands/` | Slash command entry points | 🔧 8 placeholders (v0.4+) |
| `agents/` | 9+ WorkBuddy subagents | 🔧 Empty (v0.5+) |
| `hooks/hooks.json` | 12 lifecycle hooks | 🔧 Structure only (v0.6+) |
| `mcp/` | MCP server implementations | 🔧 Empty (v0.8+) |
| `scripts/` | Validation and verification scripts | ✅ 4 scripts (doctor, smoke-test, docs-check, parity-check) |
| `schemas/` | State ledger schemas | 🔧 Empty (v0.7+) |

## Install

*Plugin installation is available once the core components are implemented (v0.7 MVP). For now, use the project-local `.workbuddy/` layer.*

### Development install

```bash
# Symlink the plugin into WorkBuddy's plugin directory
ln -s "$(pwd)/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy

# Verify the plugin loads
./lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
```

### Production install (v0.7+)

```bash
# From WorkBuddy: /plugins → Add Marketplace → enter repository URL
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
```

## Development Status

| Version | Phase | Status |
|---------|-------|--------|
| v0.1 | Architecture | ✅ Complete |
| v0.2 | Project memory | ✅ Complete |
| v0.3 | Plugin scaffold | ✅ Current |
| v0.4 | Skills & commands | 🔧 Next |
| v0.5 | Subagents | 📋 Planned |
| v0.6 | Hooks & safety | 📋 Planned |
| v0.7 | Run ledger & loop | 📋 Planned |
| v0.8 | MCP & dashboard | 📋 Planned |
| v0.9 | Hardening | 📋 Planned |
| v0.10 | Migration planner | 📋 Planned |
| v0.11 | Dogfood | 📋 Planned |
| v0.12 | Release | 📋 Planned |

## License

MIT — see [LICENSE](LICENSE) (or repository LICENSE file).

---

_This is the installable WorkBuddy plugin for Lazyworkbuddy. The project-local `.workbuddy/` layer provides repository-specific memory and rules. See [`workbuddy.md`](../workbuddy.md) for project memory._
