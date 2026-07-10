# LazyBuddy Plugin

> LazyCodex agent harness for WorkBuddy, CodeBuddy IDE, and CodeBuddy CLI.

## Quick Start

LazyBuddy is a portable bundle for WorkBuddy, CodeBuddy IDE, and CodeBuddy CLI. Import its skills, hooks, and `.mcp.json` definitions through the corresponding host settings; it intentionally has no host-specific plugin manifest.

1. **Install** — clone or copy `lazybuddy-plugin/`, then import the applicable host assets.
2. **Verify** — `./lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh`
3. **Use** — run `/lazy-init-deep`, then `/lazy-ulw-plan`, then `/lazy-start-work`

**Status:** v0.12.0 release-hardening package with Todo 6 gates recorded. See the canonical current status in the repository [README](../README.md).

## What this plugin provides

LazyBuddy brings the LazyCodex/OmO agent harness to WorkBuddy:

- **Hierarchical project memory** (`/lazy-init-deep`) — generates `workbuddy.md` with directory scoring
- **Prometheus planning** (`/lazy-ulw-plan`) — decision-complete work plans; never writes product code
- **Orchestrated execution** (`/lazy-start-work`) — delegates to subagents; never implements directly
- **Verified completion loop** (`/lazy-ulw-loop`) — evidence-backed done claims with adversarial verification
- **5-agent parallel review** (`/lazy-review-work`) — goal/QA/code/security/context; all 5 must pass
- **Ultrawork mode** (`/lazy-ultrawork`) — binding directive with tier triage and Manual-QA discipline

## Component Map

| Directory | Purpose | Status |
|-----------|---------|--------|
| `skills/` | 14 WorkBuddy Skills (workflow knowledge) | ✅ Implemented (v0.4) |
| `commands/` | Slash command entry points | ✅ Implemented (v0.4) |
| `agents/` | 13 WorkBuddy subagents | ✅ Implemented (v0.5) |
| `hooks/hooks.json` | 12 lifecycle hooks (3 enforcement + 9 advisory) | ✅ Implemented (v0.6) |
| `mcp/` | 8 MCP servers (5 run-management + 3 context-tooling substitutes) | Runtime-smoked in v0.12; context tooling remains heuristic |
| `scripts/` | State ledger (10) + loop (5) + hooks (12) + validation scripts | ✅ Implemented (v0.6–v0.7) |
| `schemas/` | State ledger schemas | ✅ Documented in docs/lazybuddy-state-schema.md (v0.7) |

## Install

In CodeBuddy IDE and WorkBuddy, import the applicable `skills/*/SKILL.md` bundles and configure MCP through host settings. In CodeBuddy CLI, configure the bundled `.mcp.json` definitions and invoke the included scripts from the project checkout.

### Development install

```bash
# Verify the portable bundle
./lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
```

### Marketplace install

```bash
# CodeBuddy IDE / WorkBuddy: import skills and configure MCP in settings.
# CodeBuddy CLI: configure lazybuddy-plugin/.mcp.json in CLI MCP settings.
```

## Uninstall

```bash
rm -rf ~/.workbuddy/plugins/lazybuddy
```

## Verify

```bash
# Doctor: validates plugin structure
./lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh

# Smoke test: checks SKILL.md frontmatter and command stubs
./lazybuddy-plugin/scripts/lazybuddy-smoke-test.sh

# Docs check: verifies no broken internal links
./lazybuddy-plugin/scripts/lazybuddy-docs-check.sh

# Aggregate verification: doctor, smoke, docs, parity, security, MCP, and hooks
./lazybuddy-plugin/scripts/lazybuddy-verify.sh
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

_This is the portable WorkBuddy and CodeBuddy bundle for LazyBuddy. Host-managed `.codebuddy/` and `.workbuddy/` directories and runtime `.lazycodebuddy/` and `.lazyworkbuddy/` directories are intentionally ignored._
