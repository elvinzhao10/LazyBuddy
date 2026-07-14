# LazyBuddy v0.17 Handoff

Use this handoff with the package's actual evidence files. It records package observations, not a substitute for opening a CodeBuddy or WorkBuddy session.

## Public capability status contract

Attach canonical read-only capability records with `schema_version`, `contract_version`, `contract_digest`, `host`, `capability`, nullable `provider`, `status`, nullable `reason_code`, `message`, nullable receipt summary, and object `details`. The allowed statuses are `host-ready`, `owned-ready`, `missing`, `incompatible`, `disabled`, `failed-optional`, and `not-initialized`.

## Optional capability policy

Record only observed optional capability state. Do not describe a status, doctor, or load-check as enabling a provider, installing dependencies, registering MCP, or changing global state. Normal CI is self-contained; sibling parity is release-only and must receive its sibling reference explicitly.

## Receipt and safe removal

State the receipt outcome and any preserved paths. Exact receipt-owned assets may be removed; mutable entries are accepted only when already receipt-owned. Preserve unknown, tampered, symlinked, hardlinked, host-owned, user-configured, lockfile, and caller-owned CodeGraph entries. Host registrations are removed manually through the host.

## Package readiness versus host verification

Name package readiness separately from host loading and live MCP connection. `lazybuddy-load-check.sh` and `lazybuddy-plugin-doctor.sh` validate package evidence only. Include the user-observed CodeBuddy/WorkBuddy session/MCP result separately, or mark it unverified.

## JSON-RPC resilience

For MCP evidence, retain the same-stream sequence: malformed JSON (`-32700`, `id: null`), invalid request (`-32600`), notification (no response), then a valid request. Confirm stdout contains only JSON-RPC messages.

## Host-specific exclusions

Retain CodeBuddy/WorkBuddy layouts and workflows: `lazybuddy-plugin/`, `.lazybuddy/`, host marketplace/UI installation, and WorkBuddy local `skills/` import with manual MCP setup. The package declares eight MCP servers and does not declare filesystem or Playwright MCP servers.

## Known unverified host behavior

Do not infer WorkBuddy copied-repository installation, marketplace/plugin loading, host hook enforcement, or live MCP connection from package checks. Mark all unobserved host outcomes as unverified.

## macOS verification scope

Treat this cross-product host verification statement as **macOS only**. Do not extrapolate it to Linux or Windows.
