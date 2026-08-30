# Evidence and completion

Completion is a claim backed by evidence, not a green-looking status message.
LazyBuddy separates package readiness from live-host behavior; that distinction
is the most important rule for interpreting results.

For the current v1.2.0 human-facing boundary, the route IDs are
`codebuddy-cli`, `codebuddy-ide`, and `workbuddy`. v2 uses native modes
`invoke-documented`, `observe-only`, `descriptor-only`, and `unavailable`;
public labels `documented-tested`, `documented-untested`,
`observed-build-specific`, and `unavailable`; and evidence scopes `package`,
`probe`, and `current-session`. Marketplace is the default full-plugin route
for CodeBuddy IDE and WorkBuddy. Skills/manual MCP is recovery-only and
mutually exclusive with the full-plugin route; package readiness does not prove
a live host.

The capability contract names four evidence scopes: `package-ready`,
`observed-build-route`, `manual-skills-mcp-fallback`, and `live-host-proof`.
Package checks emit only `package-ready`. The Skills/manual-MCP fallback is
Skills-only plus six manually configured local connectors; it excludes agents,
commands, and hooks. Do not run it together with a full plugin route. Stop the
session, remove only the old LazyBuddy host entries through the host UI, choose
one route, restart, and collect fresh proof for that route.

## Two kinds of evidence

| Evidence | What it can establish | What it cannot establish |
| --- | --- | --- |
| Package checks | Copied assets, declarations, inventories, contracts, and local scripts are present and valid. | That CodeBuddy or WorkBuddy loaded the plugin, ran a hook, or connected MCP. |
| Host observation | A host UI or new session shows the skill/command and required MCP connection. | That every package check or workflow requirement passed. |

Run these from `lazybuddy-plugin/` when applicable:

```bash
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
bash scripts/lazybuddy-mcp-test.sh
bash scripts/lazybuddy-verify.sh
```

The expected package evidence is respectively `PACKAGE_READINESS=full` (or an
explained degraded state), `Doctor check: ALL PASS`, `MCP test: ALL PASS`, and
aggregate JSON containing `"all_pass":true`. The aggregate JSON also records a
bounded per-check status/reason; a timeout is failure, not proof of success.
The release-only publication contract is checked with `bash tests/publication-regression.sh`.

Timeout cleanup is best-effort for trusted package-owned checks: the verifier
terminates the check's dedicated process group and records whether descendants
were still detectable. It is not a security sandbox or a guarantee that every
descendant has stopped. Use a VM or container-backed runner for
genuinely untrusted commands; no no-fork sandbox is enabled by default.

## Read the result at the right scope

Package readiness, doctor, MCP test, and capability status are read-only
package evidence. They do not install a global integration, activate an
optional provider, export a host registration, or prove a running session.
The six local endpoints have JSON-RPC stream regression coverage, including
malformed-input recovery; that is endpoint protocol evidence, not a host
connection claim.

For CodeBuddy, confirm a LazyBuddy skill/command and MCP status in a new
session after using the host plugin flow. For WorkBuddy, verify a
plugin/marketplace session before relying on plugin capabilities. On the local
fallback, confirm imported skills and manually configured connectors. Full
routes are in [host routes](reference/host-routes.md).

## Evidence during work

A reliable done claim names the requested outcome, changed files, exact
commands and results, real-surface/manual-QA observation where needed, cleanup
performed, and any remaining risk. A verifier should independently reproduce
the claimed checks and classify each outcome as pass, failure, warning,
not-applicable, or skipped with a reason.

`lazy-ulw-loop` turns open-ended work into goals with explicit success
criteria. `lazy-start-work` coordinates plan execution, evidence, verification,
and review. `lazy-review-work` passes only when all five lanes pass. These are
workflow gates; they do not erase the host-boundary requirement above.

## Scope and limits

Current verification scope is macOS. Normal CI does not require a sibling
repository. A release-only paired parity check may receive explicitly supplied
sibling roots for comparison, but that is neither a runtime nor installation
dependency. Do not describe a copied repository as a verified WorkBuddy plugin
installer.

For check meanings, expected output, and exclusions, use the
[verification contract](reference/verification-contract.md). For all five
evidence layers, use [test and release verification](09-test-and-release-verification.md). For workflow selection, return to [workflow playbooks](04-workflow-playbooks.md).

## Evidence data flow

Evidence is not a single boolean. The package carries several facts from a
check into the final report:

```mermaid
flowchart LR
    Request["acceptance criteria"] --> Check["chosen package or project check"]
    Check --> Runner["bounded execution"]
    Runner --> Status["status + reason + output tail"]
    Status --> Ledger["run event / evidence reference"]
    Ledger --> Claim["scoped completion claim"]
    Host["manual host observation"] -. separate evidence .-> Claim
```

`lazybuddy-verify.sh` constructs the aggregate status from individual result
files rather than parsing prose. State scripts preserve a run event/evidence
reference separately from verifier output. This lets a reviewer distinguish
“the package check passed,” “the requested surface was observed,” and “the
claim remains limited by an unverified host fact.”
