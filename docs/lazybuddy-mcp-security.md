# LazyBuddy MCP Security Model

> **Historical/non-operational record.** This dated record is retained for context only. Current guidance: [README.md](../README.md), [AGENTS.md](../AGENTS.md), and [plugin README](../lazybuddy-plugin/README.md).

> v0.8 — Security boundaries, permission model, and failure isolation for MCP servers

## Core Principle: No Secrets in Tool Output

MCP tools return structured data only. They:
- Never read `.env`, `credentials.json`, or any secret-containing file
- Never include API keys, tokens, or passwords in JSON output
- Never expose file contents that aren't explicitly requested

All 30 tools operate on public state files (state.json, events.jsonl, parity-ledger.md, known-gaps.md, verification-matrix.md, context index files) and LazyCodex reference files.

## Permission Model

### Read-Only by Default

| Server | Read Tools | Write Tools |
|--------|-----------|-------------|
| run-ledger | list_runs, latest_run, read_state, summarize_run | create_run, append_event, update_task, create_checkpoint, recover_run |
| parity | read_canonical_method_map, list_methods, compare_method_status, generate_gap_report | update_parity_ledger |
| verification | discover_checks, list_gate_results, summarize_verification | run_check, record_gate_result, create_repair_task |
| source-map | index_repo, search_method_evidence, read_evidence_excerpt, list_source_paths, compute_file_hash | (none) |
| status-dashboard | show_run_status, show_task_graph, show_verification_matrix, show_parity_coverage, show_pending_approvals | (none) |

**22 read tools, 8 write tools.**

### Write Tools Require Approval

Write tools (`create_run`, `append_event`, `update_task`, `create_checkpoint`, `recover_run`, `update_parity_ledger`, `run_check`, `record_gate_result`, `create_repair_task`) require explicit user approval via WorkBuddy's permission system. The dashboard's write-back feature follows the same approval flow.

## Server Failure Isolation

All servers configured with `required: false`:

```json
{
  "mcpServers": {
    "run-ledger": { "command": "bash", "args": ["server.sh"], "required": false },
    "parity": { "command": "bash", "args": ["server.sh"], "required": false },
    "verification": { "command": "bash", "args": ["server.sh"], "required": false },
    "source-map": { "command": "bash", "args": ["server.sh"], "required": false },
    "status-dashboard": { "command": "bash", "args": ["server.sh"], "required": false }
  }
}
```

### Failure Behavior
- If any server fails to start, CodeBuddy continues without it
- Skills detect missing tools via `ToolSearch` and fall back to direct script invocation
- Status-dashboard failure: skill falls back to reading state.json directly (degraded UX)
- Parity/verification failure: skill reads parity-ledger.md and known-gaps.md as files

## PreToolUse Hook Integration

The PreToolUse hook (`pre-tool-use.sh`) complements MCP security:
- Blocks access to secret files (`.env`, `*-secret*`, etc.) — MCP tools don't touch these anyway, but the hook prevents escape
- Blocks destructive operations (`rm -rf`, `git push --force`, etc.)
- Applies the host-neutral LazyBuddy safety policy; host permission settings may add restrictions

MCP tools don't bypass PreToolUse — all tool calls go through the hook pipeline.
