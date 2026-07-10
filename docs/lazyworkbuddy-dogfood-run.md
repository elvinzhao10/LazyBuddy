# Lazyworkbuddy Dogfood Replay — v0.12

> Date: 2026-07-09
> Run ID: `dogfood-v0.12`
> Result: PASS — non-trivial replay completed with checkpoint, missing-evidence block, repair cycle, sync repair, stop-gate proof, final review/debugging notes, finalization, and doctor pass.

## Replay Objective

Use existing Lazyworkbuddy state, loop, and hook scripts to prove a v0.12 run lifecycle that is harder than the earlier one-task v0.11 dogfood. The replay intentionally creates a missing-evidence failure, repairs it, syncs plan/state drift, and finishes only after review and verification gates are present.

## Named Tasks

The durable plan is `.lazyworkbuddy/runs/dogfood-v0.12/plan.md`.

| Task | Name | Evidence |
| --- | --- | --- |
| `T1` | Establish plan/state sync baseline | `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T1-plan-state-sync.txt` |
| `T2` | Capture checkpoint and missing-evidence block | `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T2-checkpoint-missing-evidence.txt` |
| `T3` | Repair evidence failure and resolve drift | `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt` |
| `T4` | Final verifier review and debugging audit | `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T4-final-review-debugging.txt` |
| `RF4851` | Retry: Capture checkpoint and missing-evidence block | `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt` |

## Exact Commands

```bash
bash lazyworkbuddy-plugin/scripts/state/create-run.sh dogfood-v0.12 "Dogfood Lazyworkbuddy v0.12 replay with checkpoint, missing-evidence gate, repair cycle, stop-gate proof, and final review/debugging evidence"
bash lazyworkbuddy-plugin/scripts/loop/next-task.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/state/update-task.sh dogfood-v0.12 T1 done 'evidence=[".lazyworkbuddy/runs/dogfood-v0.12/evidence/T1-plan-state-sync.txt"]'
bash lazyworkbuddy-plugin/scripts/state/update-plan-checkbox.sh dogfood-v0.12 T1
bash lazyworkbuddy-plugin/scripts/loop/next-task.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/state/checkpoint.sh dogfood-v0.12
printf '%s\n' '{"cwd":"/Users/Admin/Desktop/lazyworkbuddy","stop_hook_active":false}' | bash lazyworkbuddy-plugin/scripts/hooks/stop-gate.sh
printf '%s\n' '{"agent_type":"lazyworkbuddy-implementer","last_assistant_message":"DONE without evidence marker","cwd":"/Users/Admin/Desktop/lazyworkbuddy","session_id":"fixture-dogfood-v0.12","agent_id":"missing-evidence"}' | bash lazyworkbuddy-plugin/scripts/hooks/subagent-stop.sh
bash lazyworkbuddy-plugin/scripts/state/update-task.sh dogfood-v0.12 T2 done 'evidence=[".lazyworkbuddy/runs/dogfood-v0.12/evidence/T2-checkpoint-missing-evidence.txt"]'
bash lazyworkbuddy-plugin/scripts/state/update-plan-checkbox.sh dogfood-v0.12 T2
bash lazyworkbuddy-plugin/scripts/loop/next-task.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/loop/create-repair-task.sh dogfood-v0.12 T2 retry
printf '%s\n' '{"agent_type":"lazyworkbuddy-implementer","last_assistant_message":"DONE\nEVIDENCE_RECORDED: .lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt","cwd":"/Users/Admin/Desktop/lazyworkbuddy","session_id":"fixture-dogfood-v0.12","agent_id":"missing-evidence"}' | bash lazyworkbuddy-plugin/scripts/hooks/subagent-stop.sh
bash lazyworkbuddy-plugin/scripts/state/update-task.sh dogfood-v0.12 RF4851 done 'evidence=[".lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt"]'
bash lazyworkbuddy-plugin/scripts/state/append-event.sh dogfood-v0.12 evidence_failure_repaired '{"failed_task_id":"T2","repair_task_id":"RF4851","resolution":"SubagentStop accepted a non-empty EVIDENCE_RECORDED artifact under .lazyworkbuddy"}'
test ! -f .lazyworkbuddy/executor-verify-state/fixture-dogfood-v0.12-missing-evidence.json
bash lazyworkbuddy-plugin/scripts/state/update-task.sh dogfood-v0.12 T3 done 'evidence=[".lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt"]'
bash lazyworkbuddy-plugin/scripts/state/update-plan-checkbox.sh dogfood-v0.12 T3
bash lazyworkbuddy-plugin/scripts/loop/next-task.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/state/update-task.sh dogfood-v0.12 T4 done 'evidence=[".lazyworkbuddy/runs/dogfood-v0.12/evidence/T4-final-review-debugging.txt",".lazyworkbuddy/runs/dogfood-v0.12/review/verdict.md",".lazyworkbuddy/runs/dogfood-v0.12/artifacts/debugging-audit.md",".lazyworkbuddy/runs/dogfood-v0.12/verification/results.json"]'
bash lazyworkbuddy-plugin/scripts/state/update-plan-checkbox.sh dogfood-v0.12 T4
bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12 --fix
bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12
bash lazyworkbuddy-plugin/scripts/loop/finalize-run.sh dogfood-v0.12
printf '%s\n' '{"cwd":"/Users/Admin/Desktop/lazyworkbuddy","stop_hook_active":false}' | bash lazyworkbuddy-plugin/scripts/hooks/stop-gate.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
```

Full replay transcript:

- `.lazyworkbuddy/runs/dogfood-v0.12/evidence/final-gates.txt`
- `.omo/evidence/task-5-diagnosis-v0-12-lazyworkbuddy.txt`

## Checkpoint

Checkpoint command:

```bash
bash lazyworkbuddy-plugin/scripts/state/checkpoint.sh dogfood-v0.12
```

Checkpoint artifact:

- `.lazyworkbuddy/runs/dogfood-v0.12/checkpoints/20260709T151618Z/state.json`
- `.lazyworkbuddy/runs/dogfood-v0.12/checkpoints/20260709T151618Z/plan.md`

The durable event appears in `.lazyworkbuddy/runs/dogfood-v0.12/events.jsonl` as `checkpoint_created`.

## Blocked Failure and Repair Cycle

Deliberate failure:

```bash
printf '%s\n' '{"agent_type":"lazyworkbuddy-implementer","last_assistant_message":"DONE without evidence marker","cwd":"/Users/Admin/Desktop/lazyworkbuddy","session_id":"fixture-dogfood-v0.12","agent_id":"missing-evidence"}' | bash lazyworkbuddy-plugin/scripts/hooks/subagent-stop.sh
```

Observed output in `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T2-checkpoint-missing-evidence.txt`:

```json
{"continue": false, "reason": "No EVIDENCE_RECORDED found in implementer output. Please record evidence path before completing. (attempt 1/3)"}
```

The hook exited `0`, which is the expected WorkBuddy hook contract.

Repair:

```bash
bash lazyworkbuddy-plugin/scripts/loop/create-repair-task.sh dogfood-v0.12 T2 retry
printf '%s\n' '{"agent_type":"lazyworkbuddy-implementer","last_assistant_message":"DONE\nEVIDENCE_RECORDED: .lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt","cwd":"/Users/Admin/Desktop/lazyworkbuddy","session_id":"fixture-dogfood-v0.12","agent_id":"missing-evidence"}' | bash lazyworkbuddy-plugin/scripts/hooks/subagent-stop.sh
bash lazyworkbuddy-plugin/scripts/state/append-event.sh dogfood-v0.12 evidence_failure_repaired '{"failed_task_id":"T2","repair_task_id":"RF4851","resolution":"SubagentStop accepted a non-empty EVIDENCE_RECORDED artifact under .lazyworkbuddy"}'
```

Repair artifacts:

- `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T3-repair-sync-resolution.txt`
- `.lazyworkbuddy/runs/dogfood-v0.12/events.jsonl` (`repair_task_created` and `evidence_failure_repaired`)

## Stop Gate

Before completion, stop gate blocked because three checkboxes were still open:

```bash
printf '%s\n' '{"cwd":"/Users/Admin/Desktop/lazyworkbuddy","stop_hook_active":false}' | bash lazyworkbuddy-plugin/scripts/hooks/stop-gate.sh
```

Observed output:

```json
{"continue": false, "reason": "Lazyworkbuddy has 3 unfinished task(s) in plan `plan`. Next: T2: Capture checkpoint and missing-evidence block\n\nRun /start-work plan to continue. Stay in this session ..."}
```

After all checkboxes were complete and after finalization, the same command produced empty stdout with exit code `0`, recorded in `.lazyworkbuddy/runs/dogfood-v0.12/evidence/final-gates.txt`.

## Plan/State Sync

Required sync command:

```bash
bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12 --fix
```

Observed: one progress-counter drift was repaired.

Required dry-run:

```bash
bash lazyworkbuddy-plugin/scripts/state/sync-plan-state.sh dogfood-v0.12
```

Observed:

```text
NO DRIFT — plan and state are in sync.
```

## Final Verifier, Review, and Debugging Notes

Artifacts:

- `.lazyworkbuddy/runs/dogfood-v0.12/review/verdict.md`
- `.lazyworkbuddy/runs/dogfood-v0.12/artifacts/debugging-audit.md`
- `.lazyworkbuddy/runs/dogfood-v0.12/verification/results.json`
- `.lazyworkbuddy/runs/dogfood-v0.12/evidence/T4-final-review-debugging.txt`

Review verdict: `ACCEPT`.

Debugging hypotheses recorded:

- SubagentStop might silently allow missing evidence because it exits 0; refuted by JSON `"continue": false`.
- Plan/state drift might survive checkbox updates; controlled by `sync-plan-state.sh --fix` followed by `NO DRIFT`.
- Stop gate might allow premature completion; refuted by the pre-completion block and post-completion allow checks.
- Doctor might miss completed tasks with missing evidence; controlled by final doctor pass over completed `dogfood-v0.12` tasks.

## Final State

Finalization command:

```bash
bash lazyworkbuddy-plugin/scripts/loop/finalize-run.sh dogfood-v0.12
```

Observed:

```text
RUN COMPLETE: dogfood-v0.12
```

Doctor command:

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
```

Observed:

```text
Doctor check: ALL PASS
```
