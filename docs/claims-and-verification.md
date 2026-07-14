# Documentation claims and verification

LazyBuddy v0.16.0-alpha.1 is the current package baseline.
Capability-readiness contract version 0.17.0 is separate from LazyBuddy package release versioning and does not claim a LazyBuddy package release.

## Public capability status contract

Load-check, doctor, status, and provider reports are read-only canonical
package evidence. They report copied assets, eligible local providers, policy,
and receipt state. They do not imply provider execution, host registration,
optional activation, or a live CodeBuddy/WorkBuddy session.

## How to verify documentation claims

Run package checks from `lazybuddy-plugin/`:

```bash
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
bash scripts/lazybuddy-mcp-test.sh
bash scripts/lazybuddy-verify.sh
bash tests/v018-documentation-regression.sh
```

Use command output and the package source as the authority. Verify internal
links with `bash scripts/lazybuddy-docs-check.sh`. When documenting a host
claim, distinguish the package command's result from the user-observed host
result. When documenting an inventory, compare it with the manifests and
load-check output rather than copying an old count.

## Receipt and safe removal

The receipt is the ownership boundary. Document package tooling removal as
receipt-bound and host removal as host-managed: remove only an exact,
unmodified package-owned root with the documented command. Preserve foreign,
modified, linked, caller-owned, project, and host assets. Plugin, marketplace,
and MCP connector removal happens through the selected host UI or CLI, never
through guessed filesystem paths.

## macOS verification scope

LazyBuddy is verified on macOS only. Normal CI does not require a sibling
repository. Release-only paired parity can receive explicitly supplied sibling
roots as evidence; it is never a runtime, installation, or normal-CI
dependency.
