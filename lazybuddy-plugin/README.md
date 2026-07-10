# LazyBuddy Plugin

> LazyCodex agent harness for CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy.

## Quick Start

`.codebuddy-plugin/plugin.json` is the documented CodeBuddy host entry point. `.workbuddy-plugin/plugin.json` is retained internal, unverified compatibility metadata—not an executable copied-repository WorkBuddy installer. WorkBuddy documents plugins/marketplaces, but a LazyBuddy install through that UI must be verified in a live session. The verified no-package-manager fallback imports the local `skills/` package and configures compatible MCP connectors manually.

1. **Onboard** — copy or clone [LazyBuddy](https://github.com/elvinzhao10/LazyBuddy), open it in the selected host, and type `onboard`.
2. **Verify the package** — from this `lazybuddy-plugin/` directory, run `bash scripts/lazybuddy-load-check.sh`, then `bash scripts/lazybuddy-plugin-doctor.sh`. These checks report package readiness, not host loading or MCP connection.
3. **Verify the host** — in CodeBuddy, confirm one `/lazybuddy:lazy-<command>` or skill and any required MCP connection. In WorkBuddy, verify a plugin/marketplace session before using its plugin capabilities, or confirm an imported skill and manually configured connector on the no-package-manager path.
4. **Use the workflow** — in CodeBuddy, `/lazybuddy:lazy-<command>` commands; in WorkBuddy, use the equivalent natural-language workflow or imported skill unless a verified plugin session exposes a command.

**Status:** v0.15.0-alpha.2. See the repository [README](../README.md) for the user workflow and [AGENTS.md](../AGENTS.md) for host-specific onboarding.

## What this plugin provides

LazyBuddy brings the LazyCodex/OmO agent harness to CodeBuddy and WorkBuddy. WorkBuddy plugin/marketplace behavior must be verified in a live session; its local fallback uses imported skills:

- **Hierarchical project memory** (`/lazybuddy:lazy-init-deep`) — generates `workbuddy.md` with directory scoring
- **Prometheus planning** (`/lazybuddy:lazy-ulw-plan`) — decision-complete work plans; never writes product code
- **Orchestrated execution** (`/lazybuddy:lazy-start-work`) — delegates to subagents; never implements directly
- **Verified completion loop** (`/lazybuddy:lazy-ulw-loop`) — evidence-backed done claims with adversarial verification
- **5-agent parallel review** (`/lazybuddy:lazy-review-work`) — goal/QA/code/security/context; all 5 must pass
- **Ultrawork mode** (`/lazybuddy:lazy-ultrawork`) — binding directive with tier triage and Manual-QA discipline

## Component Map

| Directory | Purpose | Status |
|-----------|---------|--------|
| `skills/` | 14 portable workflow skills | CodeBuddy plugin content; verified WorkBuddy local import source |
| `commands/` | 15 slash-command entry points | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `agents/` | 13 agent role definitions | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `hooks/hooks.json` | 12 host hook-event declarations | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `mcp/` and `.mcp.json` | 8 local MCP server declarations | CodeBuddy declarations; manual connector configuration is the verified WorkBuddy fallback |
| `scripts/` | state, loop, hooks, and validation utilities | Used by package readiness and workflow checks |
| `templates/AGENTS.md` | reusable onboarding guide | A template; no installer claims it was generated |

## Install

For **CodeBuddy CLI**, use the marketplace commands below. For **CodeBuddy IDE**, install the copied package through its plugin flow, then verify a real command/skill and MCP status in a new session. For **WorkBuddy**, use its documented plugin/marketplace UI and verify the loaded session; the verified no-package-manager fallback is local `skills/` import with manual MCP configuration.

### Development install

```bash
# From the cloned repository root: add the marketplace and install project-scoped.
codebuddy plugin marketplace add https://github.com/elvinzhao10/LazyBuddy.git --name lazybuddy
codebuddy plugin install lazybuddy@lazybuddy --scope project

# From lazybuddy-plugin/: validate the package and readiness.
cd lazybuddy-plugin
codebuddy plugin validate .
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
```

### Marketplace install

```bash
# CodeBuddy CLI
codebuddy plugin marketplace add https://github.com/elvinzhao10/LazyBuddy.git --name lazybuddy
codebuddy plugin install lazybuddy@lazybuddy --scope project
```

For CodeBuddy IDE, use the current host plugin UI to install the copied package, run `/reload-plugins` when the host exposes it (or its equivalent reload action), then inspect a new session for a loaded `/lazybuddy:lazy-<command>` entry and MCP status. For WorkBuddy, use its documented plugin/marketplace UI and verify the session before relying on any plugin capability. If using the verified no-package-manager path, import `skills/` locally and add MCP connectors manually. Use the host's own uninstall/remove flow; installation locations are host-managed.

## Verify

```bash
# Run from lazybuddy-plugin/.
bash scripts/lazybuddy-plugin-doctor.sh

# Smoke test: checks SKILL.md frontmatter and command stubs.
bash scripts/lazybuddy-smoke-test.sh

# Docs check: verifies no broken internal links, including templates/AGENTS.md.
bash scripts/lazybuddy-docs-check.sh

# Aggregate verification: doctor, smoke, docs, parity, security, MCP, and hooks.
bash scripts/lazybuddy-verify.sh
```

## License

MIT — see the repository [LICENSE](../LICENSE).

---

_This is the installable CodeBuddy package for LazyBuddy. `.workbuddy-plugin` is compatibility metadata, not a direct-folder WorkBuddy installer; WorkBuddy uses its documented UI/marketplace with a live-session check, or the verified local `skills/` import plus manual MCP fallback. The repository-local `.workbuddy/` directory is host-managed development state and is intentionally not part of the release package._
