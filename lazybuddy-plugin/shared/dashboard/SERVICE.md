# Dashboard service core

The Buddy service requires Node 18 or newer and the existing dependency-free
Python 3.10+ runtime. `python3` must be on PATH for descriptor-relative local
file reads; `--python /absolute/python3` selects the Buddy transaction bridge.
No npm install or sibling checkout is needed. The packaged `service-read.py`
is required on macOS as well as Linux; missing Python fails closed with
`UNSAFE_REFERENCE`. It never falls back to a path-only file read.

```
node lazybuddy-plugin/shared/dashboard/service.mjs start --project-root /private/tmp/dashboard-project --project-id project:demo --run-id demo
node lazybuddy-plugin/shared/dashboard/service.mjs status --project-root /private/tmp/dashboard-project --project-id project:demo --run-id demo
node lazybuddy-plugin/shared/dashboard/service.mjs stop --project-root /private/tmp/dashboard-project --project-id project:demo --run-id demo
```

The project must be canonical, contain an existing Buddy run, and have no
symlink ancestors. The service binds literal `127.0.0.1`, always requests port 0,
and returns the actual URL and credential file location. Credential bytes never
appear in CLI output or URLs. Per-binding mode-0700 storage contains a 0600
credential and signed receipt. Status and stop validate signature, project/run,
PID start identity, Node executable digest, service digest and a fresh
authenticated challenge. Stop requests shutdown from that instance; it never
discovers or signals a port owner. A stale/forged receipt is a refusal, not
permission to launch or kill another process. Repeated stop after owned cleanup
returns `already-absent`. Keep a stopped binding's credential protected.

## HTTP contract

Every request needs the exact bound Host. POST additionally requires the exact
Origin (`http://127.0.0.1:<actual port>`); GET may omit Origin for local CLI use.
Foreign and `null` origins, duplicate security headers, query strings and
encoded routes reject. No permissive CORS response is emitted.

| Route | Authentication and result |
| --- | --- |
| POST `/api/session` | `X-Dashboard-Bootstrap` from protected credential file, `Content-Type: application/json`, body `{}`. Returns an expiring session token and expiry. |
| GET `/api/snapshot` | `Authorization: Bearer <session>`; returns `{snapshot,cursor,editability,queue_authority,evidence}`. |
| GET `/api/updates` | Same auth, optional `X-Dashboard-Cursor` from the previous response; returns a freshly reconstructed committed snapshot. |
| POST `/api/commands` | Same auth, exact Origin, JSON typed B1 command. Actor is assigned by the session. 200 means durable `pending_agent`; 409 means revision conflict; 422 means rejection. |
| GET `/api/evidence/<id>` | Same auth, opaque ID from snapshot references. Only current committed references are readable. Regular bounded files only; every ancestor is descriptor-pinned, links/FIFOs/replacements reject. Attachment content is inert `application/octet-stream`. |

Polling is intentionally immediate; there are no SSE subscribers or in-memory
event queues. Cursor continuity uses persisted revisions and source digests.
Foreign/old/gapped/rotated/corrupt inputs produce `resync_required`; malformed
or oversized cursors return 409 `RESYNC_REQUIRED`. Reconnect must reconcile a
fresh snapshot before writing. Retry the same command ID/content after a lost
response to reconstruct the original committed result, including after restart.
Changed content with the same ID rejects. Commands do not dispatch execution or
consume a plan revision. External approved plans expose
`EXTERNAL_PLAN_READ_ONLY`. Queue authority is explicitly unavailable until B2
bindings are integrated; no queue storage or activation exists in this core.

Protected internal `/internal/challenge` and `/internal/stop` require bootstrap
authentication, exact Origin, instance nonce and fresh challenge. They are
lifecycle protocol routes, not browser command operations.

Limits: 64 KiB streamed body, 1.5 s body deadline, 8 KiB headers, 4 KiB cursor,
8 MiB response/evidence, 256 evidence references, 16 expiring sessions, eight
active operations, 32 sockets, five-second idle/slow-response deadline, existing
45-second bridge deadline. Shutdown drains admitted authority operations before
exit. Pre-promotion IPC loss aborts the child, with a 12-second startup watchdog.

## Adapter and asset boundaries

`service-adapter.mjs` exports `buddyAuthority` and `authorityFor(options)`.
Programmatic service hosts can provide `options.authority` implementing
`read(options)`, `execute(options)`, `project(input)` and
`readReference(options, relativePath)`. `project` must return the existing
bounded snapshot contract. The read result is passed directly to this trusted
projection seam; its state object is
preserved for B1's private compatibility proof. A sibling adapter supplies its
native authority and filesystem reader; it must not silently import Buddy's
Python requirement. Lifecycle/CLI binding in this increment is Buddy-specific.
No public HTTP consume, shell, patch, file-write or manual-pass route exists.

The default projection calls `projectSnapshot(input)` without completion proof.
Receipt existence therefore cannot promote a criterion to verified through
this core. A later trusted completion adapter may call the existing projector
with an independently authenticated authority proof, preserving the captured
input identity. No request field supplies a projector or completion proof.
Actual verifier authority through HTTP/UI remains a B4/C2 integration gate.

Until accepted packaged UI is integrated, `/` returns 503 `UI_UNAVAILABLE`.
The trusted CLI's explicit `--asset-root /canonical/root` permits only
`index.html` (`/`), `index.mjs` and `styles.css`; all other paths reject.
QA uses `explicit-temporary-qa-assets`, never a claimed C1 UI or native host.
Static responses use a restrictive CSP, no-store and nosniff.

```
node --test lazybuddy-plugin/shared/dashboard/test/service.test.mjs
node lazybuddy-plugin/shared/dashboard/qa/service-core.mjs --evidence-dir /absolute/evidence
```

On Node 18.0.0 run the test module directly because that release lacks `--test`.
The QA tool captures sanitized actual `curl -i` requests/responses, persisted
before/after data, lifecycle invocations and owned resource cleanup.
