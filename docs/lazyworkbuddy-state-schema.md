# Lazyworkbuddy State Schema v0.7

> Full JSON schema for `state.json`.

## Top-Level

| Field | Type | Values/Example |
|-------|------|----------------|
| `schema_version` | int | `2` |
| `run_id` | string | `"run-20260709-001"` |
| `status` | string | `created`, `planning`, `executing`, `verifying`, `reviewing`, `complete`, `blocked`, `failed`, `cancelled` |
| `plan_reference` | string | `".lazyworkbuddy/plans/login-form.md"` |
| `objective` | string | `"Build a login form with API and tests"` |
| `created_at` | string | ISO8601 |
| `updated_at` | string | ISO8601 |

## Progress

| Field | Type |
|-------|------|
| `progress.total_checkboxes` | int |
| `progress.completed_checkboxes` | int |
| `progress.current_checkbox_index` | int |
| `progress.completion_percentage` | float |

## Tasks[]

| Field | Type | Values |
|-------|------|--------|
| `id` | string | `"task-001"` |
| `title` | string | Short desc |
| `description` | string | Full spec |
| `owner` | string | Subagent ID |
| `status` | string | `pending`, `in_progress`, `completed`, `failed` |
| `depends_on` | string[] | Blocking task IDs |
| `changed_files` | string[] | Created/modified files |
| `evidence` | string[] | Paths to artifacts |

## Verification Gates[]

| Field | Type | Values |
|-------|------|--------|
| `name` | string | `"malformed_input"`, `"prompt_injection"`, `"stale_state"`, `"dirty_worktree"`, `"misleading_success_output"` |
| `status` | string | `pending`, `passed`, `failed` |
| `result` | string | Human-readable |

## Review

| Field | Type | Values |
|-------|------|--------|
| `review_status` | string | `pending`, `in_progress`, `passed`, `revision_requested`, `rejected` |

## Iteration

| Field | Type | Description |
|-------|------|-------------|
| `iteration.count` | int | Current count |
| `iteration.max` | int | 500 ultrawork / 100 normal |
| `iteration.mode` | string | `ultrawork`, `normal` |

## Other

| Field | Type | Description |
|-------|------|-------------|
| `last_checkpoint` | string | ISO8601 |
| `budget.spent` | float | Cost so far |
| `budget.limit` | float | 0=unlimited |
| `session_ids[]` | string | Session IDs |
| `block_reason` | string | Why blocked |

## Complete Example

```json
{ "schema_version": 2, "run_id": "run-20260709-001", "status": "verifying",
  "plan_reference": ".lazyworkbuddy/plans/login-form.md",
  "objective": "Build a login form with API and tests",
  "created_at": "2026-07-09T12:00:00+08:00",
  "updated_at": "2026-07-09T14:15:00+08:00",
  "progress": { "total_checkboxes": 3, "completed_checkboxes": 2, "completion_percentage": 66.7 },
  "tasks": [
    { "id": "task-001", "title": "Create login form component", "status": "completed", "depends_on": [], "changed_files": ["LoginForm.tsx"] },
    { "id": "task-002", "title": "Add login API endpoint", "status": "completed", "depends_on": [], "changed_files": ["login.ts"] },
    { "id": "task-003", "title": "Add integration tests", "status": "pending", "depends_on": ["task-001","task-002"], "changed_files": [] }
  ],
  "verification_gates": [
    { "name": "malformed_input", "status": "passed" },
    { "name": "prompt_injection", "status": "passed" }
  ],
  "review_status": "pending",
  "iteration": { "count": 28, "max": 500, "mode": "ultrawork" },
  "last_checkpoint": "2026-07-09T13-00-00+08:00",
  "budget": { "spent": 1.24, "limit": 0 },
  "session_ids": ["session-abc123"]
}
```

