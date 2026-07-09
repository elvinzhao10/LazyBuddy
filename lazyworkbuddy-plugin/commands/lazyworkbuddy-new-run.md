---
description: "Create a new Lazyworkbuddy run using run-ledger MCP tools"
---
# /lazyworkbuddy:new-run
> Lazyworkbuddy v0.8 MCP command

## Usage
/lazyworkbuddy:new-run <objective> [--plan <plan_file>]

## What it does
Creates a new run with run-ledger MCP (`create_run`) and initializes state.json + events.jsonl + plan.md.

## Success criteria
New run created with unique run_id, initialized state, and populated plan.md.

Do not claim completion without verification.
