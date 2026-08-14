# CodeBuddy long-horizon service adapters

`lazybuddy-plugin/scripts/lazybuddy-codebuddy-service.py` wraps the documented
CodeBuddy daemon, background, serve, and prewarm surfaces without contacting a
live host during package verification. The adapter keeps host process state
separate from the LazyBuddy run ledger: service JSON files are ownership
receipts, not a task or completion database.

Every `start` uses the bounded launch supervisor's READY/ACK handshake. The
receipt records the supervisor PID, process-group ID, start identity, child PID,
executable digest, control files, logs, and endpoint. Promotion becomes detached
only after readiness and atomic receipt publication. `stop` calls the existing
exact owned-group termination boundary; it never searches by process name or
signals an unverified PID.

## Supported surfaces

| Kind | Documented host argv | Readiness evidence |
| --- | --- | --- |
| `daemon` | `codebuddy daemon start` | owned supervisor and worker identity |
| `background` | `codebuddy --bg --name <name>` | owned named worker identity |
| `serve` | `codebuddy --serve --port <port>` | exact `GET /health` status and endpoint body on an IP loopback address |
| `prewarm` | `codebuddy --prewarm --prewarm-id <name>` | current-user Unix socket ping, followed by one `ackMode: ready` activation |

`--ephemeral` is supported only for `serve` and adds the documented
`--no-session-persistence` flag. Non-loopback HTTP endpoints return
`status: unsupported` with `reason: non_loopback_bind` before a listener is
launched. The adapter does not invent a host bind flag.

Prewarm activation sends one NDJSON message with the documented `cwd`,
`sessionId`, `args: ["--serve", "--port", 0]`, and `ackMode: "ready"`. The
response must match the owned child PID, requested session and working
directory, and a loopback endpoint. The receipt then records
`activation_count: 1`; every later activation is refused locally.

## Status and monitoring evidence

`status` trusts neither output text nor a PID alone. It rechecks PID start and
group identity, the supervisor status receipt, executable digest, and endpoint.
It returns a structural status-line observation and documents the current
monitoring scope as OpenTelemetry traces only with content opt-in disabled.
Service log evidence contains only byte counts and SHA-256 digests; content is
not replayed, and each log is capped at 64 KiB for evidence acceptance.

The run-level `mcp/status-dashboard` remains authoritative for tasks,
verification gates, review status, iteration, and LazyBuddy checkpoints. A
service status receipt does not alter any of those fields.

## Beta checkpoint observations

`checkpoint` accepts an isolated native checkpoint observation only when its
session and scope match the service receipt. The result always states:

- file-edit-tool changes may be covered;
- Bash-created or Bash-modified files are not covered;
- manual, external, and concurrent-session edits are not covered;
- `ledger_effect` is `none`.

The canonical state file is read only to bind its SHA-256 sentinel. The adapter
never calls `scripts/state/checkpoint.sh`, `recover-run.sh`, or any canonical
state writer, so native rewind evidence cannot promote task completion.

## Result and failure contract

Success exits `0`. A live failure such as a killed worker, stale socket, changed
endpoint, output cap, second activation, or checkpoint mismatch exits `1`.
Malformed input and explicitly unsupported requests exit `2`. Missing process
inspection or a cleanup result other than `verified-absent` exits `125`.
Receipts and all derived paths must remain under the absolute, non-symlink
`--state-root`.
