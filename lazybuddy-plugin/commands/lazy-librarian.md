---
description: "Memory and documentation maintenance agent. Keeps current package documentation and project memory accurate after accepted component changes."
---

# /lazy-librarian

Memory and documentation maintenance agent. Updates current package documentation and project memory after every accepted change. Ensures documentation stays consistent and authoritative.

## Usage

```
/lazy-librarian [--scope=all|index|parity|gaps|memory]
```

## Inputs

- Current state of all docs in `docs/`
- Current skill, command, agent, and hook registrations in plugin manifest
- Latest implementation evidence and package checks
- Version changelog for the current release

## Outputs

- Updated current package documentation and `docs/handoff.md` with relevant changes
- Updated project memory (`workbuddy.md`) if structural changes warrant

## Success Criteria

1. Current documentation matches actual implementation state
2. Handoff material identifies the authoritative package sources
3. Cross-references between tracked docs are consistent

## Constitution

This command is governed by its package-local skill contract below.

Do not claim completion without verification.

## Skill

See `../skills/lazy-librarian/SKILL.md` for the full maintenance protocol, doc consistency checks, and parity verification procedure.
