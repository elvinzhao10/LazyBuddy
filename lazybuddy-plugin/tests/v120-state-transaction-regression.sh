#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$PLUGIN_ROOT/scripts/state"
LOOP_DIR="$PLUGIN_ROOT/scripts/loop"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-state-transaction.XXXXXX")"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

new_run() {
    local project="$1" run_id="$2"
    CWD="$project" bash "$STATE_DIR/create-run.sh" "$run_id" "transaction fixture" >/dev/null
    python3 - "$project/.lazybuddy/runs/$run_id" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state_path = run / "state.json"
state = json.loads(state_path.read_text())
state["plan_reference"] = f".lazybuddy/runs/{run.name}/plan.md"
state["tasks"] = [
    {"id": "T1", "title": "first task", "status": "queued", "depends_on": []},
    {"id": "T2", "title": "second task", "status": "queued", "depends_on": ["T1"]},
]
state["progress"] = {"total_checkboxes": 2, "completed_checkboxes": 0}
state_path.write_text(json.dumps(state, indent=2) + "\n")
(run / "plan.md").write_text("## TODOs\n\n- [ ] T1: first task\n- [ ] T2: second task\n")
PY
}

assert_initial() {
    python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state = json.loads((run / "state.json").read_text())
assert state["tasks"][0]["status"] == "queued", state
assert "- [ ] T1: first task" in (run / "plan.md").read_text()
assert not any(json.loads(line).get("event") == "plan_checkbox_updated" for line in (run / "events.jsonl").read_text().splitlines())
PY
}

assert_updated_once() {
    python3 - "$1" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state = json.loads((run / "state.json").read_text())
assert state["tasks"][0]["status"] == "done", state
assert "- [x] T1: first task" in (run / "plan.md").read_text()
events = [json.loads(line) for line in (run / "events.jsonl").read_text().splitlines()]
assert sum(event.get("event") == "plan_checkbox_updated" for event in events) == 1, events
assert int((run / ".revision").read_text()) == 2
assert not (run / ".transaction-journal").exists()
PY
}

PROJECT="$TMP/project"
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-commit bash "$STATE_DIR/create-run.sh" startup "startup recovery" >"$TMP/startup.out" 2>"$TMP/startup.err"; then
    echo "create-run fault unexpectedly succeeded" >&2
    exit 1
fi
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" startup >/dev/null
grep -q '"run_id": "startup"' "$PROJECT/.lazybuddy/runs/startup/state.json"

for phase in after-stage:1 after-stage:2 after-stage:3 after-stage after-journal; do
    run_id="rollback-${phase//:/-}"
    new_run "$PROJECT" "$run_id"
    RUN="$PROJECT/.lazybuddy/runs/$run_id"
    if CWD="$PROJECT" LAZYBUDDY_TX_FAULT="$phase" bash "$STATE_DIR/update-plan-checkbox.sh" "$run_id" T1 >/dev/null 2>&1; then
        echo "fault $phase unexpectedly succeeded" >&2
        exit 1
    fi
    if [ "$phase" = after-journal ]; then
        python3 - "$RUN/.transaction-journal/manifest.json" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1]))
assert manifest["revision_after"] == manifest["revision_before"] + 1
assert all(len(entry["before_sha256"]) == len(entry["after_sha256"]) == 64 for entry in manifest["entries"])
print("OBSERVE journal=uncommitted entries=%d revision=%d->%d sha256=valid" % (len(manifest["entries"]), manifest["revision_before"], manifest["revision_after"]))
PY
    fi
    CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" "$run_id" >/dev/null
    assert_initial "$RUN"
    echo "PASS fault=$phase recovery=rollback state_sha256=$(shasum -a 256 "$RUN/state.json" | awk '{print $1}')"
done

for phase in after-commit after-install:1 after-install:2 after-install:3; do
    run_id="forward-${phase//:/-}"
    new_run "$PROJECT" "$run_id"
    RUN="$PROJECT/.lazybuddy/runs/$run_id"
    if CWD="$PROJECT" LAZYBUDDY_TX_FAULT="$phase" bash "$STATE_DIR/update-plan-checkbox.sh" "$run_id" T1 >/dev/null 2>&1; then
        echo "fault $phase unexpectedly succeeded" >&2
        exit 1
    fi
    if [ "$phase" = after-commit ]; then
        [ -f "$RUN/.transaction-journal/committed" ]
        grep -q -- '- \[ \] T1: first task' "$RUN/plan.md"
        echo 'OBSERVE committed_marker=present installs=not-started'
    fi
    CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" "$run_id" >/dev/null
    assert_updated_once "$RUN"
    echo "PASS fault=$phase recovery=forward state_sha256=$(shasum -a 256 "$RUN/state.json" | awk '{print $1}') revision=$(cat "$RUN/.revision")"
done

new_run "$PROJECT" no-match
RUN="$PROJECT/.lazybuddy/runs/no-match"
before="$(shasum -a 256 "$RUN/state.json" "$RUN/plan.md" "$RUN/events.jsonl")"
if CWD="$PROJECT" bash "$STATE_DIR/update-plan-checkbox.sh" no-match absent >"$TMP/no-match.out" 2>"$TMP/no-match.err"; then
    echo "no-match update unexpectedly succeeded" >&2
    exit 1
fi
after="$(shasum -a 256 "$RUN/state.json" "$RUN/plan.md" "$RUN/events.jsonl")"
[ "$before" = "$after" ]
grep -q 'no unchecked checkbox matching' "$TMP/no-match.err"

new_run "$PROJECT" dependencies
if CWD="$PROJECT" bash "$STATE_DIR/update-task.sh" dependencies T2 done >"$TMP/deps.out" 2>"$TMP/deps.err"; then
    echo "forward dependency violation unexpectedly succeeded" >&2
    exit 1
fi
grep -q 'dependency.*T1' "$TMP/deps.err"
if CWD="$PROJECT" bash "$STATE_DIR/update-plan-checkbox.sh" dependencies T2 >"$TMP/plan-deps.out" 2>"$TMP/plan-deps.err"; then
    echo "plan forward dependency violation unexpectedly succeeded" >&2
    exit 1
fi
grep -q 'dependency.*T1' "$TMP/plan-deps.err"
echo 'PASS no-match=blocked forward-dependency=blocked'

new_run "$PROJECT" events
payload='{"event_id":"event:events:fixed","message":"same"}'
CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" events note "$payload"
CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" events note "$payload"
event_hashes="$(shasum -a 256 "$PROJECT/.lazybuddy/runs/events/events.jsonl" "$PROJECT/.lazybuddy/runs/events/canonical-events.jsonl")"
if CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" events note '{bad' >"$TMP/malformed.out" 2>"$TMP/malformed.err"; then
    echo "malformed event unexpectedly succeeded" >&2
    exit 1
fi
grep -q 'malformed event payload' "$TMP/malformed.err"
[ "$event_hashes" = "$(shasum -a 256 "$PROJECT/.lazybuddy/runs/events/events.jsonl" "$PROJECT/.lazybuddy/runs/events/canonical-events.jsonl")" ]
if CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" events note '{"event_id":"event:events:fixed","message":"conflict"}' >"$TMP/conflict.out" 2>"$TMP/conflict.err"; then
    echo "conflicting event unexpectedly succeeded" >&2
    exit 1
fi
grep -q 'event_id conflicts' "$TMP/conflict.err"
python3 - "$PROJECT/.lazybuddy/runs/events" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
for name in ("events.jsonl", "canonical-events.jsonl"):
    values = [json.loads(line) for line in (run / name).read_text().splitlines()]
    assert sum(value.get("event_id") == "event:events:fixed" for value in values) == 1, values
PY

new_run "$PROJECT" collision
set +e
CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" collision note '{"event_id":"event:collision:fixed","writer":1}' >"$TMP/p1.out" 2>"$TMP/p1.err" & p1=$!
CWD="$PROJECT" bash "$STATE_DIR/append-event.sh" collision note '{"event_id":"event:collision:fixed","writer":2}' >"$TMP/p2.out" 2>"$TMP/p2.err" & p2=$!
wait "$p1"; s1=$?
wait "$p2"; s2=$?
set -e
[ $((s1 + s2)) -ne 0 ] && { [ "$s1" -eq 0 ] || [ "$s2" -eq 0 ]; }
python3 - "$PROJECT/.lazybuddy/runs/collision" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
for name in ("events.jsonl", "canonical-events.jsonl"):
    values = [json.loads(line) for line in (run / name).read_text().splitlines()]
    assert sum(value.get("event_id") == "event:collision:fixed" for value in values) == 1, values
PY
echo "PASS collision_statuses=$s1,$s2 canonical_sha256=$(shasum -a 256 "$PROJECT/.lazybuddy/runs/collision/canonical-events.jsonl" | awk '{print $1}')"

new_run "$PROJECT" corrupt
mkdir "$PROJECT/.lazybuddy/runs/corrupt/.transaction-journal"
printf '{bad\n' > "$PROJECT/.lazybuddy/runs/corrupt/.transaction-journal/manifest.json"
python3 - "$PROJECT/.lazybuddy/runs/corrupt/state.json" <<'PY'
import json
import sys

path = sys.argv[1]
state = json.load(open(path))
state["tasks"] = []
state["verification_gates"] = []
state["review_status"] = "accepted"
json.dump(state, open(path, "w"), indent=2)
PY
if CWD="$PROJECT" bash "$LOOP_DIR/finalize-run.sh" corrupt >"$TMP/corrupt.out" 2>"$TMP/corrupt.err"; then
    echo "corrupt journal did not block completion" >&2
    exit 1
fi
grep -q 'transaction journal' "$TMP/corrupt.err"
grep -q '"status": "created"' "$PROJECT/.lazybuddy/runs/corrupt/state.json"
echo 'PASS corrupt-journal=completion-blocked'

new_run "$PROJECT" stale-journal
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-journal bash "$STATE_DIR/update-plan-checkbox.sh" stale-journal T1 >"$TMP/stale.out" 2>"$TMP/stale.err"; then
    echo "stale journal fixture unexpectedly succeeded" >&2
    exit 1
fi
printf 'tampered\n' > "$PROJECT/.lazybuddy/runs/stale-journal/.transaction-journal/stage-0"
if CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" stale-journal >"$TMP/stale-load.out" 2>"$TMP/stale-load.err"; then
    echo "tampered generated journal unexpectedly recovered" >&2
    exit 1
fi
grep -q 'staged content is inconsistent' "$TMP/stale-load.err"
assert_initial "$PROJECT/.lazybuddy/runs/stale-journal"
echo 'PASS stale-generated-journal=recovery-blocked'

new_run "$PROJECT" checkpoint
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-install:2 bash "$STATE_DIR/checkpoint.sh" checkpoint >"$TMP/checkpoint.out" 2>"$TMP/checkpoint.err"; then
    echo "checkpoint fault unexpectedly succeeded" >&2
    exit 1
fi
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" checkpoint >/dev/null
python3 - "$PROJECT/.lazybuddy/runs/checkpoint" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state = json.loads((run / "state.json").read_text())
events = [json.loads(line) for line in (run / "events.jsonl").read_text().splitlines()]
checkpoints = list((run / "checkpoints").glob("*/state.json"))
assert state["last_checkpoint"], state
assert sum(event.get("event") == "checkpoint_created" for event in events) == 1, events
assert len(checkpoints) == 1, checkpoints
checkpoint = json.loads(checkpoints[0].read_text())
assert checkpoint["last_checkpoint"] == state["last_checkpoint"]
assert checkpoints[0].with_name("plan.md").is_file()
PY
echo "PASS checkpoint-recovery state_sha256=$(shasum -a 256 "$PROJECT/.lazybuddy/runs/checkpoint/state.json" | awk '{print $1}')"
CWD="$PROJECT" bash "$STATE_DIR/update-task.sh" checkpoint T1 done >/dev/null
CWD="$PROJECT" bash "$STATE_DIR/recover-run.sh" checkpoint >/dev/null
python3 - "$PROJECT/.lazybuddy/runs/checkpoint" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state = json.loads((run / "state.json").read_text())
events = [json.loads(line) for line in (run / "events.jsonl").read_text().splitlines()]
assert state["tasks"][0]["status"] == "done", state
assert events[-1]["event"] == "recovered", events[-1]
PY
echo "PASS checkpoint-replay state_sha256=$(shasum -a 256 "$PROJECT/.lazybuddy/runs/checkpoint/state.json" | awk '{print $1}')"

new_run "$PROJECT" finalize
python3 - "$PROJECT/.lazybuddy/runs/finalize" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state_path = run / "state.json"
state = json.loads(state_path.read_text())
state["tasks"] = []
state["verification_gates"] = [{"name": "targeted", "status": "passed"}]
state["review_status"] = "accepted"
state_path.write_text(json.dumps(state, indent=2) + "\n")
(run / "plan.md").write_text("## TODOs\n\n- [x] done\n")
PY
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-install:1 bash "$LOOP_DIR/finalize-run.sh" finalize >"$TMP/finalize.out" 2>"$TMP/finalize.err"; then
    echo "finalize fault unexpectedly succeeded" >&2
    exit 1
fi
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" finalize >/dev/null
python3 - "$PROJECT/.lazybuddy/runs/finalize" <<'PY'
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
state = json.loads((run / "state.json").read_text())
events = [json.loads(line) for line in (run / "events.jsonl").read_text().splitlines()]
assert state["status"] == state["outcome"] == "complete", state
assert sum(event.get("event") == "run_completed" for event in events) == 1, events
PY
echo "PASS finalize-recovery state_sha256=$(shasum -a 256 "$PROJECT/.lazybuddy/runs/finalize/state.json" | awk '{print $1}')"

new_run "$PROJECT" lock-timeout
python3 - "$PROJECT/.lazybuddy/runs/lock-timeout/.transaction.lock" "$TMP/lock-ready" <<'PY' & lock_holder=$!
import fcntl
import os
import sys
import time

descriptor = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(descriptor, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(2)
PY
while [ ! -f "$TMP/lock-ready" ]; do
    kill -0 "$lock_holder"
done
SECONDS=0
if CWD="$PROJECT" LAZYBUDDY_TX_LOCK_TIMEOUT_SECONDS=0.2 bash "$STATE_DIR/append-event.sh" lock-timeout note '{}' >"$TMP/lock.out" 2>"$TMP/lock.err"; then
    echo "contended lock unexpectedly succeeded" >&2
    exit 1
fi
timeout_elapsed="$SECONDS"
[ "$timeout_elapsed" -lt 2 ]
grep -q 'transaction lock timed out' "$TMP/lock.err"
wait "$lock_holder"
echo "PASS lock-timeout=bounded elapsed_seconds=$timeout_elapsed"

echo 'PASS: state transaction crash recovery, idempotency, dependency, and corruption cases'
