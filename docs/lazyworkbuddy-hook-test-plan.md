# Lazyworkbuddy Hook Test Plan

> v0.6 — Sample payloads, expected behavior, manual test commands for each hook.

## Test Setup

All hooks read JSON from stdin. Test by piping sample payloads:

```bash
# Set plugin root for script path resolution
export CODEBUDDY_PLUGIN_ROOT=/path/to/lazyworkbuddy-plugin

# Test pattern
echo '{"field":"value"}' | bash scripts/hooks/<hook>.sh
```

For hooks that read files from `.lazyworkbuddy/`, create test state first:

```bash
mkdir -p .lazyworkbuddy/runs/test/evidence
```

## Test 1: Stop Gate — Blocks on Unchecked Work

```bash
# Setup: create test state with active run and unchecked checkboxes
mkdir -p .lazyworkbuddy/runs/test
cat > .lazyworkbuddy/runs/test/state.json << 'EOF'
{"schema_version":2,"run_id":"test","plan_reference":".lazyworkbuddy/plans/test-plan.md","plan_name":"test-plan","status":"active","session_ids":["session-abc"]}
EOF

mkdir -p .lazyworkbuddy/plans
cat > .lazyworkbuddy/plans/test-plan.md << 'EOF'
## TODOs
- [ ] Task 1: do something
- [x] Task 2: already done
- [ ] Task 3: still pending
EOF

# Test: should block
echo '{"hook_event_name":"Stop","session_id":"session-abc","turn_id":"t1","transcript_path":"/tmp/tx.txt","cwd":"'$PWD'","model":"default","permission_mode":"default","stop_hook_active":false}' | bash scripts/hooks/stop-gate.sh

# Expected: {"decision":"block","reason":"..."} with remaining count 2
```

## Test 2: Stop Gate — Allows on Complete Work

```bash
# Setup: all checkboxes done
cat > .lazyworkbuddy/plans/test-plan.md << 'EOF'
## TODOs
- [x] Task 1: done
- [x] Task 2: done
EOF

# Test: should allow (exit 0, no output)
echo '{"hook_event_name":"Stop","session_id":"session-abc","turn_id":"t1","transcript_path":"/tmp/tx.txt","cwd":"'$PWD'","model":"default","permission_mode":"default","stop_hook_active":false}' | bash scripts/hooks/stop-gate.sh

# Expected: exit 0, no block output
```

## Test 3: Stop Gate — Respects stop_hook_active

```bash
# Test: stop_hook_active=true should bypass
echo '{"hook_event_name":"Stop","session_id":"session-abc","turn_id":"t1","transcript_path":"/tmp/tx.txt","cwd":"'$PWD'","model":"default","permission_mode":"default","stop_hook_active":true}' | bash scripts/hooks/stop-gate.sh

# Expected: exit 0
```

## Test 4: SubagentStop — Blocks on Missing Evidence

```bash
# Test: implementer subagent with no EVIDENCE_RECORDED
echo '{"hook_event_name":"SubagentStop","agent_type_name":"lazyworkbuddy-implementer","agent_id":"agent-1","session_id":"sess-1","turn_id":"t1","transcript_path":"/tmp/tx.txt","cwd":"'$PWD'","model":"default","permission_mode":"default","last_assistant_message":"I wrote the code.","stop_hook_active":false}' | bash scripts/hooks/subagent-stop.sh

# Expected: {"decision":"block","reason":"No EVIDENCE_RECORDED found..."}
```

## Test 5: SubagentStop — Validates Real Evidence

```bash
# Setup: create a real evidence file
mkdir -p .lazyworkbuddy/runs/test/evidence
echo "test evidence" > .lazyworkbuddy/runs/test/evidence/qa-result.txt

# Test: should allow
echo '{"hook_event_name":"SubagentStop","agent_type_name":"lazyworkbuddy-implementer","agent_id":"agent-1","session_id":"sess-1","turn_id":"t1","transcript_path":"/tmp/tx.txt","cwd":"'$PWD'","model":"default","permission_mode":"default","last_assistant_message":"EVIDENCE_RECORDED: .lazyworkbuddy/runs/test/evidence/qa-result.txt","stop_hook_active":false}' | bash scripts/hooks/subagent-stop.sh

# Expected: exit 0
```

## Test 6: PreToolUse — Denies rm -rf

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /important/dir"}}' | bash scripts/hooks/pre-tool-use.sh

# Expected: permissionDecision: deny
```

## Test 7: PreToolUse — Denies Secret Access

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/app/.env.production","content":"SECRET=abc"}}' | bash scripts/hooks/pre-tool-use.sh

# Expected: permissionDecision: deny
```

## Test 8: UserPromptSubmit — Warns on Secrets

```bash
echo '{"user_prompt":"Use sk-abc123def456 to call the API"}' | bash scripts/hooks/user-prompt-submit.sh

# Expected: warns about pasted secret
```

## Cleanup

```bash
rm -rf .lazyworkbuddy/runs/test .lazyworkbuddy/plans/test-plan.md .lazyworkbuddy/executor-verify-state
```

---

_All tests should pass before v0.6 is considered done. Verified as part of the `lazyworkbuddy-plugin-doctor.sh` and manual test suite._
