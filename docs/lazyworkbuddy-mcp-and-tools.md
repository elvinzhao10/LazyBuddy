# Lazyworkbuddy MCP Servers & Tools

> v0.8 — MCP server inventory, transport protocol, and degradation behavior

## MCP Server Inventory

| # | Server | Tools | Wraps | Description |
|---|--------|-------|-------|-------------|
| 1 | run-ledger | 9 | v0.7 state scripts | Run lifecycle: create, list, latest, read state, summarize, append events, update tasks, checkpoints, recovery |
| 2 | parity | 5 | parity-ledger.md + known-gaps.md | Canonical method map, gap reports, parity comparison |
| 3 | verification | 6 | v0.7 loop scripts + verification-matrix.md | Gate discovery, execution, recording, repair task creation |
| 4 | source-map | 5 | reference/lazycodex/ + .lazyworkbuddy/context/ | Evidence indexing, excerpt reading, file hashing |
| 5 | status-dashboard | 5 | Aggregates all other servers | Run status, task graph, verification matrix, parity coverage, approvals |
| **Total** | **5 servers** | **30 tools** | | |

## JSON-RPC Transport

All MCP servers use JSON-RPC 2.0 over stdio:

- **Client** (CodeBuddy) sends `initialize` → **Server** responds with capabilities + tool list
- **Client** calls tools via `tools/call` with `{ name, arguments }`
- **Server** returns structured JSON with `content` array

### Shell + Python3 Design Rationale

Each server is a shell script (`server.sh`) that dispatches to Python3 functions:

```
server.sh  →  tool dispatch  →  python3 helper  →  JSON output
```

**Why shell + python3:**
- Zero Node.js/npm dependency — no package.json, no node_modules
- Portable across macOS/Linux with only bash + python3 required
- State scripts (v0.7) are already bash; servers wrap them directly
- JSON-RPC transport is a thin protocol layer over existing tools

### Graceful Degradation

All servers configured with `required: false` in `.mcp.json`:

- If a server fails to start, CodeBuddy proceeds without it
- Skills detect missing tools and fall back to direct v0.7 script calls
- Run-ledger tools use v0.7 state scripts directly (thin wrapper, not reimplementation)
- Parity tools read parity-ledger.md as a file when server is unavailable

### Tool Reference (by server)

**run-ledger:** `create_run`, `list_runs`, `latest_run`, `read_state`, `summarize_run`, `append_event`, `update_task`, `create_checkpoint`, `recover_run`

**parity:** `read_canonical_method_map`, `list_methods`, `compare_method_status`, `update_parity_ledger`, `generate_gap_report`

**verification:** `discover_checks`, `run_check`, `record_gate_result`, `list_gate_results`, `create_repair_task`, `summarize_verification`

**source-map:** `index_repo`, `search_method_evidence`, `read_evidence_excerpt`, `list_source_paths`, `compute_file_hash`

**status-dashboard:** `show_run_status`, `show_task_graph`, `show_verification_matrix`, `show_parity_coverage`, `show_pending_approvals`
