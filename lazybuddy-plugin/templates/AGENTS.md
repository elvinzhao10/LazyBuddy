# AGENTS.md — LazyBuddy Setup Guide

> **Agent:** this file is the **setup** guide. It tells you how to install and configure LazyBuddy. For *how to use* the harness once installed, see [README.md](README.md).

LazyBuddy is a WorkBuddy-native adaptation of the LazyCodex/OmO agent harness. It supports **WorkBuddy**, **CodeBuddy IDE**, and **CodeBuddy CLI**.

## Step 0 — Which platform are you on?

| Platform | Skills | Commands | Hooks | MCP servers |
|---|---|---|---|---|
| **WorkBuddy** | import bundled skills | host settings | host-managed | host settings |
| **CodeBuddy IDE** | import bundled skills | IDE slash commands | IDE hooks/settings | IDE MCP settings |
| **CodeBuddy CLI** | import bundled skills | CLI settings | CLI settings | CLI MCP settings |

- **WorkBuddy** → import the bundled skills and configure hooks/MCP through WorkBuddy settings.
- **CodeBuddy IDE** → import the bundled skills and configure the bundled MCP servers through the IDE settings.
- **CodeBuddy CLI** → configure the bundled skills and `.mcp.json` through CLI settings.

## Step A — Install

**CodeBuddy CLI:**

1. Clone this repo:
   ```bash
   git clone https://github.com/elvinzhao10/LazyBuddy.git
   ```
2. Import the `lazybuddy-plugin/skills/` bundles and configure `lazybuddy-plugin/.mcp.json` in CodeBuddy CLI settings.
3. Verify:
   ```bash
   bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS` (50 checks).

**WorkBuddy:** import the applicable `lazybuddy-plugin/skills/*/SKILL.md` bundles, then configure hooks and MCP through WorkBuddy settings.

**CodeBuddy IDE:** import the applicable `lazybuddy-plugin/skills/*/SKILL.md` bundles, then add the desired `.mcp.json` server definitions through the IDE MCP settings. CodeBuddy's CLI marketplace installer is not used by the IDE.

> Once installed into your project, the source repo can be deleted — your project retains its plugin, hooks, and generated `AGENTS.md`.

## MCP servers

CodeBuddy CLI loads the plugin's 8 MCP servers from `lazybuddy-plugin/.mcp.json`. WorkBuddy and CodeBuddy IDE configure MCP through their respective host settings.

## Verify CodeBuddy installation

```bash
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh    # health check
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh          # verification gate
bash lazybuddy-plugin/scripts/lazybuddy-smoke-test.sh      # smoke test
```

## Verify

```bash
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh    # expect: 41 PASS, 0 FAIL
```

## What gets installed

14 `lazy-` Skills, 13 Agents, 12 binding Hooks, 8 MCP servers, run-state scripts, and this `AGENTS.md` (setup guide). All skills/commands are `lazy-` prefixed.

## Reference

- How to use the harness: [README.md](README.md)
- Parity assessment: [lazybuddy-evaluation.md](lazybuddy-evaluation.md)
