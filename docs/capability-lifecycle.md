# Capability and receipt lifecycle

LazyBuddy v0.16.0-alpha.1 is the current package baseline.
Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.

## Automatic capability selection

`lazybuddy-tooling.sh` applies a local-first policy. It detects compatible `rg`
and `sg`, supports JavaScript/TypeScript and Python LSP navigation, and can run
declared repository-native verification. A task may select one of these
capabilities temporarily without changing host configuration, a target manifest,
a lockfile, or a global tool. Selection is task-scoped and nonpersistent.

The broker selects the lightest eligible local capability for each task without
writing host/project configuration or lockfiles. Local providers are free and
read-only where available. Remote, metered, browser, and architecture
capabilities remain approval-aware; use `approval grant|deny|revoke` with an
explicit workspace, capability, provider, and scope before persistent consent is
recorded. Provider output identifies cost, reachability, credential-reference
state, and the current decision.

The following subcommands are documented in [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md)
and are the authoritative source for the tooling contract:

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

For language-aware navigation, the tooling bridges a real language server over
stdio for JavaScript/TypeScript and Python only. The locked TS/JS provider is
`typescript-language-server@5.3.0` with `typescript@5.9.3`; the locked Python
provider is `basedpyright@1.39.9`. Missing, unsupported, and incompatible
providers are non-blocking readiness states. No target manifest, lockfile,
source file, global path, or host-managed configuration is modified. See the
[optional language-aware navigation](../lazybuddy-plugin/README.md#optional-language-aware-navigation)
section for the `lsp-status`, `lsp-install`, and `lsp-uninstall` subcommands.

These claims are traceable to the capability and receipt lifecycle section of
[handoff.md](handoff.md) and the optional capability policy section of
[lazybuddy-evaluation.md](../lazybuddy-evaluation.md).

## Receipt-owned tooling roots

A missing local provider can be provisioned only in an explicit empty, absolute
receipt-owned tooling root. The receipt records ownership and makes safe removal
possible: uninstall accepts only the exact unmodified owned root and preserves
modified, foreign, linked, caller-owned, project, and host-managed paths.

Receipt ownership is enforced for package tooling. This boundary protects local
tooling and does not authorize removal of host plugin, marketplace, MCP, or
credential state. Plugin, marketplace, and MCP connector removal happens through
the selected host UI or CLI, never through guessed filesystem paths.

The `uninstall` subcommand removes only an unmodified LazyBuddy receipt-owned
tooling root. The `lsp-uninstall` subcommand removes only an unmodified LSP
receipt-owned root. Both enforce the same receipt boundary: modified, foreign,
linked, caller-owned, project, and host-managed paths are preserved.

These claims are traceable to the receipt and safe removal sections of
[handoff.md](handoff.md) and [lazybuddy-evaluation.md](../lazybuddy-evaluation.md).

## CodeGraph lifecycle

CodeGraph is separate from automatic routing. It has a pinned, receipt-owned
lifecycle: explicit install, explicit project initialization, explicit enable,
then an exported MCP fragment that the user merges through the host UI. It never
auto-indexes, auto-starts, enables telemetry, or uses an upstream global
installer. `context-graph` remains a grep-based heuristic fallback, never a
synonym for semantic CodeGraph.

CodeGraph is optional architecture exploration for larger architecture and
cross-file relationship questions. It is disabled by default. The pinned
package is `@colbymchenry/codegraph@1.4.1` and can only be provisioned in an
explicit empty caller-owned tooling root. The lifecycle does not invoke upstream
`codegraph install` or `codegraph uninstall`, download a fallback platform
binary, enable CodeGraph telemetry, or change host MCP configuration. Its npm
cache, npm configuration, Python cache, and CodeGraph runtime are confined to the
receipt-owned tooling root.

The lifecycle subcommands are documented in [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md#conditional-codegraph-architecture-exploration):

```bash
# Inspect only. This never starts CodeGraph or creates .codegraph/.
bash scripts/lazybuddy-tooling.sh codegraph-doctor \
  --target /absolute/project --tooling-root /absolute/lazybuddy-codegraph-tools

# Provision the pinned package, build the project-local index, then enable it.
bash scripts/lazybuddy-tooling.sh codegraph-install \
  --target /absolute/project --tooling-root /absolute/empty/lazybuddy-codegraph-tools
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

These claims are traceable to the capability and receipt lifecycle section of
[handoff.md](handoff.md) and the optional capability policy section of
[lazybuddy-evaluation.md](../lazybuddy-evaluation.md).

## Optional remote capabilities

Context7 and experimental, unpinned `grep_app` are remote capability exports,
not bundled local MCP servers. They are not part of the six-server package
declaration (`run-ledger`, `verification`, `status-dashboard`, `context-graph`,
`code-intel`, and `docs`). They stay disabled unless a user explicitly selects
them; export prints a namespaced fragment for manual host merging and never
writes credentials. Remote calls can egress data or incur cost.

Install, status, and doctor never contact either endpoint. Select one only when
it materially helps: Context7 for current, version-specific library
documentation; experimental, unpinned `grep_app` for public GitHub examples when
local evidence is insufficient.

`remote-enable` is a separate persistent compatibility command. It records an
explicit optional Context7 or `grep_app` selection only in the verified tooling
root; `remote-export-mcp` prints a namespaced merge fragment for the host UI.
Neither command edits host configuration, replaces host entries, or writes raw
credentials. The fragment uses namespaced keys, contains endpoints only, and
deliberately contains no credentials; any credential remains in the user's host
environment. Treat every remote call as potential data egress and cost even
when its provider is marked read-only.

The remote-capability subcommands are documented in [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md#optional-remote-documentation-and-example-search):

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

These claims are traceable to the optional capability policy sections of
[handoff.md](handoff.md) and [lazybuddy-evaluation.md](../lazybuddy-evaluation.md),
and the host-specific exclusions in [handoff.md](handoff.md).

## Playwright

Playwright is outside the bundled local MCP inventory and needs explicit browser
approval. Playwright is disabled until an approval decision permits browser
automation. Offline status, doctor, and readiness checks do not contact remote
providers, start a browser, initialize an index, or persist a host MCP entry.

Package readiness, doctor, and capability-status output are read-only package
evidence. They do not activate optional providers, install a global host
integration, or prove that a live host session connected an MCP server. The
automatic broker does not create an index, launch a process, or enable
telemetry for Playwright.

These claims are traceable to the optional capability policy sections of
[handoff.md](handoff.md) and [lazybuddy-evaluation.md](../lazybuddy-evaluation.md),
and the [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md) verify and
optional capability sections.
