# AGENTS.md — LazyBuddy Setup Guide

> **Agent:** this file is the **setup** guide. It tells you how to install and configure LazyBuddy. For *how to use* the harness once installed, see [README.md](README.md).

LazyBuddy is a WorkBuddy-native adaptation of the LazyCodex/OmO agent harness. It supports **WorkBuddy**, **CodeBuddy IDE**, and **CodeBuddy CLI**.

## `onboard` protocol

When the user types `onboard`:

1. Read this guide and ask which installed host/version they are using: **WorkBuddy**, **CodeBuddy IDE**, or **CodeBuddy CLI**.
2. Follow only that host's setup path. Perform safe repository and CLI steps automatically.
3. Report each completed action and its observed result, including `bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh` after installation and the final verification output.
4. Stop before account, marketplace, or app-setting changes. Give exact manual directions for those steps.
5. End by explaining that the copied repository can be deleted after installation, or retained to explore and study the project.

## Step 0 — Which platform are you on?

| Platform | Skills | Commands | Hooks | MCP servers |
|---|---|---|---|---|
| **WorkBuddy** | Plugins → add marketplace → install | host-managed | host-managed | host-managed |
| **CodeBuddy IDE** | Plugins → add marketplace → install | plugin commands | plugin hooks | plugin MCP servers |
| **CodeBuddy CLI** | plugin marketplace | auto | auto | auto (`.mcp.json`) |

- **WorkBuddy** → open **Plugins**, select **+**, add the repository marketplace, then install LazyBuddy.
- **CodeBuddy IDE** → add the repository marketplace in the Plugins UI and install LazyBuddy; reload plugins if prompted.
- **CodeBuddy CLI** → install LazyBuddy through the included CodeBuddy marketplace entry.

## Step A — Install

**Option A — AI onboarding (recommended).** Open the copied repository in your chosen host and type `onboard`.

**Option B — manual CodeBuddy CLI install:**

1. Clone this repo:
   ```bash
   git clone https://github.com/elvinzhao10/LazyBuddy.git
   ```
2. Add the repository marketplace and install the plugin:
   ```bash
   codebuddy plugin marketplace add elvinzhao10/LazyBuddy --name lazybuddy
   codebuddy plugin install lazybuddy@lazybuddy --scope project
   codebuddy plugin validate lazybuddy-plugin
   ```
3. Verify:
   ```bash
   bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS` (50 checks).

**WorkBuddy:** open **Plugins** → **+** → add the repository marketplace URL → select and install **LazyBuddy**. If marketplace installation is unavailable, use **Skills** → **Add Skill** → **Upload Skill** to import packaged skills from `lazybuddy-plugin/skills/`; this fallback does not automatically install hooks or MCP servers.

**CodeBuddy IDE:** open the Plugins UI, add the same marketplace, install **LazyBuddy**, then reload plugins if prompted. Use manual skill/MCP import only when marketplace installation is unavailable.

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
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh    # expect: 50 PASS, 0 FAIL
```

## What gets installed

14 `lazy-` Skills, 13 Agents, 12 binding Hooks, 8 MCP servers, run-state scripts, and this `AGENTS.md` (setup guide). All skills/commands are `lazy-` prefixed.

## Reference

- How to use the harness: [README.md](README.md)
- Parity assessment: [lazybuddy-evaluation.md](lazybuddy-evaluation.md)
