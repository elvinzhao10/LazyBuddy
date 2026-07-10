# LazyBuddy Permission Policy

> v0.6 — Deny/Ask/Allow rules, PreToolUse enforcement, and host-neutral LazyBuddy policy.

## Permission Model

LazyBuddy uses a 5-layer permission model:

| Layer | Mechanism | Scope | Enforces |
|-------|-----------|-------|----------|
| 1. Agent Frontmatter | `tools` / `disallowedTools` in YAML | Per-agent | Tool access (verifier=read-only, implementer=cannot spawn) |
| 2. Skill-Level Guards | System prompts in SKILL.md | Per-skill | "Never write product code", "Never implement directly" |
| 3. Hook Enforcement | `PreToolUse` hook | All tool calls | Secret access denial, destructive op blocking |
| 4. LazyBuddy Policy | documented host permission settings + this policy | Host/project level | Deny/ask/allow intent where the host supports it |
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

These implement LazyBuddy's host-neutral secret policy (API keys, tokens, private keys, connection strings, env vars, emails). Host permission settings may add protections but are not assumed by this package.

## Ask Rules

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

## Host Policy and Hook Relationship

| What | Host permission settings | LazyBuddy hooks |
|------|-------------|-------|
| Secret patterns (regex) | ✅ Pattern-based deny | ✅ Path-based deny in PreToolUse |
| Destructive ops | ✅ Pattern-based ask | ✅ Tool+input based deny in PreToolUse |
| Run state tracking | — | ✅ PostToolUse appends to events.jsonl |
| Continuation enforcement | — | ✅ Stop gate blocks premature stop |
| Evidence verification | — | ✅ SubagentStop validates EVIDENCE_RECORDED |
| Lifecycle tracking | — | ✅ Task/Subagent events to events.jsonl |

Host permission settings may provide additional policy declarations; LazyBuddy hooks provide the package's runtime enforcement when the host loads them.

## Secret Redaction (ALL hooks)

Any hook that writes to `events.jsonl` or any log **MUST** redact secrets before writing:

- API keys (sk-*, AIza*, ghp_*, etc.) → `[REDACTED: N chars]`
- Bearer tokens → `[REDACTED: N chars, prefix Bearer]`
- Private keys → `[REDACTED: private key]`
- Passwords in URLs → `[REDACTED: password]`
- Email addresses → `[REDACTED: email]`

Format: `[REDACTED: N chars, prefix PREFIX]` — matching LazyCodex evidence hygiene rules.

---

_See `docs/lazybuddy-safety-gates.md` for each gate's logic and `docs/lazybuddy-hooks.md` for the full hook inventory._
