# Lazyworkbuddy Run Log Template

> Every version's work must report using exactly these 7 sections.
> Copy this template at the end of each version's implementation.

```markdown
## What I inspected

*File paths read, in this repo, in docs/, and in dev/reference/lazycodex/*

- `plan/v0.N-<description>.md` — the spec for this version
- `dev/reference/lazycodex/<path>` — LazyCodex source for method parity
- `docs/lazyworkbuddy-architecture-plan.md` — the approved architecture
- `docs/lazyworkbuddy-versioned-execution-plan.md` — per-version quality gates
- `<any other files read>`

## What I found

*Key decisions: what I learned from inspecting the source, what architectural choices I made and why*

- Decision 1: ...
- Decision 2: ...
- Decision 3: ...

## What I changed

*Every file created or modified, with a one-line summary each*

| Action | File | Summary |
|--------|------|---------|
| CREATE | `path/to/file` | What this file does |
| MODIFY | `path/to/file` | What changed and why |
| ... | ... | ... |

## How to run it

*Validation commands: how to verify the work*

```bash
# Example verification commands
python3 -m json.tool .workbuddy/settings.json  # JSON parse check
wc -l workbuddy.md                              # Line count check
grep -c "Rule" .workbuddy/rules/lazyworkbuddy.md # Rule count check
```

## Verification performed

*Each check with PASS/FAIL status and evidence*

1. **Check name:** PASS — evidence
2. **Check name:** PASS — evidence
3. **Check name:** PASS — evidence
...

## Remaining gaps

*Anything unresolved for the next version*

- Gap 1: ...
- Gap 2: ...

## Next prompt to paste

*The delegation prompt for the following version, ready to use*

```
Worker delegation prompt — v0.<N+1> <description>
...
```
```

---

_This template is binding. Every version's output must follow it exactly. See `docs/lazyworkbuddy-operating-manual.md` for the workflow that produces this report._
