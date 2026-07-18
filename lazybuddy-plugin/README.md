# LazyBuddy Plugin

> Self-contained workflow harness for CodeBuddy IDE, CodeBuddy CLI, and WorkBuddy's Skills/manual-MCP fallback.

This package belongs to the LazyBuddy learning project. It is
primarily inspired by LazyCodex, while [NOTICE](NOTICE) records LazyCodex and
OmO upstream attribution. It is an independent implementation and does not
require LazyCodex or OmO at runtime.

## Local-first onboarding

Keep the pinned `v1.0.2` release in a permanent folder, open or link it in the
selected CodeBuddy or WorkBuddy host, give the agent
`https://github.com/elvinzhao10/LazyBuddy`, and type `onboard`. The agent asks
which host is in use, runs safe package checks, and reports **package
readiness** separately from **host readiness**. Before any host-managed
marketplace, plugin, Skills, connector, account, or credential action it asks
for approval, then gives one exact action and waits. After the response it
inspects the app with Computer Use; reload/new session is a separate action.
If Computer Use is unavailable, a user-pasted verbatim status or screenshot is
observed evidence. Without either, **HOST READINESS: PENDING**.

Route status is explicit: the local marketplace is the **documented CodeBuddy
CLI route**. CodeBuddy IDE plugin loading and WorkBuddy full-plugin loading are
**observed-build routes** only. The `manual-skills-mcp-fallback` is the
supported local fallback. None is current host proof until observed.

## Quick Start

`.codebuddy-plugin/plugin.json` is the documented CodeBuddy host entry point.
`.workbuddy-plugin/plugin.json` is compatibility metadata. The only verified
copied-repository WorkBuddy path is Skills-only import/copy from the local
`skills/` package plus six individual manual local MCP connectors; a full
WorkBuddy plugin/marketplace route requires real host proof in a loaded
session.

1. **Onboard** — open the permanent pinned release in the selected host and type `onboard` after providing the GitHub repository link.
2. **Verify the package** — from this `lazybuddy-plugin/` directory, run `bash scripts/lazybuddy-load-check.sh`, then `bash scripts/lazybuddy-plugin-doctor.sh`. These checks report package readiness, not host loading or MCP connection.
3. **Verify the host** — in CodeBuddy, confirm one `/lazybuddy:lazy-<command>` or Skill and all six MCP connections in a new session. In WorkBuddy, confirm an imported Skill and each manually configured local connector; do not infer commands, agents, hooks, or MCP loading from files or load-check output without full-plugin proof.
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

For **CodeBuddy CLI**, use the local release-root marketplace route below. For
**CodeBuddy IDE**, public guidance covers Skills import and MCP JSON. Use the
plugin flow only when the current build discovers it after approval; that flow
remains build-specific. Otherwise use the Skills/manual-MCP fallback. For
**WorkBuddy**, the supplied prerelease build exposed a full plugin route, but
that observed-build route is not a public compatibility promise. The supported
fallback is Skills-only local `skills/` import/copy with six individual manual
local MCP connectors.

### Development validation

```bash
# From lazybuddy-plugin/: validate the package and readiness.
cd lazybuddy-plugin
codebuddy plugin validate .
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
```

### Marketplace install

For CodeBuddy CLI, pass the absolute **release root** containing
`.codebuddy-plugin/marketplace.json` (not the nested `lazybuddy-plugin/`
directory) to the local marketplace, then install the named entry:

```text
/plugin marketplace add <absolute-local-LazyBuddy-path>
/plugin install lazybuddy@lazybuddy
```

The interactive `/plugin` menu is equivalent: choose Marketplace → Add with
the same release-root path, then install `lazybuddy@lazybuddy`. `--plugin-dir
<absolute-local-LazyBuddy-path>` is for development/testing only, never
persistent, and does not replace this route. Do not automate CodeBuddy
marketplace trust or host installation.

Treat the route as three separate future user actions. First, add the absolute
release root and wait for the agent to observe marketplace discovery; do not
install yet. Second, after a separate approval, install
`lazybuddy@lazybuddy` and wait for the install result. Third, start a fresh
session and observe one real Skill/command plus all six MCP connections.
Package metadata alone is not host readiness.

For CodeBuddy IDE, use the current host plugin UI only after approval and
observed discovery; otherwise import `skills/` and add the six compatible local
MCP connectors manually. For WorkBuddy, use the same fallback unless the
current loaded host proves its observed-build full-plugin route. Use the host's
own uninstall/remove flow; installation locations are host-managed.

## CodeBuddy project-local configuration

`.codebuddy/settings.json` may be shared for non-secret project defaults.
`.codebuddy/settings.local.json` is local/machine scope and must remain ignored
and unstaged; secrets must never be committed. Repeating the local marketplace
route or package readiness checks preserves both files and does not write host
configuration.

Marketplace metadata and local file validation establish **package readiness**;
they are not evidence that commands, agents, hooks, or MCP loaded in a host.

The package readiness contract labels these reports `readiness_scope=package-ready`.
`observed-build-route`, `manual-skills-mcp-fallback`, and `live-host-proof` are
separate host-observation scopes. The fallback is Skills-only plus six manual
MCP connectors; agents, commands, and hooks are excluded. Do not combine the
fallback with a full plugin route for the same project. Stop the session,
remove the old LazyBuddy route through the host UI, select one route, restart,
and verify it in a fresh session.

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

The aggregate command is installed package health and does not read repository-
root learner pages. In a repository checkout, publication validation is a
separate release check: `bash lazybuddy-plugin/tests/publication-regression.sh`.

Package readiness, doctor, and capability-status output are read-only package
evidence. They do not activate optional providers, install a global host
integration, or prove that a live host session connected an MCP server. See the
package-owned [verification matrix](docs/verification-matrix.md) for the local
checks and manual host observations.

Verification timeouts are best-effort cleanup for trusted package-owned
commands. Each command receives its own process group; a deadline terminates
that group and reports any still-detectable descendants in JSON/stderr. This is
not a security sandbox or a guarantee that every descendant stopped. Use a VM or container-backed runner for genuinely untrusted commands; no no-fork sandbox is enabled by default.

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
