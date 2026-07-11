# LazyBuddy Hooks

> Current hook inventory: each event, its script, behavior, and timeout.

## Hook Inventory

| Event | Script | Behavior | Timeout |
|-------|--------|----------|---------|
| `SessionStart` | `session-start.sh` | Detect active run, load summary, warn if workbuddy.md is missing. Read-only advisory. | 10s |
| `UserPromptSubmit` | `user-prompt-submit.sh` | Detect command intent (ultrawork, ulw-loop, ulw-plan, start-work keywords). Suggest the appropriate command for long-horizon work. Warn on pasted secrets. Advisory only. | 10s |
| `PreToolUse` | `pre-tool-use.sh` | **Enforcement.** Block secret reads, destructive deletes (`rm -rf`), force pushes, and unauthorized publishes. Return `permissionDecision: deny` for blocked operations. Matched on `Write|Edit|Bash`. | 5s |
| `PostToolUse` | `post-tool-use.sh` | Append a redacted tool-use event to `events.jsonl`. Advisory. | 10s |
| `PostToolUseFailure` | `post-tool-use-failure.sh` | Append a failure event to `events.jsonl` with retry, fallback, or blocker classification. | 10s |
| `PreCompact` | `pre-compact.sh` | Save a run checkpoint by snapshotting `state.json` to `checkpoints/`. Best-effort advisory. | 10s |
| `Stop` | `stop-gate.sh` | **Critical enforcement.** Block premature stop if an active run has unchecked work. Parse `state.json` → plan file → unchecked checkboxes. Respect `stop_hook_active` and context pressure. | 10s |
| `StopFailure` | `stop-failure.sh` | Write a failure record to `events.jsonl`; output a recovery suggestion. | 10s |
| `TaskCreated` | `task-created.sh` | Mirror WorkBuddy task creation into `events.jsonl`. | 5s |
| `TaskCompleted` | `task-completed.sh` | Mirror task completion into `events.jsonl`; update `state.json` progress. | 5s |
| `SubagentStart` | `subagent-start.sh` | Record subagent lifecycle start in `events.jsonl`. | 5s |
| `SubagentStop` | `subagent-stop.sh` | **Critical enforcement.** Verify implementer evidence: extract `EVIDENCE_RECORDED: <path>`, validate the path inside `.lazybuddy/`, and require a non-empty, non-symlink file. Maximum three retries; context pressure passes through. | 10s |

## Status Messages

All hooks use the status format `(LazyBuddy): <action>`.

## Shell Script Design

- Every hook is a standalone Bash script in `lazybuddy-plugin/scripts/hooks/`.
- Hooks receive JSON payloads on stdin and write a JSON decision or status on stdout.
- Enforcement hooks exit non-zero only for a deliberate block. Advisory hooks always exit zero.
- Hook scripts must never use network access or write outside `.lazybuddy/`.

## Context Pressure Handling

Both `stop-gate.sh` and `subagent-stop.sh` check for context-pressure markers before blocking. If a marker is found in the input payload, the hook passes through (exits 0) instead of blocking. This prevents infinite continuation loops in degraded context.

Markers: `context compacted`, `context_length_exceeded`, `skill descriptions were shortened`, `context_too_large`, and `context window exhausted`.

## Stop Hook Idempotency

The Stop hook checks `stop_hook_active` in the input payload. If true, it exits 0 (allows stop) without re-blocking. This prevents infinite continuation loops where each Stop event triggers another block.

---

*See also: [Safety Gates](lazybuddy-safety-gates.md) | [Permission Policy](lazybuddy-permission-policy.md) | [State Ledger Design](lazybuddy-state-ledger-design.md)*
