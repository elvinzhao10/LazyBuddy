---
description: "Cross-platform migration workflow planner. Generalizes the LazyCodex-to-WorkBuddy adaptation methodology into a reusable framework. Analyzes source platform components, maps them to target platform equivalents, and produces a migration plan with risk assessment."
---

# /migration-planner

Cross-platform migration workflow planner. Analyzes source platform components, maps them to target platform equivalents, identifies gaps and risks, and produces a structured migration plan. Generalizes the adaptation methodology used in this project.

## Usage

```
/migration-planner --source=<platform> --target=<platform> [--components=skills,hooks,agents,mcp]
```

## Inputs

- Source platform documentation and component definitions
- Target platform capabilities and constraints
- Component inventory (skills, commands, agents, hooks, MCP servers)
- Known platform differences (tool mapping, API surface, capability model)

## Outputs

- Migration plan with component-by-component mapping
- Risk assessment per component (HIGH/MEDIUM/LOW)
- Semantic deviation log (where 1:1 mapping is impossible)
- Effort estimate and phased delivery schedule

## Success Criteria

1. Every source component has a mapped target equivalent or documented skip reason
2. Risk assessment is honest (no LOW risk where semantics differ)
3. Semantic deviations are documented with mitigation strategies
4. Plan is self-contained (no external knowledge assumed)

## Constitution

Link to command constitution: `../../docs/lazyworkbuddy-command-constitution.md`

Do not claim completion without verification.

## Skill

See `../skills/migration-planner/SKILL.md` for the full migration methodology, platform analysis framework, risk matrix, and adaptation patterns.
