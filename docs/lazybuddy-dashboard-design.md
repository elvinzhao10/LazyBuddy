# LazyBuddy Dashboard Design

> v0.8 — Status dashboard layout, approval flow, fallback behavior, and v0.9 plans

## Architecture

The dashboard serves as the central observability surface for LazyBuddy runs. It aggregates data from all MCP servers (run-ledger, parity, verification, source-map) through the status-dashboard MCP server.

## Read-Only Default

The dashboard is read-only by default. All data is fetched via status-dashboard MCP tools:
- `show_run_status` — active run ID, status, objective, progress percentage
- `show_task_graph` — task table with ID, title, status, dependencies
- `show_verification_matrix` — gate results (pass/fail/pending)
- `show_parity_coverage` — matched/adapted/skipped/added counts as colored bars
- `show_pending_approvals` — items awaiting user approval

## What the Dashboard Shows

### Active Run Panel
- Run ID, status tag (created|planning|executing|blocked|verifying|reviewing|done)
- Objective text, progress bar (% complete)
- Iteration count, last checkpoint timestamp

### Task Graph Panel
- Table: task ID, title, status (done/running/pending/blocked), dependency list
- Supports nested sub-tasks and blocked-by relationships

### Verification Gates Panel
- Gate name → result (pass/fail/pending/repairing)
- Links to verification-matrix.md for detailed criteria

### Parity Coverage Panel
- Horizontal colored bars: matched (green), adapted (yellow), skipped (red), added (purple)
- Actual counts from parity-ledger.md

### Failures Panel
- List of failed tool calls, failed verifications, blocked tasks
- Links to repair tasks if created

### Next Action Panel
- Current task + description
- Changed files list (from events.jsonl)

## Write-Back Approval Flow

When the user triggers a write action from the dashboard (e.g., "retry task", "create repair task"), the dashboard:
1. Displays the proposed tool call with parameters
2. Requests user confirmation
3. Calls the appropriate MCP tool (update_task, create_repair_task, etc.)
4. Refreshes the display

All write operations go through WorkBuddy's standard permission pipeline.

## Fallback When Dashboard Unavailable

If the status-dashboard server fails:
- Skills load state.json and events.jsonl directly
- Parity data read from parity-ledger.md as a file
- Verification data read from .lazybuddy/runs/<run_id>/verification/
- Degraded UX: no unified dashboard, but all data remains accessible

## v0.9 Enhancement Plans

- **Interactive data loading:** Replace static placeholder data with live MCP tool calls
- **WebSocket push:** Real-time updates when state changes (instead of manual refresh)
- **Write-back actions:** Execute retry, repair, approve directly from dashboard
- **History view:** Browse past runs with filtering and search
- **Agent activity log:** Live feed of agent actions from events.jsonl
