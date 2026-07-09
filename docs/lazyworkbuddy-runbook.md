# Lazyworkbuddy Runbook v0.7

> Manual operations for autonomous runs.

## Create

```bash
./scripts/state/create-run.sh <id> "<objective>"

$ ./scripts/state/create-run.sh run-20260709-001 "Build a login form"
Created run run-20260709-001 | Status: created
```

## Monitor

```bash
./scripts/state/summarize-run.sh <id>

$ ./scripts/state/summarize-run.sh run-20260709-001
Status: executing | Progress: 4/12 (33.3%) | Iter: 17/500 (ultrawork)
Last CP: 2026-07-09T13-00-00+08:00 | Session: abc123
```

## Manage Tasks

```bash
# Add task
jq '.tasks += [{"id":"task-004","title":"Error handling","status":"pending"}]' \
  state.json > tmp && mv tmp state.json

# Update status
./scripts/state/update-task.sh <run_id> <task_id> <status> [--evidence <path>]
$ ./scripts/state/update-task.sh run-20260709-001 task-001 completed --evidence "evidence/task-001/"
task-001: pending → completed | evidence: screenshot.png
```

## Checkpoint

```bash
./scripts/state/checkpoint.sh <id>

$ ./scripts/state/checkpoint.sh run-20260709-001
Checkpoint 2026-07-09T13-00-00+08-00 | progress: 58.3%
```

## Recovery

```bash
./scripts/state/recover-run.sh <id>

$ ./scripts/state/recover-run.sh run-20260709-001
Latest CP: 2026-07-09T13-00-00+08-00 | Checksum: OK
Events replayed: 12 | Resume from checkbox: 7
```

## Finalize

```bash
./scripts/loop/finalize-run.sh <id>
$ ./scripts/loop/finalize-run.sh run-20260709-001
Run finalized | Status: complete | 3/3 done | 2h 5m
```

## List

```bash
./scripts/state/list-runs.sh [--status <s>] [--mode <m>]

$ ./scripts/state/list-runs.sh
run-20260709-001  complete    12/12  2026-07-09 12:00  ultrawork
run-20260708-001  executing    3/12  2026-07-08 09:00  normal
run-20260707-001  failed       8/12  2026-07-07 14:00  ultrawork
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| State corruption (`jq: parse error`) | `./scripts/state/recover-run.sh <id>` |
| Stuck task (no progress >20 iter) | `classify-failure.sh` then `create-repair-task.sh` |
| Checkpoint checksum mismatch | Try next-newest: `recover-run.sh --checkpoint <cp>` |
| Iteration cap reached | `jq '.iteration.max = 1000' state.json` (user approved) |
| Orphan subagent | Cancel signal via events.jsonl |

### Stuck Task Diagnose + Repair

```bash
./scripts/loop/classify-failure.sh run-20260709-001 task-002
# → failure_class=timeout, action=retry_with_breakdown

./scripts/loop/create-repair-task.sh run-20260709-001 task-002 \
  --class timeout --action retry_with_breakdown
# → Created repair-task-001
```

---
_All scripts under `scripts/state/` and `scripts/loop/`. v0.7._
