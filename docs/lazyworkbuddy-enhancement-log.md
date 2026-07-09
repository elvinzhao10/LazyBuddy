# Lazyworkbuddy Enhancement Log

> Chronological log of all versioned enhancements

---

## v0.8 — MCP Servers & Dashboard (2026-07-09)

### Deliverables

| Category | Item | Count |
|----------|------|-------|
| MCP Servers | run-ledger, parity, verification, source-map, status-dashboard | **5 servers** |
| MCP Tools | create_run → show_pending_approvals | **30 tools** |
| MCP Commands | /lazyworkbuddy:status, :new-run, :resume, :verify, :parity-report | **5 commands** |
| Dashboard | dashboard.html (static mockup) | **1 mockup** |
| Docs | mcp-and-tools.md, mcp-security.md, dashboard-design.md, enhancement-log.md | **4 docs** |

### Server Details

**run-ledger (9 tools):** Wraps v0.7 state scripts — create_run, list_runs, latest_run, read_state, summarize_run, append_event, update_task, create_checkpoint, recover_run

**parity (5 tools):** Reads parity-ledger.md + known-gaps.md — read_canonical_method_map, list_methods, compare_method_status, update_parity_ledger, generate_gap_report

**verification (6 tools):** Wraps v0.7 loop scripts + verification-matrix.md — discover_checks, run_check, record_gate_result, list_gate_results, create_repair_task, summarize_verification

**source-map (5 tools):** Reads reference/lazycodex/ + .lazyworkbuddy/context/ — index_repo, search_method_evidence, read_evidence_excerpt, list_source_paths, compute_file_hash

**status-dashboard (5 tools):** Aggregates from all other servers — show_run_status, show_task_graph, show_verification_matrix, show_parity_coverage, show_pending_approvals

### Key Design Decisions
- Shell + python3 for JSON-RPC (no Node.js dependency)
- All servers required: false (graceful degradation to v0.7 script calls)
- Run-ledger uses v0.7 state scripts directly (thin wrapper)

---

## v0.7 — State Ledger & Autonomous Loop (2026-07-09)

10 state scripts, 5 loop scripts, 5 docs, skills updated with state ledger integration.

---

## v0.6 — Hooks & Safety Gates (2026-07-09)

12 lifecycle hooks (3 enforcement + 9 advisory), 4 docs, hooks.json populated.

---

## v0.5 — Subagents & Orchestration (2026-07-09)

12 agent role definitions (8 mapped + 4 native), 4 orchestration docs.

---

## v0.4 — Skills & Commands Ported (2026-07-09)

14 skills ported, 8 commands written, tool translations applied.

---

## v0.3 — Plugin Scaffold (2026-07-09)

Plugin manifest, placeholder commands/skills, hooks.json, validation scripts.

---

## v0.2 — Architecture Baseline (2026-07-09)

Parity ledger initial method map, architecture plan, 11-doc evaluation.
