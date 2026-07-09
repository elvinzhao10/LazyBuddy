# Lazyworkbuddy Plugin Changelog

## v0.3.0 — Plugin Scaffold (2026-07-09)

- **Created** plugin structure: `.workbuddy-plugin/plugin.json`, component directories (skills/, commands/, agents/, hooks/, mcp/, scripts/, schemas/, tests/, docs/)
- **Created** 8 placeholder commands: init-deep, ulw-plan, start-work, ulw-loop, verifier, reviewer, librarian, migration-planner
- **Created** 8 placeholder skills: same set, each with valid YAML frontmatter stub
- **Created** hooks scaffold (`hooks/hooks.json`) — 12 event types with empty arrays
- **Created** MCP scaffold (`.mcp.json`) — empty `mcpServers: {}`
- **Created** validation scripts: plugin-doctor, smoke-test, docs-check, parity-check
- **Created** plugin docs: README.md, CHANGELOG.md
- **No runtime behavior** — all components are placeholders for v0.4+

---

_Versioning follows the v0.N convention: this is a pre-1.0 build. The plugin version tracks the phase that created the skeleton (v0.3). It will be bumped to 0.12.0 on release._
