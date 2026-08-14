# WorkBuddy sanitized observation bundle

This package records a caller-supplied, redacted observation. It does not read
WorkBuddy private state, authenticate, change a permission mode, toggle a tool,
connect a Connector, or invoke an Expert, Automation, or Assistant. The
WorkBuddy host remains authoritative. A package manifest, load check, success
message, or marketplace receipt alone cannot populate this bundle or promote
host readiness.

The boundary is implemented by
`scripts/lazybuddy-workbuddy-observation.js` and described by
`contracts/workbuddy-observation-bundle.v1.schema.json`. Its production parser
is deliberately stricter than the portable JSON Schema: it requires all
surfaces in canonical order, exact surface-specific descriptor fields, current
timestamps, matching build/session and Todo 17 receipt digest, and one exact
`host_observation_linked` event already owned by `mcp/run-ledger/`.

## Surface policy

| Surface | Native mode | Persisted descriptor |
| --- | --- | --- |
| Permission mode | `observe-only` | `default` or `full-access`; selection is always `not-performed` |
| Tasks and plans | `observe-only` | Opaque IDs, typed status, update time, value digest |
| Artifacts, files, changes, previews | `observe-only` | Opaque IDs, typed status, value digest; no names, content, or paths |
| Memory | `observe-only` | enabled/disabled/unknown and revision digest; never memory text |
| Skills | `observe-only` | Opaque Skill ID, enabled state, version digest |
| MCP | `observe-only` | Opaque server ID, connection state, OAuth status, tool-toggle status |
| Connectors | `observe-only` | Opaque Connector ID, type ID, name digest, connection status only |
| Experts, Automations, Assistant | `descriptor-only` | availability plus descriptor digest; no action or invocation field |

Every surface repeats `host_authority: host`, `package_owner: LazyBuddy`, its
own `observed_at` and freshness interval, a redacted source-receipt digest, a
value digest, and the immutable `source_observation_id`. The bundle links to a
single run-ledger event by ID and SHA-256 with `effect: reference-only`; it does
not copy or replace run-ledger state. Output files are immutable and an
existing path is never overwritten.

Forbidden input includes OAuth/token/refresh/cookie/credential material, raw
prompts, memory, messages, file contents, workspace/file/credential paths,
PII-bearing Connector names, action or remote-invocation claims, unknown
surfaces, duplicate Connector IDs, stale task/plan observations, and package
readiness promotion. Inputs and output parents must be real, non-symlinked
filesystem objects.

## Real CLI

Prepare a sanitized JSON observation, the current Todo 17 marketplace receipt,
and a redacted run-ledger event first. Then invoke:

```bash
node scripts/lazybuddy-workbuddy-observation.js observe \
  --release-root "/absolute/active-release" \
  --marketplace-receipt "/absolute/redacted-marketplace-receipt.json" \
  --observation "/absolute/sanitized-observation.json" \
  --run-events "/absolute/project/.lazybuddy/runs/run-id/events.jsonl" \
  --output "/absolute/new-observation-bundle.json" \
  --now "<current-utc-timestamp>" --json
```

The source observation uses record type `workbuddy-sanitized-observation`; a
successful immutable output uses `workbuddy-observation-bundle`. Errors are
typed JSON on stderr and exit nonzero before publication.

## Public-document boundary

The policy follows WorkBuddy's public [Overview](https://www.workbuddy.cn/docs/workbuddy/Overview),
[Permission Modes](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes),
[Memory](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory),
[Skills](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market),
[MCP guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide),
[Connectors](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector),
[Experts](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center),
[Automations](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide),
and [Assistant](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant).
Those pages document UI behavior and status concepts. They do not document a
stable task/artifact/memory/Skills/Connector/Expert/Automation/Assistant
observation API for this package. Accordingly, the boundary never invents one.
