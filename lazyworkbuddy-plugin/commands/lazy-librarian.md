---
description: "Memory, index, and parity maintenance agent. Maintains the command index, parity ledger, known gaps doc, and project memory. Runs after every version change that adds or modifies components. Ensures documentation remains the source of truth."
---

# /lazy-librarian

Memory, index, and parity maintenance agent. Updates the command index, parity ledger, known gaps doc, and project memory after every accepted change. Ensures all documentation stays consistent and authoritative.

## Usage

```
/lazy-librarian [--scope=all|index|parity|gaps|memory]
```

## Inputs

- Current state of all docs in `docs/`
- Current skill, command, agent, and hook registrations in plugin manifest
- Latest parity assessment against `reference/lazycodex/`
- Version changelog for the current release

## Outputs

- Updated `docs/lazyworkbuddy-command-index.md` with status changes
- Updated `docs/lazyworkbuddy-parity-ledger.md` with new entries and status shifts
- Updated `docs/lazyworkbuddy-known-gaps.md` with new gaps or resolutions
- Updated project memory (`workbuddy.md`) if structural changes warrant

## Success Criteria

1. Command index statuses match actual implementation state
2. Parity ledger has an entry for every ported component
3. Known gaps document captures every discovered semantic deviation
4. Cross-references between docs are consistent

## Constitution

Link to command constitution: `../../docs/lazyworkbuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/lazy-librarian/SKILL.md` for the full maintenance protocol, doc consistency checks, and parity verification procedure.
