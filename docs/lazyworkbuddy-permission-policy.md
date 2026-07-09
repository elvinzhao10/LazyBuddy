# Lazyworkbuddy Permission Policy

> v0.6 — Deny/Ask/Allow rules, PreToolUse enforcement, hook-settings complement.

## Permission Model

Lazyworkbuddy uses a 5-layer permission model:

| Layer | Mechanism | Scope | Enforces |
|-------|-----------|-------|----------|
| 1. Agent Frontmatter | `tools` / `disallowedTools` in YAML | Per-agent | Tool access (verifier=read-only, implementer=cannot spawn) |
| 2. Skill-Level Guards | System prompts in SKILL.md | Per-skill | "Never write product code", "Never implement directly" |
| 3. Hook Enforcement | `PreToolUse` hook | All tool calls | Secret access denial, destructive op blocking |
| 4. Settings Policy | `.workbuddy/settings.json` | Project-level | Deny/ask/allow pattern rules |
| 5. User Approval Gate | Explicit confirmation | External actions | PR/merge/deploy require user approval |

## Deny Rules (PreToolUse)

The `PreToolUse` hook blocks these operations unconditionally:

| Pattern | Rationale |
|---------|-----------|
| Secret file access (`.env`, `credentials.json`, `private.key`, `id_rsa`) | Prevent credential exposure |
| `rm -rf` on root/home paths | Prevent catastrophic deletion |
| `git push --force` / `git reset --hard` | Prevent history destruction |
| `npm publish` / `pip upload` / `docker push` | Prevent unauthorized publishes |
| Unapproved network writes | Prevent data exfiltration |

These complement `.workbuddy/settings.json` deny patterns (API keys, tokens, private keys, connection strings, env vars, emails).

## Ask Rules (settings.json)

Operations that require explicit user confirmation:

| Pattern | Rationale |
|---------|-----------|
| Recursive deletion (`rm -rf`) | Irreversible data loss |
| Destructive git ops | History rewrite |
| Recursive permission changes (`chmod -R`) | Security impact |
| `DROP TABLE/DATABASE/COLLECTION` | Data destruction |
| Package publishing (`npm publish`) | External side effects |
| Deployment to production/staging | Production impact |

## How PreToolUse Enforces Rules

1. Read payload from stdin (`tool_name`, `tool_input`)
2. Check against DENY patterns → return `permissionDecision: deny` with reason
3. Check against ASK patterns → return `permissionDecision: ask` (WorkBuddy prompts user)
4. Otherwise → exit 0 (allow)

The hook uses `hookSpecificOutput` with `permissionDecision` per WorkBuddy's PreToolUse contract.

## Hook-Settings Complement

| What | Settings.json | Hooks |
|------|-------------|-------|
| Secret patterns (regex) | ✅ Pattern-based deny | ✅ Path-based deny in PreToolUse |
| Destructive ops | ✅ Pattern-based ask | ✅ Tool+input based deny in PreToolUse |
| Run state tracking | — | ✅ PostToolUse appends to events.jsonl |
| Continuation enforcement | — | ✅ Stop gate blocks premature stop |
| Evidence verification | — | ✅ SubagentStop validates EVIDENCE_RECORDED |
| Lifecycle tracking | — | ✅ Task/Subagent events to events.jsonl |

Settings.json provides the policy declaration; hooks provide the runtime enforcement.

## Secret Redaction (ALL hooks)

Any hook that writes to `events.jsonl` or any log **MUST** redact secrets before writing:

- API keys (sk-*, AIza*, ghp_*, etc.) → `[REDACTED: N chars]`
- Bearer tokens → `[REDACTED: N chars, prefix Bearer]`
- Private keys → `[REDACTED: private key]`
- Passwords in URLs → `[REDACTED: password]`
- Email addresses → `[REDACTED: email]`

Format: `[REDACTED: N chars, prefix PREFIX]` — matching LazyCodex evidence hygiene rules.

---

_See `docs/lazyworkbuddy-safety-gates.md` for each gate's logic and `docs/lazyworkbuddy-hooks.md` for the full hook inventory._
