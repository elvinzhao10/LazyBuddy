# AGENTS.md — LazyWorkBuddy Setup Guide

> **Agent:** this file is the **setup** guide. It tells you how to install and configure LazyWorkBuddy. For *how to use* the harness once installed, see [README.md](README.md).

LazyWorkBuddy is a WorkBuddy-native adaptation of the LazyCodex/OmO agent harness. It runs on **WorkBuddy** or via the **CodeBuddy CLI**.

## Step 0 — Which platform are you on?

| Platform | Skills | Commands | Hooks | MCP servers |
|---|---|---|---|---|
| **WorkBuddy** (app/IDE) | auto | auto | auto (binding) | **auto** (`.mcp.json`) |
| **CodeBuddy CLI** | — | via CLI | — | via CLI/config |

- **WorkBuddy** → [Step A](#step-a--install) only — MCP loads automatically (no manual setup).
- **CodeBuddy CLI** → [Step C](#step-c--codebuddy-cli).

## Step A — Install

**Option A — let WorkBuddy auto-discover (recommended):**

1. Clone this repo:
   ```bash
   git clone https://github.com/elvinzhao10/LazyWorkBuddy.git
   ```
2. Open it in **WorkBuddy** and start a session in the cloned directory.
3. Paste this prompt to the agent:
   > Install the lazyworkbuddy plugin from `lazyworkbuddy-plugin/` in this repo. Read `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` (the manifest), enable the plugin, activate all hooks and MCP servers, and create an `AGENTS.md` in this project from `lazyworkbuddy-plugin/templates/AGENTS.md`.
4. WorkBuddy loads 14 Skills, 13 Agents, 12 Hooks, 8 MCP servers, enables the plugin in `.workbuddy/settings.json`.
5. Verify:
   ```bash
   bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS` (50 checks).

**Option B — manual install:**
```bash
git clone https://github.com/elvinzhao10/LazyWorkBuddy.git
ln -s "$(pwd)/LazyWorkBuddy/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy
```
Enable in `.workbuddy/settings.json`:
```json
{ "plugin": { "lazyworkbuddy": { "enabled": true } } }
```
Restart WorkBuddy and run the doctor.

> Once installed into your project, the source repo can be deleted — your project retains its plugin, hooks, and generated `AGENTS.md`.

## MCP server — WorkBuddy: automatic

WorkBuddy loads the plugin's 8 MCP servers automatically from `lazyworkbuddy-plugin/.mcp.json` — **no manual MCP setup** (unlike the Trae Work sibling, which requires manual MCP via Settings).

## Step C — CodeBuddy CLI

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh    # health check
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh          # verification gate
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-smoke-test.sh      # smoke test
```

## Verify

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh    # expect: 50 PASS, 0 FAIL
```

## What gets installed

14 `lazy-` Skills, 13 Agents, 12 binding Hooks, 8 MCP servers, run-state scripts, and this `AGENTS.md` (setup guide). All skills/commands are `lazy-` prefixed.

## Reference

- How to use the harness: [README.md](README.md)
- Parity assessment: [lazyworkbuddy-evaluation.md](lazyworkbuddy-evaluation.md)
