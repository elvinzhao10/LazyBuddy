---
description: "Show current Lazyworkbuddy run status using status-dashboard MCP tools"
---
# /lazyworkbuddy:status
> Lazyworkbuddy v0.8 MCP command

## Usage
/lazyworkbuddy:status [run_id]

## What it does
Uses status-dashboard MCP tools (`show_run_status`, `show_task_graph`, `show_verification_matrix`)

## Success criteria
Run status displayed with task progress, verification gates, parity coverage.

Do not claim completion without verification.
