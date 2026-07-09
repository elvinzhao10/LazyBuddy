# Lazyworkbuddy Safety Gates

> v0.6 — Each safety gate: triggers, logic, bypass conditions.

## Gate 1: Secret Detection Gate

**Trigger:** PreToolUse hook — `tool_name` is `Write`/`Edit`/`Bash`.

**Logic:** Check `tool_input` for secret-like file patterns (`.env`, `credentials.json`, `private.key`, `id_rsa`). Return `permissionDecision: deny`.

**Bypass:** None. Secrets are NEVER allowed to be accessed.

**LazyCodex source:** `.workbuddy/settings.json` deny rules + evidence hygiene.

## Gate 2: Destructive Action Gate

**Trigger:** PreToolUse hook — `tool_name` is `Bash` with `rm -rf`, `git push --force`, `git reset --hard`, or publish commands.

**Logic:** Block the operation. Return `permissionDecision: deny` with a reason directing the user to explicitly approve.

**Bypass:** User must explicitly confirm the operation. The hook blocks the first attempt; the user can approve on retry.

**LazyCodex source:** `ulw-plan` skill owner-decision filter (irreversible/destructive).

## Gate 3: Evidence Verification Gate

**Trigger:** SubagentStop hook — `agent_type_name` matches `lazyworkbuddy-implementer` or `implementer`.

**Logic:**
1. Extract `EVIDENCE_RECORDED: <path>` from `last_assistant_message`
2. Resolve path (relative to cwd if not absolute)
3. Validate: inside `.lazyworkbuddy/` root (`realpath` check)
4. Validate: file exists, is non-empty, is not a symlink
5. If invalid: increment attempt counter (max 3). If under max, block with retry directive
6. If valid: clear attempt state, allow

**Bypass:** After 3 failed attempts, clear state and allow (to prevent infinite loops). Context pressure also bypasses.

**LazyCodex source:** [lazycodex-executor-verify/src/codex-hook.ts](../reference/lazycodex/plugins/omo/components/lazycodex-executor-verify/src/codex-hook.ts).

## Gate 4: Premature Completion Gate

**Trigger:** Stop hook — agent attempts to stop while an active run has unchecked work.

**Logic:**
1. Check `stop_hook_active` — if true, bypass (prevents infinite loops)
2. Check context pressure markers — if found, bypass
3. Find active run in `.lazyworkbuddy/runs/` (status: `active` or `paused`)
4. Resolve plan path from state.json → read plan file → parse `## TODOs` and `## Final Verification Wave` for unchecked `- [ ]` checkboxes
5. If unchecked > 0: block with directive (plan name, remaining count, next task, continuation command)
6. If unchecked = 0: allow

**Bypass:** `stop_hook_active = true`, context pressure detected, or all checkboxes complete.

**LazyCodex source:** [start-work-continuation/src/codex-hook.ts](../reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts) + [boulder-reader.ts](../reference/lazycodex/plugins/omo/components/start-work-continuation/src/boulder-reader.ts).

## Gate 5: Context Pressure Gate

**Trigger:** Both Stop and SubagentStop hooks before any other logic.

**Logic:** Scan input payload for context pressure markers:
- `context compacted`
- `context_length_exceeded`
- `skill descriptions were shortened`
- `context_too_large`
- `codex ran out of room in the model's context window`

If any marker found → exit 0 (pass through). This prevents hooks from blocking in degraded context where the agent cannot meaningfully respond to hook directives.

**Bypass:** The entire purpose of this gate IS to bypass other gates when context is degraded.

**LazyCodex source:** [start-work-continuation/src/codex-hook.ts](../reference/lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts) lines 42-60.

## Gate Summary

| Gate | Hook | Enforces | Blocks | Exits 0 When |
|------|------|----------|--------|-------------|
| Secret Detection | PreToolUse | Never access secrets | Secret file patterns | No secrets detected |
| Destructive Action | PreToolUse | Ask before destroy | rm -rf, force push, publish | Safe operation |
| Evidence Verification | SubagentStop | Evidence must be valid | Missing/broken EVIDENCE_RECORDED | Valid evidence OR max retries OR context pressure |
| Premature Completion | Stop | Finish work before stopping | Unchecked plan checkboxes | All done OR stop_hook_active OR context pressure |
| Context Pressure | Stop + SubagentStop | Don't block in degraded context | Nothing (it's the bypass) | Always passes through |

---

_See `docs/lazyworkbuddy-hooks.md` for script details and `docs/lazyworkbuddy-hook-test-plan.md` for test procedures._
