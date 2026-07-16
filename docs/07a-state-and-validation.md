# State and validation

LazyBuddy keeps workflow state under `.lazybuddy/` in the project being worked
on. State makes progress inspectable and recoverable; it does not make a host
integration active or authorize edits outside the task.

## Run artifacts

A run can include `state.json`, append-only `events.jsonl`, checkpoints,
evidence, verification, review, agent outputs, artifacts, and memory updates.
State commands create and update these artifacts as part of the planned
workflow. The precise roles and retention boundary are in [state artifact
reference](reference/state-artifact-reference.md).

## Validation is observable and bounded

The aggregate verifier runs checks with a finite timeout. Each check emits
progress/status records and receives a `pass`, `fail`, `timeout`, or
`unavailable` outcome with a reason in the final JSON. A timeout is a failure,
not a passing slow check. `LAZYBUDDY_VERIFY_TIMEOUT_SECONDS` and
`LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS` must be positive integers when set.

Trusted package-owned verification commands start in a dedicated process
group. On timeout, LazyBuddy best-effort terminates that owned group and reports
whether any still-running descendants were detectable during cleanup. This is
not a security sandbox and does not guarantee cleanup of descendants that leave
the group or re-parent. Run genuinely untrusted commands in a VM or container-backed runner; the verifier does not enable a no-fork sandbox by default.

When the CodeBuddy CLI is absent, the doctor marks its host validator
**UNCHECKED**. A validator launch failure is unavailable; a timeout, nonzero,
or semantic failure is not a host-success claim. These classifications provide
local process evidence only—host proof still requires a fresh host session.

## Read state at the correct boundary

Do not infer a live CodeBuddy or WorkBuddy session from `.lazybuddy/` files,
success-looking JSON, or a DoneClaim. Use [MCP lifecycle](07b-mcp-lifecycle.md)
for the host connection sequence and [test and release verification](09-test-and-release-verification.md)
for the layers of evidence.
