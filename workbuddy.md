# workbuddy.md — LazyBuddy

## OVERVIEW
LazyBuddy is a self-contained agent workflow harness plugin for CodeBuddy IDE/CLI and WorkBuddy. It turns a request into plan → implementation → verification → evidence trail. The installable package lives in `lazybuddy-plugin/` (v0.16.0-alpha.1): 14 skills, 14 commands, 13 agents, 12 hook events, 6 local MCP servers. Stack: Bash scripts + Markdown skills + JSON manifests; MCP servers in Node/Python. No build step.

## STRUCTURE
```
README.md                 # public workflow + automatic capability boundaries
AGENTS.md                 # agent onboarding/offboarding contract (host paths table)
docs/handoff.md           # documentation handoff — authority for doc claims/boundaries
lazybuddy-evaluation.md   # public verification boundary evidence
lazybuddy-plugin/         # THE self-contained installable package
  skills/                 # 14 lazy-* workflow playbooks (one SKILL.md per dir)
  commands/               # 14 slash-command stubs (map to skills)
  agents/                 # 13 agent role definitions
  hooks/hooks.json        # 12 host hook-event declarations
  mcp/                    # 6 local MCP servers (run-ledger, verification, status-dashboard, context-graph, code-intel, docs)
  scripts/                # load-check, doctor, verify, tooling, state, loop, hooks
  tooling/                # lsp (python/typescript bridges), provider-policy adapter
  templates/AGENTS.md     # reusable onboarding template
  contracts/fixtures/v017/# capability-readiness contract fixtures
  tests/                  # regression + documentation tests
  schemas/                # JSON schemas
  docs/                   # verification-matrix.md + package docs
  .codebuddy-plugin/      # plugin.json — CodeBuddy host entry point
  .workbuddy-plugin/      # plugin.json — compatibility metadata, NOT an installer
  .mcp.json               # 6 MCP server config
dev/
  reference/lazycodex/    # upstream LazyCodex/OmO reference impl (read-only, 1300+ files)
  docs/root/README.md     # dev doc
.lazybuddy/               # run-state: context/, plans/, drafts/, runs/, executor-verify-state/
```

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Add/modify a workflow playbook | `lazybuddy-plugin/skills/lazy-*/SKILL.md` | One dir per skill; frontmatter + procedure |
| Add a slash command | `lazybuddy-plugin/commands/` | Stubs route to skills |
| Add an agent role | `lazybuddy-plugin/agents/` | 13 role defs (planner, explorer, implementer, verifier, reviewer, QA, security, etc.) |
| Change hook lifecycle policy | `lazybuddy-plugin/hooks/hooks.json` | 12 events; host-loaded only |
| MCP server implementation | `lazybuddy-plugin/mcp/<name>/` | run-ledger, verification, status-dashboard, context-graph, code-intel, docs |
| Verify package readiness | `lazybuddy-plugin/scripts/lazybuddy-load-check.sh` | plus `doctor`, `verify`, `docs-check` |
| Tooling/capability broker | `lazybuddy-plugin/scripts/lazybuddy-tooling.sh` | rg/sg/LSP/CodeGraph/remote capability policy |
| Capability contract fixtures | `lazybuddy-plugin/contracts/fixtures/v017/` | v0.17.0 readiness (separate from package version) |
| Documentation governance | `docs/handoff.md` | authority for doc boundaries; verify links with `lazybuddy-docs-check.sh` |

## CONVENTIONS
- Package version must agree across 3 manifests: `lazybuddy-plugin/.codebuddy-plugin/plugin.json`, `lazybuddy-plugin/.workbuddy-plugin/plugin.json`, root `.codebuddy-plugin/marketplace.json`. Currently `0.16.0-alpha.1`.
- Capability-readiness contract version (`0.17.0`) is separate from package release version — never conflate or claim one implies the other.
- Skills/commands are `lazy-` prefixed; commands namespaced `/lazybuddy:lazy-<command>` in a CodeBuddy plugin session.
- `lazybuddy-plugin/` is self-contained: works without root `README.md`/`AGENTS.md`/`docs/`. No runtime dependencies on root docs.
- Package readiness ≠ host readiness. Always state the required manual host observation separately for each host path.
- Exactly six local MCP servers: `run-ledger`, `verification`, `status-dashboard`, `context-graph`, `code-intel`, `docs`. `context-graph` is a grep-based heuristic, NOT semantic CodeGraph. Filesystem and Playwright are outside the bundled inventory.
- Receipt-owned tooling roots: provision only into an explicit empty absolute path; uninstall removes only the exact unmodified owned root and preserves all foreign/modified/linked/caller-owned/project/host paths.

## ANTI-PATTERNS (explicitly forbidden)
- Claiming package checks prove host loading, MCP connection, or hook execution.
- Auto-indexing, auto-starting, or enabling telemetry for CodeGraph.
- Writing host MCP config or credentials from optional remote exports (Context7/grep_app print merge-only fragments).
- Creating runtime dependencies from `lazybuddy-plugin/` to root documentation.
- Guessing or scanning host-managed paths (`.workbuddy`, plugin locations, credentials) for uninstall.
- Treating `context-graph` as a synonym for semantic CodeGraph.
- Copying inventory counts from old docs — always compare against manifests and load-check output.

## COMMANDS
```bash
# Package verification (run from lazybuddy-plugin/)
bash scripts/lazybuddy-load-check.sh         # package readiness (manifests + inventories + contract)
bash scripts/lazybuddy-plugin-doctor.sh      # 50-check health
bash scripts/lazybuddy-verify.sh             # aggregate: doctor+smoke+docs+security+mcp+hooks
bash scripts/lazybuddy-smoke-test.sh         # SKILL.md frontmatter + command stubs
bash scripts/lazybuddy-docs-check.sh         # internal link integrity
bash tests/v018-documentation-regression.sh  # documentation regression

# Tooling broker (receipt-owned tooling root required)
bash scripts/lazybuddy-tooling.sh detect|install|verify|uninstall --tooling-root <abs>
bash scripts/lazybuddy-tooling.sh lsp-status|lsp-install|lsp-uninstall --target <proj> --tooling-root <abs>
bash scripts/lazybuddy-tooling.sh codegraph-install|init|enable|export-mcp|uninstall ...
bash scripts/lazybuddy-tooling.sh remote-enable|export-mcp|disable --tooling-root <abs> {context7|grep_app}

# Workflow (CodeBuddy plugin session; plain-language equivalent in WorkBuddy)
/lazybuddy:lazy-init-deep        # hierarchical project memory
/lazybuddy:lazy-ulw-plan "..."   # approval-ready plan (never writes product code)
/lazybuddy:lazy-start-work       # execute plan with delegated evidence
/lazybuddy:lazy-review-work      # 5-agent parallel review (all must pass)
/lazybuddy:lazy-ulw-loop "..."   # long-running verified completion loop
/lazybuddy:lazy-ultrawork        # binding high-precision mode with tier triage
```

No build step — the package is Bash + Markdown + JSON. Tests are shell scripts in `lazybuddy-plugin/tests/`. Verification scope is macOS only.
