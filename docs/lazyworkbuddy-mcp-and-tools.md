# Lazyworkbuddy MCP Servers & Tools

> v0.12 — MCP server inventory, capability taxonomy, transport protocol, and degradation behavior.
> Runtime surface source: `lazyworkbuddy-plugin/.mcp.json`.

## Capability Taxonomy

| Label | Meaning |
|---|---|
| `semantic` | Uses a structured source of truth or parsed project artifact where the result is not primarily grep/string matching. |
| `project-tool-backed` | Runs real project or plugin scripts/checkers and reports their results. |
| `heuristic` | Uses grep, regex, registry metadata, or best-effort parsing; useful but not full semantic parity with LazyCodex codegraph/LSP/context services. |
| `state-only` | Reads or mutates Lazyworkbuddy state/docs only; it does not inspect runtime code semantics. |

Runtime status labels used below:

- `runtime-verified`: exercised by `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` and recorded in `.omo/evidence/task-4-diagnosis-v0-12-lazyworkbuddy.txt`.
- `implemented-unverified`: code/docs exist but no runtime transcript is cited here.
- `heuristic-substitute`: intentionally approximates a LazyCodex capability and must not be described as full LazyCodex parity.

## MCP Server Inventory

| # | Server | Tools | Capability Label | Parity Class | Evidence / Status | Description |
|---|--------|-------|------------------|--------------|-------------------|-------------|
| 1 | `run-ledger` | 9 | `project-tool-backed`, `state-only` | `native-enhancement` | `runtime-verified`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Wraps state scripts for run lifecycle: create, list, latest, read state, summarize, append events, update tasks, checkpoints, recovery. |
| 2 | `parity` | 5 | `state-only` | `native-enhancement` | `runtime-verified`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Reads and updates `docs/lazyworkbuddy-parity-ledger.md` and `docs/lazyworkbuddy-known-gaps.md`; no LazyCodex runtime equivalent. |
| 3 | `verification` | 6 | `project-tool-backed`, `state-only` | `native-enhancement` | `runtime-verified`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Wraps loop/verification scripts and verification docs for gate discovery, recording, repair tasks, and summaries. |
| 4 | `source-map` | 5 | `heuristic` | `native-enhancement` | `runtime-verified`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Searches `dev/reference/lazycodex/` and `docs/`, reads excerpts, lists paths, and hashes files; grep/file-index based, not a semantic code index. |
| 5 | `status-dashboard` | 5 | `state-only` | `native-enhancement` | `runtime-verified`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Aggregates run state, task graph, verification matrix, parity coverage, and pending approvals. |
| 6 | `context-graph` | 5 | `heuristic` | `host-substitution` for LazyCodex `codegraph` | `runtime-verified`, `heuristic-substitute`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Provides blast radius, file dependency, symbol search/reference, and repo overview by grep/regex. It is not a full call graph or semantic codegraph. |
| 7 | `code-intel` | 5 | `project-tool-backed`, `heuristic` | `host-substitution` for LazyCodex `lsp` | `runtime-verified`, `heuristic-substitute`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | `diagnostics`/`typecheck` run real project tools when present; symbol/reference/goto tools are grep heuristics, not a language server or rename engine. |
| 8 | `docs` | 2 | `heuristic` | `host-substitution` for LazyCodex `context7` | `runtime-verified`, `heuristic-substitute`: `bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh` | Fetches npm/PyPI README/description metadata with optional section extraction. It is not Context7's curated docs service. |
| **Total** | **8 servers** | **42 tools** | | | | |

## LazyCodex MCP Parity Classes

| LazyCodex Capability | Lazyworkbuddy Status | Current Label | Notes |
|---|---|---|---|
| `codegraph` | `context-graph` | `host-substitution`, `heuristic-substitute` | Useful for blast-radius and symbol scans, but not full codegraph parity. |
| `lsp` | `code-intel` | `host-substitution`, `project-tool-backed` + `heuristic-substitute` | Diagnostics can be project-tool-backed; navigation is heuristic. No semantic rename/goto-def parity. |
| `context7` | `docs` | `host-substitution`, `heuristic-substitute` | Registry README fetcher, not a curated docs context service. |
| `git_bash` | WorkBuddy native Bash/Git | `platform-gap` closed by host capability | No MCP server built because the host shell already covers the Windows-only LazyCodex need. |
| `grep_app` | WorkBuddy native Grep/WebSearch | `platform-gap` closed by host capability | No MCP server built because host search tools cover local/web search workflows. |
| Run ledger, parity, verification, source-map, status-dashboard | Lazyworkbuddy additions | `native-enhancement` | These improve WorkBuddy-native operation and are not reference parity claims. |

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

| Server | Important Tools | Tool Labels |
|---|---|---|
| `run-ledger` | `create_run`, `list_runs`, `latest_run`, `read_state`, `summarize_run`, `append_event`, `update_task`, `create_checkpoint`, `recover_run` | `project-tool-backed`, `state-only` |
| `parity` | `read_canonical_method_map`, `list_methods`, `compare_method_status`, `update_parity_ledger`, `generate_gap_report` | `state-only` |
| `verification` | `discover_checks`, `run_check`, `record_gate_result`, `list_gate_results`, `create_repair_task`, `summarize_verification` | `project-tool-backed`, `state-only` |
| `source-map` | `index_repo`, `search_method_evidence`, `read_evidence_excerpt`, `list_source_paths`, `compute_file_hash` | `heuristic` for search/indexing; file hashing/excerpts are direct file reads. |
| `status-dashboard` | `show_run_status`, `show_task_graph`, `show_verification_matrix`, `show_parity_coverage`, `show_pending_approvals` | `state-only` |
| `context-graph` | `blast_radius`, `file_deps`, `symbol_search`, `symbol_refs`, `repo_overview` | `heuristic-substitute`; grep/regex approximation, not semantic codegraph. |
| `code-intel` | `diagnostics`, `typecheck`, `find_references`, `goto_definition`, `symbols` | `project-tool-backed` for diagnostics/typecheck when a checker exists; `heuristic-substitute` for symbols/references/goto. |
| `docs` | `get_library_docs`, `list_supported_registries` | `heuristic-substitute`; npm/PyPI registry README fetch, not curated Context7. |
