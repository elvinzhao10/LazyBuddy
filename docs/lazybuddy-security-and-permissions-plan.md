# LazyBuddy Security and Permissions Plan

> **Historical/non-operational record.** This dated record is retained for context only. Current guidance: [README.md](../README.md), [AGENTS.md](../AGENTS.md), and [plugin README](../lazybuddy-plugin/README.md).

> v0.1 — Permission boundaries, agent scoping, hook safety, secret redaction

## Overview

LazyBuddy operates within WorkBuddy's permission model. This document defines the **additional** security boundaries we impose: what each agent can and cannot do, which hooks are safe for autonomous execution, how secrets are redacted from evidence, and where manual approval is required.

**Design principle:** Permission boundaries should be default-deny, explicit-allow. Every destructive or external action must trace to an approved workflow path.

---

## 1. Agent Permission Boundaries

### Permission Matrix

| Agent | Read Files | Write Files | Execute Commands | Spawn Subagents | External Network | Delete Files |
|-------|-----------|-------------|-----------------|------------------|------------------|-------------|
| **Orchestrator** | ✓ | ✓ (only `.lazybuddy/` and plans) | ✓ (only verification) | ✓ | ✗ | ✗ |
| **Planner** | ✓ | ✓ (only `.lazybuddy/plans/`) | ✓ (read-only analysis) | ✓ (explorer, librarian) | ✗ (research only) | ✗ |
| **Explorer** | ✓ | ✗ | ✓ (read-only) | ✗ | ✗ | ✗ |
| **Implementer** | ✓ | ✓ (scoped to task files) | ✓ (scoped to task) | ✗ | ✗ | ✗ |
| **Verifier** | ✓ | ✗ | ✓ (read-only verification) | ✗ | ✗ | ✗ |
| **Reviewer** | ✓ | ✗ | ✓ (read-only review) | ✗ | ✗ | ✗ |
| **QA Executor** | ✓ | ✗ (evidence only) | ✓ (test execution) | ✗ | ✓ (if testing web) | ✗ |
| **Gate Reviewer** | ✓ | ✗ | ✓ (read-only) | ✗ | ✗ | ✗ |
| **Librarian** | ✓ | ✓ (only `.workbuddy/`, `docs/`) | ✗ | ✗ | ✗ | ✗ |

**LazyCodex source:** Agent roles in [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) Codex Harness Tool Compatibility table and role descriptions.

### Enforcement Mechanism

WorkBuddy agent frontmatter supports `tools` (allowed) and `disallowedTools` (blocked) lists. We configure these per agent:

```yaml
# planner.md — example agent frontmatter
name: planner
description: Prometheus strategic planning agent — never writes product code
model: default        # model variant (default|lite|reasoning)
effort: high          # reasoning effort (low|medium|high|xhigh)
maxTurns: 30          # max agentic turns before stopping
tools: [Read, Grep, Glob, Bash, WebSearch, WebFetch]
disallowedTools: [Write, Edit, Bash]  # Bash restricted to read-only commands
skills: [ulw-plan]
memory: false
isolation: true  # isolated context, no parent history
```

**Agent isolation:** `isolation: true` ensures the agent does not receive parent conversation history, matching LazyCodex's `fork_context: false` pattern (traced to [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) line 20: "Use `fork_context: false` to start the child with only the initial prompt").

### Destructive Action Gate

Any action that modifies files outside the workspace, deletes files, or makes external network calls must pass through:
1. **Orchestrator review:** The orchestrator must explicitly approve the action
2. **Hook interception:** `PreToolUse` hook can block destructive actions for non-orchestrator agents
3. **User confirmation:** For external actions (API calls, deployments, PR creation), require explicit user approval

**LazyCodex source:** [ultrawork SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/ultrawork/SKILL.md) safety boundaries — "Ask one focused question only when the objective is missing, destructive, or has a safety/product ambiguity."

---

## 2. Hook Safety

### Trusted Hook Events

WorkBuddy hooks run with plugin-level permissions. All 12 hooks we use are **read-only or state-management** hooks — they never modify product code or make external calls:

| Hook Event | Action Type | Safety Rating | Rationale |
|------------|-------------|---------------|-----------|
| SessionStart | Read project rules, check bootstrap | SAFE | Read-only; status messages only |
| UserPromptSubmit | Scan for keywords; inject skill directives | SAFE | Read-only prompt injection |
| PreToolUse | Check budget; recommend tools | SAFE | Advisory only; never blocks |
| PostToolUse | Check diagnostics; match rules | SAFE | Read-only analysis |
| PostToolUseFailure | Log to state ledger | SAFE | Append-only write to `.lazybuddy/` |
| PreCompact | Reset caches; preserve state | SAFE | State management only |
| Stop | Check continuation; re-inject if needed | SAFE | State check; no product writes |
| StopFailure | Attempt recovery | SAFE | State management only |
| SubagentStop | Verify evidence; check continuation | SAFE | Read-only verification |
| TaskCreated | Append to run ledger | SAFE | Append-only write to `.lazybuddy/` |
| TaskCompleted | Update progress; append ledger | SAFE | Append-only write to `.lazybuddy/` |
| SubagentStart | Track subagent lifecycle | SAFE | Track-only |

### Hook Execution Constraints

```bash
# All hook scripts must:
# 1. Run under a hard timeout (10 seconds, matching LazyCodex)
# 2. Never modify files outside .lazybuddy/
# 3. Never make external network calls
# 4. Never read environment variables except CODEBUDDY_PLUGIN_*
# 5. Never execute arbitrary code from user input
# 6. Return clean exit codes (0 = success, 1 = warning, 2 = error)
```

**LazyCodex source:** Hook timeout of 10 seconds in [stop-checking-start-work-continuation.json](../dev/reference/lazycodex/plugins/omo/hooks/stop-checking-start-work-continuation.json) line 9: `"timeout": 10`.

### Hook Injection Safety

The `UserPromptSubmit` hook scans for keywords and injects Skill directives. To prevent injection attacks:
1. Only match against a whitelist of known keywords: `ultrawork`, `ulw-loop`, `ulw-plan`, `start-work`
2. Never inject content derived from user input — only reference fixed Skill files
3. Status messages are fixed strings, not user-controlled

---

## 3. Secret Redaction

### What Counts as a Secret

- API keys, tokens, credentials
- Auth headers, cookies, session tokens
- Environment variable dumps containing secrets
- Private keys, certificates
- PII (personally identifiable information): emails, phone numbers, addresses
- Internal URLs, IP addresses, hostnames
- Database connection strings

### Redaction in Evidence (events.jsonl)

**LazyCodex source:** [start-work SKILL.md](../dev/reference/lazycodex/plugins/omo/skills/start-work/SKILL.md) line 180: "Evidence hygiene is mandatory: redact or mask secrets and sensitive user data before writing `.omo/start-work/ledger.jsonl`."

```json
// BEFORE redaction — NEVER write this
{
  "command": "curl -H 'Authorization: Bearer sk-abc123def456' https://api.example.com",
  "env": { "DATABASE_URL": "postgresql://user:pass@host/db" }
}

// AFTER redaction — SAFE to write
{
  "command": "curl -H 'Authorization: Bearer [REDACTED: 32 chars, prefix sk-]' https://api.example.com",
  "env": { "DATABASE_URL": "[REDACTED: postgresql://user:***@host/db]" }
}
```

### Redaction Rules

| Pattern | Redaction Method | Example |
|---------|-----------------|---------|
| Bearer tokens | Replace with `[REDACTED: N chars, prefix PREFIX]` | `Bearer sk-abc123` → `Bearer [REDACTED: 13 chars, prefix sk-]` |
| API keys | Replace with `[REDACTED: N chars]` | `key=abcdefgh` → `key=[REDACTED: 8 chars]` |
| Passwords in URLs | Mask password portion | `user:pass@host` → `user:***@host` |
| Connection strings | Mask credentials | `mysql://u:p@h/db` → `mysql://u:***@h/db` |
| Private keys | Replace entire block with `[REDACTED: private key]` | — |
| Email addresses | Replace local part hash | `user@example.com` → `u***@example.com` |
| IP addresses | Mask last octet | `192.168.1.100` → `192.168.1.xxx` |

### Redaction Enforcement

1. **Pre-write check:** Librarian and orchestrator validate all evidence before writing to events.jsonl
2. **Hook-level check:** `PostToolUse` hook scans command output for common secret patterns and warns
3. **Review check:** Gate reviewer's security lane checks for secrets in evidence

---

## 4. File System Boundaries

### Read-Only Zones

These directories must NEVER be written by any agent except the Librarian:

| Directory | Write Permissions | Rationale |
|-----------|------------------|-----------|
| `reference/` | NONE (read-only clone) | LazyCodex canonical source — must not be modified |
| `.git/` | NONE (git operations only) | Repository integrity |
| `node_modules/` | NONE (package manager only) | Dependency integrity |

### Write Zones

| Directory | Who Can Write | Constraints |
|-----------|--------------|-------------|
| `.workbuddy/` | Librarian, Orchestrator | Project memory and rules only |
| `.lazybuddy/` | All agents (scoped) | Run state, plans, evidence |
| `lazybuddy-plugin/` | Implementer (v0.3+) | Plugin code only |
| `docs/` | Librarian, Planning agents | Documentation only |
| `scripts/` | Implementer | Verification scripts only |
| User workspace | Implementer (task-scoped) | Only files in plan scope |

---

## 5. External Network Access

### Allowed External Actions

| Action | Who Can Do It | Approval Required |
|--------|--------------|-------------------|
| Read web documentation | Explorer, Planner, QA Executor | No (read-only) |
| Download packages | Implementer (npm/pip) | Orchestrator approval |
| API calls (testing) | QA Executor | Orchestrator approval |
| API calls (production) | NO ONE | N/A — never allowed |
| Git push/PR | Orchestrator | User confirmation |
| Deploy to staging | Orchestrator | User confirmation |
| Deploy to production | NO ONE (unless explicitly configured) | N/A |

---

## 6. Hook Script Security

### Script Execution Environment

```bash
# All hook scripts must use:
# - Fixed command paths (no PATH resolution from user env)
# - ${CODEBUDDY_PLUGIN_ROOT} for all plugin-relative paths
# - ${CODEBUDDY_PLUGIN_DATA} for all persistent state paths
# - set -euo pipefail (strict error handling)
# - No eval(), no source from user-writable paths
# - No exec of user-supplied arguments
```

### Example Safe Hook Script

```bash
#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="${CODEBUDDY_PLUGIN_ROOT:?}"
PLUGIN_DATA="${CODEBUDDY_PLUGIN_DATA:?}"

# Only read from known paths
RULES_FILE="${PLUGIN_DATA}/../../.workbuddy/rules/lazybuddy.md"

# Fixed status message — never includes user input
echo "(LazyBuddy): Loading Project Rules"

# No external calls, no user input interpolation
if [ -f "$RULES_FILE" ]; then
    cat "$RULES_FILE"
fi

exit 0
```

---

## 7. Summary: Permission Model

```
┌──────────────────────────────────────────────────────────────┐
│                     PERMISSION LAYERS                         │
│                                                               │
│  Layer 1: Agent Frontmatter                                   │
│  ├── tools: [allowed tools]                                   │
│  ├── disallowedTools: [blocked tools]                         │
│  └── isolation: true/false                                    │
│                                                               │
│  Layer 2: Skill-Level Guards                                  │
│  ├── Planner: "I never write product code"                    │
│  ├── Orchestrator: "I never implement directly"              │
│  └── Verifier: "I run with isolated context"                 │
│                                                               │
│  Layer 3: Hook Enforcement                                    │
│  ├── PreToolUse: budget check + destructive action warning    │
│  ├── PostToolUse: secret pattern scanning                     │
│  └── PostToolUseFailure: log + alert                          │
│                                                               │
│  Layer 4: Evidence Hygiene                                    │
│  ├── Pre-write secret redaction                               │
│  ├── Post-write validation                                    │
│  └── Review lane security audit                               │
│                                                               │
│  Layer 5: User Approval Gate                                  │
│  ├── External actions require confirmation                    │
│  ├── PR/merge requires approval                               │
│  └── Deploy requires explicit opt-in                          │
└──────────────────────────────────────────────────────────────┘
```

---

_All permission boundaries trace to LazyCodex agent role descriptions and safety rules in `dev/reference/lazycodex/plugins/omo/skills/`. WorkBuddy-native enforcement mechanisms verified against [CodeBuddy docs](https://www.codebuddy.cn/docs/cli/hooks)._
