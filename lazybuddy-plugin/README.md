# LazyBuddy Plugin

> Self-contained workflow harness for CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy.

This package belongs to the LazyBuddy learning project. It is
primarily inspired by LazyCodex, while [NOTICE](NOTICE) records LazyCodex and
OmO upstream attribution. It is an independent implementation and does not
require LazyCodex or OmO at runtime.

## Quick Start

`.codebuddy-plugin/plugin.json` is the documented CodeBuddy host entry point. `.workbuddy-plugin/plugin.json` is retained internal, unverified compatibility metadata—not an executable copied-repository WorkBuddy installer. WorkBuddy documents plugins/marketplaces, but a LazyBuddy install through that UI must be verified in a live session. The verified no-package-manager fallback imports the local `skills/` package and configures compatible MCP connectors manually.

1. **Onboard** — copy or clone [LazyBuddy](https://github.com/elvinzhao10/LazyBuddy), open it in the selected host, and type `onboard`.
2. **Verify the package** — from this `lazybuddy-plugin/` directory, run `bash scripts/lazybuddy-load-check.sh`, then `bash scripts/lazybuddy-plugin-doctor.sh`. These checks report package readiness, not host loading or MCP connection.
3. **Verify the host** — in CodeBuddy, confirm one `/lazybuddy:lazy-<command>` or skill and any required MCP connection. In WorkBuddy, verify a plugin/marketplace session before using its plugin capabilities, or confirm an imported skill and manually configured connector on the no-package-manager path.
4. **Use the workflow** — in CodeBuddy, `/lazybuddy:lazy-<command>` commands; in WorkBuddy, use the equivalent natural-language workflow or imported skill unless a verified plugin session exposes a command.

**Verification scope:** macOS only. Repository-level public guides cover the
workflow and host-specific onboarding/offboarding; package readiness remains
package evidence, not proof of live host loading or MCP connection.

## What this plugin provides

LazyBuddy provides a workflow harness for CodeBuddy and WorkBuddy. WorkBuddy plugin/marketplace behavior must be verified in a live session; its local fallback uses imported skills:

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
| `commands/` | 14 current slash-command workflows | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `agents/` | 13 agent role definitions | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `hooks/hooks.json` | 12 host hook-event declarations | CodeBuddy; WorkBuddy only after a verified plugin/marketplace session |
| `mcp/` and `.mcp.json` | 6 local MCP server declarations | CodeBuddy declarations; manual connector configuration is the verified WorkBuddy fallback |
| `scripts/` | state, loop, hooks, and validation utilities | Used by package readiness and workflow checks |
| `templates/AGENTS.md` | reusable onboarding guide | A template; no installer claims it was generated |

## Install

For **CodeBuddy CLI**, discover the current LazyBuddy marketplace entry through
the host's marketplace documentation or UI. Confirm the publisher and review
the exact immutable revision or release reference supplied there before
installing; this repository does not endorse a mutable marketplace URL. For
**CodeBuddy IDE**, install the copied package through its plugin flow, then
verify a real command/skill and MCP status in a new session. For **WorkBuddy**,
use its documented plugin/marketplace UI and verify the loaded session; the
verified no-package-manager fallback is local `skills/` import with manual MCP
configuration.

### Development validation

```bash
# From lazybuddy-plugin/: validate the package and readiness.
cd lazybuddy-plugin
codebuddy plugin validate .
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
```

### Marketplace install

For CodeBuddy CLI, use the host's current marketplace discovery flow to locate
LazyBuddy. Inspect the publisher and the exact immutable revision or release
reference before running the host-generated install command. No reviewed
immutable marketplace reference is bundled here, so this guide intentionally
does not provide a marketplace-add URL or an executable install command.

For CodeBuddy IDE, use the current host plugin UI to install the copied package, run `/reload-plugins` when the host exposes it (or its equivalent reload action), then inspect a new session for a loaded `/lazybuddy:lazy-<command>` entry and MCP status. For WorkBuddy, use its documented plugin/marketplace UI and verify the session before relying on any plugin capability. If using the verified no-package-manager path, import `skills/` locally and add MCP connectors manually. Use the host's own uninstall/remove flow; installation locations are host-managed.

## Uninstall

Use CodeBuddy's plugin removal flow for a CodeBuddy IDE or CLI installation,
then remove or disable only the LazyBuddy MCP servers that were manually
registered. Use WorkBuddy's documented plugin/marketplace removal flow for a
verified WorkBuddy plugin installation. For the local-import fallback, remove
the imported `skills/` entries through WorkBuddy's Skills UI and remove the
manually configured connectors through Settings. Never guess, scan for, or
delete host-managed installation paths, `.workbuddy-plugin` compatibility
metadata, `.workbuddy` state, or MCP configuration belonging to another host.
The copied repository is independent of host removal and may be deleted only
after the host confirms the plugin/skills and connectors are gone. The root
`offboard` protocol records this package result separately from the
user-observed host result.

## Verify

```bash
# Run from lazybuddy-plugin/.
bash scripts/lazybuddy-plugin-doctor.sh

# Smoke test: checks SKILL.md frontmatter and command stubs.
bash scripts/lazybuddy-smoke-test.sh

# Docs check: verifies no broken internal links, including templates/AGENTS.md.
bash scripts/lazybuddy-docs-check.sh

# Aggregate verification: doctor, smoke, docs, security, MCP, and hooks.
bash scripts/lazybuddy-verify.sh
```

Package readiness, doctor, and capability-status output are read-only package
evidence. They do not activate optional providers, install a global host
integration, or prove that a live host session connected an MCP server. See the
package-owned [verification matrix](docs/verification-matrix.md) for the local
checks and manual host observations.

## Optional local tooling

LazyBuddy can use a local, package-owned fallback for `rg` (ripgrep) and `sg`
(ast-grep). It first detects compatible host tools without changing them. When
one is missing, installation is allowed only into an empty, absolute tooling
root chosen by the caller; it never installs into a target project, global
location, or host-managed path.

```bash
# Inspect host/owned providers without changing anything.
bash scripts/lazybuddy-tooling.sh detect --tooling-root /absolute/path/to/lazybuddy-tools

# Install locked fallback tools only when host providers are missing.
bash scripts/lazybuddy-tooling.sh install --tooling-root /absolute/empty/lazybuddy-tools

# Inspect repository-native checks without running them.
bash scripts/lazybuddy-tooling.sh verify --target /absolute/project --dry-run

# Run only explicitly selected, declared checks with a 60-second default limit.
bash scripts/lazybuddy-tooling.sh verify --target /absolute/project --run lint test

# Remove only an unmodified LazyBuddy receipt-owned tooling root.
bash scripts/lazybuddy-tooling.sh uninstall --tooling-root /absolute/path/to/lazybuddy-tools
```

Repository verification recognizes package-manager lockfiles plus declared
`lint`, `typecheck`, `test`, and `build` scripts, explicit
`[tool.lazyseries.verification]` commands in `pyproject.toml`, and declared
Make targets. Dry runs do not change the target. Runs do not install target
dependencies or guess commands; a timed-out selected check exits `124`.

### Automatic capability selection and approvals

The installed package carries the versioned automatic-tooling contract and its
provider-policy adapter. Start with an offline status check or create the
reference-only user configuration:

```bash
bash scripts/lazybuddy-tooling.sh setup --non-interactive --json
bash scripts/lazybuddy-tooling.sh providers --policy ask-once --json
```

Automatic work is task-scoped: the broker selects the lightest eligible
provider for that task and does not write host MCP configuration or export a
registration. Local providers are free/read-only where available. Remote,
metered, browser, and architecture capabilities remain approval-aware; use
`approval grant|deny|revoke` with an explicit workspace, capability, provider,
and scope before persistent consent is recorded. Provider output identifies
cost, reachability, credential-reference state, and the current decision.

`remote-enable` is a separate persistent compatibility command. It records an
explicit optional Context7 or `grep_app` selection only in the verified
tooling root; `remote-export-mcp` prints a namespaced merge fragment for the
host UI. Neither command edits host configuration, replaces host entries, or
writes raw credentials. Treat every remote call as potential data egress and
cost even when its provider is marked read-only.

Playwright is also disabled until an approval decision permits browser
automation. CodeGraph remains a separate explicit install/init/enable flow;
the automatic broker does not create an index, launch a process, or enable
telemetry. The local `context-graph` MCP remains only a grep-based fallback.

### Optional language-aware navigation

LazyBuddy can bridge a real language server over stdio for JavaScript/
TypeScript and Python only. It first detects source/configuration, then uses a
compatible project-local or host provider without changing it. If neither is
available, provision exactly one selected language into a separate empty,
absolute LSP tooling root. The bridge exposes only read-only operations the
provider advertises: definition, references, symbols, hover/type information,
and diagnostics. Rename is intentionally unavailable.

```bash
# Inspect without changing the project or tooling root.
bash scripts/lazybuddy-tooling.sh lsp-status \
  --target /absolute/project --tooling-root /absolute/lazybuddy-lsp-tools

# Provision the detected TS/JS or Python provider only in the empty root.
bash scripts/lazybuddy-tooling.sh lsp-install \
  --target /absolute/project --tooling-root /absolute/empty/lazybuddy-lsp-tools

# A host MCP configuration can launch this package-owned stdio bridge.
CWD=/absolute/project LAZYBUDDY_TOOLING_ROOT=/absolute/lazybuddy-lsp-tools \
  bash mcp/lsp/server.sh

# Remove only an unmodified LSP receipt-owned root.
bash scripts/lazybuddy-tooling.sh lsp-uninstall \
  --target /absolute/project --tooling-root /absolute/lazybuddy-lsp-tools
```

The locked TS/JS provider is `typescript-language-server@5.3.0` with
`typescript@5.9.3`; it requires Node.js 20 or newer. The locked Python
provider is `basedpyright@1.39.9`. Missing, unsupported, and incompatible
providers are non-blocking readiness states. No target manifest, lockfile,
source file, global path, or host-managed configuration is modified.

### Conditional CodeGraph architecture exploration

CodeGraph is an optional, real local MCP capability for larger architecture and
cross-file relationship questions. It is disabled by default. LazyBuddy keeps
`context-graph` available as a clearly labeled grep-based heuristic fallback;
it is not represented as semantic CodeGraph analysis.

CodeGraph is pinned to `@colbymchenry/codegraph@1.4.1` and can only be
provisioned in an explicit empty caller-owned tooling root. The lifecycle does
not invoke upstream `codegraph install` or `codegraph uninstall`, download a
fallback platform binary, enable CodeGraph telemetry, or change host MCP
configuration. Its npm cache, npm configuration, Python cache, and CodeGraph
runtime are confined to the receipt-owned tooling root. Start only after you
deliberately choose a project root:

```bash
# Inspect only. This never starts CodeGraph or creates .codegraph/.
bash scripts/lazybuddy-tooling.sh codegraph-doctor \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools

# Provision the pinned package, build the project-local index, then enable it.
bash scripts/lazybuddy-tooling.sh codegraph-install \
  --target /absolute/project --tooling-root /absolute/absent/lazybuddy-codegraph-tools
bash scripts/lazybuddy-tooling.sh codegraph-init \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools
bash scripts/lazybuddy-tooling.sh codegraph-enable \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools

# Print an explicit MCP registration fragment; merge it through the host UI.
bash scripts/lazybuddy-tooling.sh codegraph-export-mcp \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools

# Remove only an index proven by LazyBuddy's receipt, then remove the tooling root.
bash scripts/lazybuddy-tooling.sh codegraph-uninstall \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools
bash scripts/lazybuddy-tooling.sh uninstall \
  --tooling-root /absolute/lazybuddy-codegraph-tools
```

`codegraph-doctor` recommends the capability only at 500 supported source files
or 100,000 supported source lines. It makes no network, process, or index call.
The MCP launcher invokes only `codegraph serve --mcp` with fallback download
disabled. A pre-existing `.codegraph/` directory is preserved by uninstall.

### Optional remote documentation and example search

Context7 and `grep_app` are optional remote MCP registration fragments, not
bundled MCP servers and not part of the six-server package declaration. They
are disabled by default: install, status, and doctor never contact either
endpoint. Select one only when it materially helps: Context7 for current,
version-specific library documentation; experimental, unpinned `grep_app` for
public GitHub examples when local evidence is insufficient.

Use a verified receipt-owned tooling root, then export the fragment and merge
it through the host UI without replacing existing MCP entries. The fragment
uses namespaced keys, contains endpoints only, and deliberately contains no
credentials; any credential remains in the user's host environment.

```bash
# Inspect optional state without making a remote request.
bash scripts/lazybuddy-tooling.sh remote-status \
  --tooling-root /absolute/lazybuddy-tools

# Enable only the desired registration fragments.
bash scripts/lazybuddy-tooling.sh remote-enable \
  --tooling-root /absolute/lazybuddy-tools context7
bash scripts/lazybuddy-tooling.sh remote-enable \
  --tooling-root /absolute/lazybuddy-tools grep_app

# Print a merge-only MCP fragment; it does not edit host configuration.
bash scripts/lazybuddy-tooling.sh remote-export-mcp \
  --tooling-root /absolute/lazybuddy-tools

# Disable an optional registration without touching any host entry.
bash scripts/lazybuddy-tooling.sh remote-disable \
  --tooling-root /absolute/lazybuddy-tools context7
```

## License

MIT — see the package [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

_This is the installable CodeBuddy package for LazyBuddy. `.workbuddy-plugin` is compatibility metadata, not a direct-folder WorkBuddy installer; WorkBuddy uses its documented UI/marketplace with a live-session check, or the verified local `skills/` import plus manual MCP fallback. The repository-local `.workbuddy/` directory is host-managed development state and is intentionally not part of the release package._
