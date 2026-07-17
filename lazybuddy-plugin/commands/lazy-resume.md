---
description: "Resume the latest active LazyBuddy run"
---
# /lazy-resume
> LazyBuddy v1.0.0 MCP command

## Usage
/lazy-resume [run_id]

## What it does
Resumes latest active run using run-ledger MCP (`latest_run`, `read_state`, `summarize_run`). Loads task graph, checkpoints, and re-entry context.

## Success criteria
Active run loaded with full task context and last checkpoint position.

Do not claim completion without verification.
