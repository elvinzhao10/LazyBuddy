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
assert not list(run.glob(".transaction-journal-*"))
PY
}

PROJECT="$TMP/project"
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-commit bash "$STATE_DIR/create-run.sh" startup "startup recovery" >"$TMP/startup.out" 2>"$TMP/startup.err"; then
    echo "create-run fault unexpectedly succeeded" >&2
    exit 1
fi
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" startup >/dev/null
grep -q '"run_id": "startup"' "$PROJECT/.lazybuddy/runs/startup/state.json"

new_run "$PROJECT" empty-journal
RUN="$PROJECT/.lazybuddy/runs/empty-journal"
before="$(shasum -a 256 "$RUN/state.json" "$RUN/plan.md" "$RUN/events.jsonl" "$RUN/.revision")"
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-journal-mkdir bash "$STATE_DIR/update-plan-checkbox.sh" empty-journal T1 >/dev/null 2>&1; then
    echo "journal mkdir fault unexpectedly succeeded" >&2
    exit 1
fi
[ ! -e "$RUN/.transaction-journal" ]
[ -z "$(find "$RUN" -maxdepth 1 -name '.transaction-journal-*' -print -quit)" ]
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" empty-journal >/dev/null
after="$(shasum -a 256 "$RUN/state.json" "$RUN/plan.md" "$RUN/events.jsonl" "$RUN/.revision")"
[ "$before" = "$after" ]
[ ! -e "$RUN/.transaction-journal" ]
assert_initial "$RUN"
echo 'PASS fault=after-journal-mkdir recovery=clean state_sha256=unchanged staging=absent'

new_run "$PROJECT" unexpected-empty-journal
RUN="$PROJECT/.lazybuddy/runs/unexpected-empty-journal"
mkdir "$RUN/.transaction-journal"
printf 'unexpected\n' > "$RUN/.transaction-journal/surprise"
if CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" unexpected-empty-journal >"$TMP/unexpected-empty.out" 2>"$TMP/unexpected-empty.err"; then
    echo "unexpected journal entry did not block recovery" >&2
    exit 1
fi
[ -f "$RUN/.transaction-journal/surprise" ]
grep -q 'transaction journal manifest is corrupt' "$TMP/unexpected-empty.err"
echo 'PASS pre-manifest-journal=unexpected-entry-blocked'

new_run "$PROJECT" symlink-empty-journal
RUN="$PROJECT/.lazybuddy/runs/symlink-empty-journal"
mkdir "$RUN/journal-target"
ln -s journal-target "$RUN/.transaction-journal"
if CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" symlink-empty-journal >"$TMP/symlink-empty.out" 2>"$TMP/symlink-empty.err"; then
    echo "symlink journal did not block recovery" >&2
    exit 1
fi
[ -L "$RUN/.transaction-journal" ]
grep -q 'transaction journal is unsafe' "$TMP/symlink-empty.err"
echo 'PASS pre-manifest-journal=symlink-blocked'

new_run "$PROJECT" mkdir-prebind-removal
RUN="$PROJECT/.lazybuddy/runs/mkdir-prebind-removal"
if ! python3 - "$STATE_DIR" "$RUN" >"$TMP/mkdir-prebind-removal.out" 2>"$TMP/mkdir-prebind-removal.err" <<'PY'
import os
import sys
from pathlib import Path

state_dir, run_text = sys.argv[1:]
sys.path.insert(0, state_dir)

import state_transaction_files

legacy_create = getattr(state_transaction_files, "create_owned_directory", None)
if legacy_create is not None:
    run = Path(run_text)
    journal = run / ".transaction-journal"
    detached = run / ".detached-transaction-journal"
    replacement = run / ".attacker-controlled-journal"
    replacement.mkdir()
    real_mkdir = os.mkdir
    injected = False

    def replace_after_mkdir(path, *args, **kwargs):
        global injected
        result = real_mkdir(path, *args, **kwargs)
        if path == journal.name and kwargs.get("dir_fd") is not None and not injected:
            injected = True
            journal.rename(detached)
            replacement.rename(journal)
        return result

    state_transaction_files.os.mkdir = replace_after_mkdir
    try:
        owner = legacy_create(run, journal.name)
        try:
            state_transaction_files.write_durable(journal / "preparing", b"payload\n", owner=owner)
        finally:
            owner.close()
    finally:
        state_transaction_files.os.mkdir = real_mkdir

    assert injected
    assert not (journal / "preparing").exists(), "payload reached the attacker-controlled replacement directory"

print("PASS mkdir-to-open-prebind=removed")
PY
then
    cat "$TMP/mkdir-prebind-removal.out" "$TMP/mkdir-prebind-removal.err" >&2
    exit 1
fi
cat "$TMP/mkdir-prebind-removal.out"

new_run "$PROJECT" descriptor-relative-staging
RUN="$PROJECT/.lazybuddy/runs/descriptor-relative-staging"
if ! python3 - "$STATE_DIR" "$RUN" "$TMP" >"$TMP/descriptor-relative-staging.out" 2>"$TMP/descriptor-relative-staging.err" <<'PY'
import os
import sys
from pathlib import Path

state_dir, run_text, tmp_text = sys.argv[1:]
sys.path.insert(0, state_dir)

import state_transaction_files

run = Path(run_text)
tmp = Path(tmp_text)
real_open = os.open

positions = {
    "preparing": ".transaction-journal-preparing",
    "stage": ".transaction-journal-stage-0",
    "backup": ".transaction-journal-backup-0",
    "manifest": ".transaction-journal",
    "committed": ".transaction-journal-committed",
}

for position, stage_name in positions.items():
    for injection in ("before-create", "after-create"):
        foreign = tmp / f"foreign-{position}-{injection}"
        foreign.write_bytes(b"")
        injected = False

        def replace_stage(path, flags, *args, **kwargs):
            global injected
            if path == stage_name and kwargs.get("dir_fd") is not None and not injected:
                required = os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                assert flags & required == required, (path, flags)
                injected = True
                if injection == "before-create":
                    (run / stage_name).symlink_to(foreign)
                    return real_open(path, flags, *args, **kwargs)
                descriptor = real_open(path, flags, *args, **kwargs)
                (run / stage_name).unlink()
                (run / stage_name).symlink_to(foreign)
                return descriptor
            return real_open(path, flags, *args, **kwargs)

        owner = state_transaction_files.open_owned_directory(run)
        state_transaction_files.os.open = replace_stage
        try:
            try:
                state_transaction_files.write_durable(run / stage_name, b"payload\n", owner=owner)
            except state_transaction_files.TransactionError as error:
                assert "transaction journal is unsafe" in str(error), error
            else:
                raise AssertionError(f"{position} {injection} replacement unexpectedly accepted")
        finally:
            state_transaction_files.os.open = real_open
            owner.close()

        assert injected
        assert foreign.read_bytes() == b"", (position, injection, foreign.read_bytes())
        assert (run / stage_name).is_symlink()
        (run / stage_name).unlink()
        print(f"PASS staging-position={position} replacement={injection}-rejected foreign_payload=absent")
PY
then
    cat "$TMP/descriptor-relative-staging.out" "$TMP/descriptor-relative-staging.err" >&2
    exit 1
fi
cat "$TMP/descriptor-relative-staging.out"

new_run "$PROJECT" duplicate-target
RUN="$PROJECT/.lazybuddy/runs/duplicate-target"
printf 'old\n' > "$RUN/duplicate-target.txt"
printf 'first\n' > "$TMP/duplicate-first"
printf 'second\n' > "$TMP/duplicate-second"
duplicate_before="$(shasum -a 256 "$RUN/duplicate-target.txt" | awk '{print $1}')"
set +e
CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-install:1 python3 "$STATE_DIR/state-transaction.py" commit "$RUN" duplicate-target \
    "duplicate-target.txt|$duplicate_before|$TMP/duplicate-first" \
    "duplicate-target.txt|$duplicate_before|$TMP/duplicate-second" >"$TMP/duplicate.out" 2>"$TMP/duplicate.err"
duplicate_status=$?
set -e
if [ "$duplicate_status" -ne 1 ] || ! grep -q 'duplicate transaction target' "$TMP/duplicate.err"; then
    set +e
    duplicate_recovery="$(python3 "$STATE_DIR/state-transaction.py" recover "$RUN" 2>&1)"
    duplicate_recovery_status=$?
    set -e
    duplicate_after="$(shasum -a 256 "$RUN/duplicate-target.txt" | awk '{print $1}')"
    [ -e "$RUN/.transaction-journal" ] && duplicate_journal=present || duplicate_journal=absent
    echo "OBSERVE duplicate-target status=$duplicate_status before_sha256=$duplicate_before after_sha256=$duplicate_after journal=$duplicate_journal recovery_status=$duplicate_recovery_status recovery=$duplicate_recovery" >&2
    exit 1
fi
[ "$duplicate_before" = "$(shasum -a 256 "$RUN/duplicate-target.txt" | awk '{print $1}')" ]
[ ! -e "$RUN/.transaction-journal" ]
[ "$(python3 "$STATE_DIR/state-transaction.py" recover "$RUN")" = clean ]
echo "PASS duplicate-target=rejected-before-install state_sha256=$duplicate_before journal=absent recovery=clean"

for phase in after-stage:1 after-stage:2 after-stage:3 after-stage after-journal; do
    run_id="rollback-${phase//:/-}"
    new_run "$PROJECT" "$run_id"
    RUN="$PROJECT/.lazybuddy/runs/$run_id"
    if CWD="$PROJECT" LAZYBUDDY_TX_FAULT="$phase" bash "$STATE_DIR/update-plan-checkbox.sh" "$run_id" T1 >/dev/null 2>&1; then
        echo "fault $phase unexpectedly succeeded" >&2
        exit 1
    fi
    if [ "$phase" = after-journal ]; then
        python3 - "$RUN/.transaction-journal" <<'PY'
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

new_run "$PROJECT" legacy-journal-recovery
RUN="$PROJECT/.lazybuddy/runs/legacy-journal-recovery"
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-journal bash "$STATE_DIR/update-plan-checkbox.sh" legacy-journal-recovery T1 >/dev/null 2>&1; then
    echo "legacy journal fixture unexpectedly succeeded" >&2
    exit 1
fi
mv "$RUN/.transaction-journal" "$TMP/legacy-manifest.json"
mkdir "$RUN/.transaction-journal"
mv "$TMP/legacy-manifest.json" "$RUN/.transaction-journal/manifest.json"
for material in "$RUN"/.transaction-journal-stage-* "$RUN"/.transaction-journal-backup-*; do
    name="${material##*/.transaction-journal-}"
    mv "$material" "$RUN/.transaction-journal/$name"
done
CWD="$PROJECT" bash "$STATE_DIR/load-run.sh" legacy-journal-recovery >/dev/null
assert_initial "$RUN"
echo 'PASS legacy-directory-journal=recovery-compatible outcome=rollback'

for phase in after-commit after-install:1 after-install:2 after-install:3; do
    run_id="forward-${phase//:/-}"
    new_run "$PROJECT" "$run_id"
    RUN="$PROJECT/.lazybuddy/runs/$run_id"
    if CWD="$PROJECT" LAZYBUDDY_TX_FAULT="$phase" bash "$STATE_DIR/update-plan-checkbox.sh" "$run_id" T1 >/dev/null 2>&1; then
        echo "fault $phase unexpectedly succeeded" >&2
        exit 1
    fi
    if [ "$phase" = after-commit ]; then
        [ -f "$RUN/.transaction-journal-committed" ]
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
printf 'tampered\n' > "$PROJECT/.lazybuddy/runs/stale-journal/.transaction-journal-stage-0"
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
