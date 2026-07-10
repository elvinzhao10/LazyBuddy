# LazyWorkBuddy — Agent Onboarding Guide

> **A practice project:** realizing [LazyCodex](https://github.com/code-yeongyu/lazycodex) (the OmO harness) on the [WorkBuddy](https://www.codebuddy.cn) platform. No longer maintained; open-sourced for learning.
>
> **Agent:** this README is your onboarding guide. Read it fully before working in this repo.

## Step 0 — Which platform are you on?

| Platform | Skills | Commands | Hooks | MCP servers |
|---|---|---|---|---|
| **WorkBuddy** (app/IDE) | auto | auto | auto (binding) | **auto** (`.mcp.json`) |
| **CodeBuddy CLI** | — | via CLI | — | via CLI/config |

- **WorkBuddy** → [Step A](#step-a--install-the-plugin) only — MCP loads automatically from the plugin manifest (no manual setup).
- **CodeBuddy CLI** → [Step C](#step-c--codebuddy-cli).

## Step A — Install the plugin

**Option A — let WorkBuddy auto-discover and install (recommended):**

1. Clone this repo anywhere:
   ```bash
   git clone https://github.com/elvinzhao10/LazyWorkBuddy.git
   ```
2. Open it in **WorkBuddy** and start a new session in the cloned directory.
3. Paste this prompt to the agent:
   > Install the lazyworkbuddy plugin from `lazyworkbuddy-plugin/` in this repo. Read `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json` (the manifest), enable the plugin, and activate all hooks and MCP servers.
4. WorkBuddy will: load 14 Skills, register 13 Agents, wire 12 Hooks, start 8 MCP servers, enable the plugin in `.workbuddy/settings.json`.
5. Verify:
   ```bash
   bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
   ```
   Expected: `Doctor check: ALL PASS` (50 checks).

**Option B — manual install (if auto-discover doesn't work):**
```bash
git clone https://github.com/elvinzhao10/LazyWorkBuddy.git
ln -s "$(pwd)/LazyWorkBuddy/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy
```
Then enable in `.workbuddy/settings.json`:
```json
{ "plugin": { "lazyworkbuddy": { "enabled": true } } }
```
Restart WorkBuddy and run the doctor.

## MCP server — WorkBuddy: automatic

WorkBuddy loads the plugin's 8 MCP servers automatically from `lazyworkbuddy-plugin/.mcp.json` — **no manual MCP setup needed** (unlike the Trae Work sibling, which requires manual MCP via Settings). If a server fails to start, the doctor will flag it.

## Step C — CodeBuddy CLI

```bash
# CLI-driven: run state, verify, parity without the WorkBuddy app
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh    # health check
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh          # verification gate
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-smoke-test.sh      # smoke test
```

## Verify

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh    # expect: 50 PASS, 0 FAIL
```

## How to use

| Command | Purpose |
|---|---|
| `/lazy-init-deep` | Generate hierarchical project memory |
| `/lazy-ulw-plan` | Decision-complete work plan |
| `/lazy-start-work` | Execute a plan with orchestrated subagents |
| `/lazy-ulw-loop` | Verified completion loop |
| `/lazy-ultrawork` | Binding high-precision mode |
| `/lazy-review-work` | 5-agent parallel review gate |
| `/lazy-verifier` `/lazy-reviewer` `/lazy-librarian` | Verify / review / update memory |

**Workflow:** `/lazy-init-deep` → `/lazy-ulw-plan` → `/lazy-start-work` → `/lazy-review-work`. Enforcement is **binding via host hooks** (Stop blocks unchecked completion, SubagentStop verifies evidence, PreToolUse blocks destructive ops) — the inverse of the LazyTrae sibling's CLI-gate strategy. See [lazyworkbuddy-evaluation.md](lazyworkbuddy-evaluation.md) (~70% structural / ~85% semantic).

## Developing on this repo (open-source)

Practice repo; contributions welcome as learning exercises. To develop:

1. **Structure:** `lazyworkbuddy-plugin/` is the plugin (skills/, commands/, agents/, hooks/, mcp/, scripts/). State lives in `.lazyworkbuddy/runs/<run_id>/`.
2. **Naming discipline:** all skills & commands are `lazy-` prefixed (e.g. `lazy-init-deep`, `lazy-status`). Keep any new ones prefixed.
3. **Test/verify:** `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh` (50 PASS expected) + `lazyworkbuddy-smoke-test.sh`. The doctor's `EXPECTED_COMMANDS`/`EXPECTED_SKILLS` lists define the required surface — update them if you add/rename.
4. **Hooks are binding:** editing hook scripts (`scripts/hooks/*.sh`) changes runtime enforcement — test with the doctor + smoke test after any change.
5. **Commit:** conventional commits, atomic, stage only files you changed, no `--no-verify`.

## Repository structure

```
lazyworkbuddy/
├── lazyworkbuddy-plugin/     # THE installable WorkBuddy plugin
│   ├── .workbuddy-plugin/    #   manifest (plugin.json)
│   ├── skills/               #   14 Skills (lazy-*)
│   ├── agents/               #   13 agent role definitions
│   ├── commands/             #   15 slash commands (lazy-*)
│   ├── hooks/                #   12 lifecycle hook scripts + hooks.json
│   ├── mcp/                  #   8 MCP servers
│   ├── scripts/              #   state/loop/verify/doctor scripts
│   └── .mcp.json             #   MCP server config (auto-loaded by WorkBuddy)
├── docs/                     # architecture docs, protocols, templates
├── plan/                     # versioned plan (v0.0 → v0.12)
├── prompts/                  # worker delegation + dogfood prompts
├── lazyworkbuddy-evaluation.md
├── README.md                 # this onboarding guide
├── LICENSE                   # MIT
└── NOTICE                    # omo/lazycodex provenance
```

## Related

- **[LazyTrae](https://github.com/elvinzhao10/Trae)** — the sibling: the same harness on the Trae IDE. Where LazyWorkBuddy bets on host hook blocking, LazyTrae moves the completion gate into a CLI/MCP layer (Trae hooks can't block).

## License

[MIT](LICENSE) — derived from lazycodex/omo, Copyright (c) 2026 Yeongyu Kim. See [NOTICE](NOTICE) for full provenance (omo is SUL-licensed at root; the lazycodex layer used as a local gitignored reference is MIT).

## Disclaimer

Practice project, not production-ready, no longer maintained. Built to study agent-harness adaptation across platforms. For production use, see the [original lazycodex/omo](https://github.com/code-yeongyu/lazycodex).

## Acknowledgments

- **[Yeongyu Kim](https://github.com/code-yeongyu)** — creator of [lazycodex/OmO](https://github.com/code-yeongyu/lazycodex), whose work made this possible
- **[WorkBuddy](https://www.codebuddy.cn)** — the platform this was built for
