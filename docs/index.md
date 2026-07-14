# LazyBuddy documentation index

LazyBuddy v0.16.0-alpha.1 is the current package baseline.
Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.

## Reading order

1. [README.md](../README.md) — user workflow, host choices, automatic local capability routing, safe removal
2. [AGENTS.md](../AGENTS.md) — agent-facing onboarding and offboarding contract
3. [lazybuddy-plugin/README.md](../lazybuddy-plugin/README.md) — self-contained package guide with exact installation, verification, tooling, and uninstall commands
4. [lazybuddy-plugin/docs/verification-matrix.md](../lazybuddy-plugin/docs/verification-matrix.md) — package evidence mapped to host observations it cannot make
5. [lazybuddy-evaluation.md](../lazybuddy-evaluation.md) — present public verification boundary
6. [handoff.md](handoff.md) — documentation governance handoff

## Topic guides in this directory

- [capability-lifecycle.md](capability-lifecycle.md) — automatic capability selection, receipt-owned tooling roots, CodeGraph lifecycle, optional remote capabilities
- [host-verification.md](host-verification.md) — package readiness versus host verification boundary, required host observations, known unverified behavior
- [claims-and-verification.md](claims-and-verification.md) — how to write verifiable documentation claims and the verification command suite

## Repository and package boundaries

The `lazybuddy-plugin/` package is self-contained — its skills, commands, agents, hooks, MCP servers, templates, scripts, and checks work when copied without root documentation. Root documentation in `docs/` may reference the package; the package has no runtime dependency on `docs/`.

## macOS verification scope

LazyBuddy is verified on macOS only.
