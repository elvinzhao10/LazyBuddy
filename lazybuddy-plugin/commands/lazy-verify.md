---
description: "Run LazyBuddy verification checks using verification MCP tools"
---
# /lazy-verify
> LazyBuddy v0.8 MCP command

## Usage
/lazy-verify [run_id] [--gate <gate_name>]

## What it does
Uses verification MCP tools (`discover_checks`, `run_check`, `record_gate_result`) to execute verification gates for current run.

## Success criteria
All verification gates executed; gate results recorded with pass/fail/repair status.

Do not claim completion without verification.
