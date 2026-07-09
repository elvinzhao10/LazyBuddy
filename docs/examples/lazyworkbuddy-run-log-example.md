# Lazyworkbuddy Run Log Example v0.7

> Walkthrough: "Build a login form" — 3 tasks, creation to completion.

## Phase 1: Create + Plan (created → planning → executing)

```bash
$ ./scripts/state/create-run.sh run-20260709-001 "Build a login form with API and tests"
Created run run-20260709-001 | Status: created | Plan: login-form.md

$ jq '.status = "executing" | .tasks = [
  {"id":"task-001","title":"Create login form component","status":"pending","depends_on":[],"changed_files":[]},
  {"id":"task-002","title":"Add login API endpoint","status":"pending","depends_on":[],"changed_files":[]},
  {"id":"task-003","title":"Add integration tests","status":"pending","depends_on":["task-001","task-002"],"changed_files":[]}
]' state.json > tmp && mv tmp state.json
```

**events.jsonl:**
```json
{"event":"run_created","ts":"12:00","run_id":"run-20260709-001"}
{"event":"plan_assigned","ts":"12:01"}
```

## Phase 2: Execute Tasks

```bash
$ ./scripts/state/update-task.sh run-20260709-001 task-001 in_progress
$ ./scripts/state/update-task.sh run-20260709-001 task-001 completed --evidence "evidence/task-001/"
task-001: completed | LoginForm.tsx | evidence: screenshot.png

$ ./scripts/state/update-task.sh run-20260709-001 task-002 in_progress
$ ./scripts/state/update-task.sh run-20260709-001 task-002 completed --evidence "evidence/task-002/"
task-002: completed | login.ts | evidence: curl-200.txt

$ ./scripts/state/update-task.sh run-20260709-001 task-003 in_progress
$ ./scripts/state/update-task.sh run-20260709-001 task-003 completed
task-003: completed | login.integration.test.ts
```

**events.jsonl (key entries):**
```json
{"event":"done_claim","ts":"12:10","cb":0,"data":{"task":"task-001"}}
{"event":"adversarial_verify","ts":"12:12","data":{"verdict":"confirmed","confidence":0.95}}
{"event":"fully_done","ts":"12:12","cb":0}
{"event":"fully_done","ts":"12:22","cb":1}
{"event":"fully_done","ts":"13:32","cb":2}
```

## Phase 3: Checkpoint

```bash
$ ./scripts/state/checkpoint.sh run-20260709-001
Checkpoint 2026-07-09T13-00-00+08:00 | progress: 66.7%
```

## Phase 4: Verify + Review + Finalize

```bash
$ jq '.status = "verifying" | .verification_gates = [
  {"name":"malformed_input","status":"passed"},{"name":"prompt_injection","status":"passed"}
]' state.json > tmp && mv tmp state.json
$ jq '.status = "complete" | .review_status = "passed"' state.json > tmp && mv tmp state.json
$ ./scripts/loop/finalize-run.sh run-20260709-001
Run finalized | Status: complete | 3/3 done | 42 iter | $1.24 | 2h 5m
```

**events.jsonl (completion):**
```json
{"event":"review_aggregate","ts":"14:05","data":{"verdict":"PASS"}}
{"event":"run_completed","ts":"14:05","data":{"duration":"2h 5m","checkboxes":3,"iterations":42}}
```

## Final state.json

```json
{ "schema_version": 2, "run_id": "run-20260709-001", "status": "complete",
  "objective": "Build a login form with API and tests",
  "progress": { "total_checkboxes": 3, "completed_checkboxes": 3 },
  "tasks": [
    { "id": "task-001", "title": "Login form", "status": "completed" },
    { "id": "task-002", "title": "Login API", "status": "completed" },
    { "id": "task-003", "title": "Integration tests", "status": "completed" }
  ],
  "verification_gates": [
    { "name": "malformed_input", "status": "passed" },
    { "name": "prompt_injection", "status": "passed" }
  ],
  "review_status": "passed",
  "iteration": { "count": 42, "max": 500, "mode": "ultrawork" },
  "last_checkpoint": "2026-07-09T13-00-00+08:00",
  "budget": { "spent": 1.24, "limit": 0 },
  "session_ids": ["session-abc123"]
}
```
