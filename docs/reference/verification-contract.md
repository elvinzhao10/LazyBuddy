# Verification contract

This reference distinguishes local package evidence from host evidence. Run
the package commands from `lazybuddy-plugin/`.

| Step | Command | Expected package evidence |
| --- | --- | --- |
| Package readiness | `bash scripts/lazybuddy-load-check.sh` | `PACKAGE_READINESS=full`, or a specific degraded explanation. |
| Package health | `bash scripts/lazybuddy-plugin-doctor.sh` | `Doctor check: ALL PASS`. |
| MCP integration | `bash scripts/lazybuddy-mcp-test.sh` | `MCP test: ALL PASS`. |
| Aggregate verification | `bash scripts/lazybuddy-verify.sh` | JSON containing `"all_pass":true`. |
| Publication contract | `bash tests/publication-regression.sh` | Root publications, the learner-path manifest, and contained local links pass. |
| Cross-repository learner manifest | `bash tests/v018-docs-manifest-parity.sh --lazybuddy-root "/absolute/lazybuddy" --lazytrae-root "/absolute/lazytrae"` | Explicit roots have the same learner paths and page titles; host-specific prose may differ. |

Package readiness and doctor cover copied assets, six local MCP declarations,
the optional-capability policy, and receipt-safe removal rules. They do not
prove that CodeBuddy or WorkBuddy loaded the package, executed a hook, or
connected MCP. A new-session or host-UI observation remains required; see
[host routes](host-routes.md).

The readiness contract requires `readiness_scope`. Package reports use only
`package-ready`; the other declared scopes are `observed-build-route`,
`manual-skills-mcp-fallback`, and `live-host-proof`. The latter three are
host-observation vocabulary, not package outcomes. In particular, package
checks never emit `host-ready` and never upgrade a local declaration into a
live or connected claim.

The Skills/manual-MCP fallback exposes Skills plus six manually configured
local connectors only. It excludes agents, commands, and hooks. Running the
fallback and a full plugin route together is unsupported because duplicate
Skills or MCP processes can collide. Migrate by stopping the host session,
removing only the old route's LazyBuddy entries through the host UI, choosing
one route, starting a fresh session, and observing that route's capabilities.

Timeouts cover trusted package-owned checks only. The runner starts each check
in its own process group, terminates that group on deadline, and reports any
still-detectable descendants. This is best-effort cleanup, not a security sandbox or a guarantee of descendant cleanup. Use a VM or container-backed runner for genuinely untrusted commands; no no-fork sandbox is enabled by default.

## Intentional exclusions

- CodeBuddy uses its plugin flow. WorkBuddy uses its UI/marketplace or imported
  local skills with manually configured compatible connectors.
- Tooling roots are receipt-owned. Host-managed paths, `.workbuddy` state,
  host MCP entries, and credentials are neither scanned nor removed.
- The package declares six local MCP servers. Context7 and `grep_app` are
  optional export fragments; filesystem and Playwright are not bundled local
  MCP servers.

The package has macOS-only verification. Normal CI has no sibling-repository
dependency. Release-only paired parity may compare explicitly supplied sibling
roots as release evidence; it is not runtime, installation, or normal-CI
dependency.

## Regression test names

Test filenames beginning with `v015`, `v016`, `v017`, or `v018` identify the
release in which that regression boundary was introduced. They are active
compatibility and security checks, not deprecated runtime versions or shipped
legacy implementations. CI prints these stable filenames so a failure points
to the exact regression contract. New tests should use a descriptive,
unversioned filename unless preserving release provenance is necessary.

## Claim matrix

| Evidence type | Establishes | Does not establish |
| --- | --- | --- |
| Manifest and readiness checks | The shipped package inventory and declarations are internally consistent. | Host discovery or a connected MCP server. |
| State and schema checks | Recorded local workflow data has the expected shape. | That the recorded task outcome is correct. |
| MCP protocol tests | A local server handles supported JSON-RPC requests and errors. | That a host has launched or authorized that server. |
| Focused tests and manual QA | The requested behavior was checked on its stated surface. | Behavior outside the tested scope. |
| Host-session observation | The selected host exposed the observed integration in that session. | A guarantee about another host, version, or operating system. |

Use the narrowest matching sentence in a release note or DoneClaim. Combining
different evidence types is useful, but it never upgrades one kind of proof
into another.

Read [test and release verification](../09-test-and-release-verification.md)
for the five evidence layers and [evidence and completion](../05-evidence-and-completion.md)
for how to use these results in a done claim.
