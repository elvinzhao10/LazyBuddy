# LazyBuddy Hooks

> v0.6 — Hook inventory: each event, its script, behavior, LazyCodex source, timeout.

## Hook Inventory

| Event | Script | Behavior | LazyCodex Source | Timeout |
|-------|--------|----------|-----------------|---------|
| `SessionStart` | `session-start.sh` | Detect active run, load summary, warn if workbuddy.md missing. Read-only advisory. | [session-start-loading-project-rules.json](../dev/reference/lazycodex/plugins/omo/hooks/session-start-loading-project-rules.json) | 10s |
| `UserPromptSubmit` | `user-prompt-submit.sh` | Detect command intent (ultrawork, ulw-loop, ulw-plan, start-work keywords). Suggest correct command for long-horizon work. Warn on pasted secrets. Advisory only. | [user-prompt-submit-checking-ultrawork-trigger.json](../dev/reference/lazycodex/plugins/omo/hooks/user-prompt-submit-checking-ultrawork-trigger.json) | 10s |
| `PreToolUse` | `pre-tool-use.sh` | **Enforcement.** Block secret reads, destructive deletes (rm -rf), force pushes, unauthorized publishes. Return `permissionDecision: deny` for blocked operations. Matched on `Write|Edit|Bash`. | [pre-tool-use-enforcing-unlimited-goal-budget.json](../dev/reference/lazycodex/plugins/omo/hooks/pre-tool-use-enforcing-unlimited-goal-budget.json) | 5s |
| `PostToolUse` | `post-tool-use.sh` | Append tool-use event to events.jsonl (tool name, file paths, redacted). Advisory. | [post-tool-use-checking-comments.json](../dev/reference/lazycodex/plugins/omo/hooks/post-tool-use-checking-comments.json) | 10s |
| `PostToolUseFailure` | `post-tool-use-failure.sh` | Append failure event to events.jsonl with retry/fallback/blocker classification. | (LazyBuddy addition) | 10s |
| `PreCompact` | `pre-compact.sh` | Save run checkpoint (snapshot state.json to checkpoints/). Best-effort advisory. | [post-compact-resetting-*](../dev/reference/lazycodex/plugins/omo/hooks/) (merged) | 10s |
| `Stop` | `stop-gate.sh` | **Critical enforcement.** Block premature stop if active run has unchecked work. Parse state.json → plan file → unchecked checkboxes. Respect `stop_hook_active` + context pressure. | [stop-checking-start-work-continuation.json](../dev/reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json) | 10s |
| `StopFailure` | `stop-failure.sh` | Write failure record to events.jsonl; output recovery suggestion. | (LazyBuddy addition) | 10s |
| `TaskCreated` | `task-created.sh` | Mirror WorkBuddy task creation into events.jsonl. | (LazyBuddy addition) | 5s |
| `TaskCompleted` | `task-completed.sh` | Mirror task completion into events.jsonl; update state.json progress. | (LazyBuddy addition) | 5s |
| `SubagentStart` | `subagent-start.sh` | Record subagent lifecycle start in events.jsonl. | (LazyBuddy addition) | 5s |
| `SubagentStop` | `subagent-stop.sh` | **Critical enforcement.** Verify implementer evidence: extract `EVIDENCE_RECORDED: <path>`, validate path inside `.lazybuddy/`, check file exists + non-empty + not symlink. Max 3 retries. Context pressure passthrough. | [subagent-stop-verifying-lazycodex-executor-evidence.json](../dev/reference/lazycodex/plugins/omo/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json) | 10s |

## Status Messages

All hooks use the LazyCodex convention: `(LazyBuddy v0.6): <action>`.

## Shell Script Design

All hooks use `#!/usr/bin/env bash` with `set -euo pipefail`. JSON input is read from stdin via `python3 -c "import json; ..."`. This approach was chosen over:
- **Node.js/TypeScript:** would require a managed Node runtime in the hook environment
- **jq:** not guaranteed to be available; python3 is more portable
- **Perl/PHP:** less readable for JSON processing

## Context Pressure Detection

Both `stop-gate.sh` and `subagent-stop.sh` check for context pressure markers before blocking. If any marker is found in the input payload, the hook passes through (exits 0) instead of blocking. This prevents infinite continuation loops in degraded context.

Markers (from LazyCodex): `context compacted`, `context_length_exceeded`, `skill descriptions were shortened`, `context_too_large`, `codex ran out of room in the model's context window`.

**LazyCodex source:** [start-work-continuation/src/codex-hook.ts](../dev/reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts) lines 42-60.

## Stop Hook IDEMPOTENCY

The Stop hook checks `stop_hook_active` in the input payload. If true, it exits 0 (allows stop) without re-blocking. This prevents infinite continuation loops where each Stop event triggers another block.

**LazyCodex source:** [start-work-continuation/src/codex-hook.ts](../dev/reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts) line 8.

---

_See `docs/lazybuddy-permission-policy.md` for the deny/ask/allow model and `docs/lazybuddy-safety-gates.md` for safety gate details._
