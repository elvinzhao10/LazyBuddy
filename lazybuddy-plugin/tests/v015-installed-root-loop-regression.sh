#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-installed-loop.XXXXXX")"
PROJECT="$TMP/project"
RUN_ID="fifth-cycle"

cleanup() {
    rm -rf "$TMP"
}

trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

cp -R "$PLUGIN_ROOT" "$TMP/installed-plugin"
INSTALLED_PLUGIN="$(cd "$TMP/installed-plugin" && pwd)"
mkdir -p "$PROJECT"
printf 'caller-owned\n' > "$PROJECT/caller.txt"
if CWD="$PROJECT" LAZYBUDDY_TX_FAULT=after-stage bash "$INSTALLED_PLUGIN/scripts/state/create-run.sh" interrupted-installed 'installed interruption' >"$TMP/interrupted.out" 2>"$TMP/interrupted.err"; then
    fail 'interrupted installed create unexpectedly succeeded'
fi
INTERRUPTED_RUN="$PROJECT/.lazybuddy/runs/interrupted-installed"
if CWD="$PROJECT" bash "$INSTALLED_PLUGIN/scripts/state/recover-run.sh" interrupted-installed >"$TMP/recover.out" 2>"$TMP/recover.err"; then
    fail 'installed recovery unexpectedly succeeded without state'
fi
test ! -e "$INTERRUPTED_RUN/.transaction-journal" || fail 'installed recovery retained transaction journal'
test -z "$(find "$INTERRUPTED_RUN" -maxdepth 1 -name '.transaction-journal-*' -print -quit)" || fail 'installed recovery retained staged transaction material'
test "$(cat "$PROJECT/caller.txt")" = 'caller-owned' || fail 'installed recovery changed caller file'
CWD="$PROJECT" bash "$INSTALLED_PLUGIN/scripts/state/create-run.sh" interrupted-installed 'installed retry' >/dev/null
grep -q '"run_id": "interrupted-installed"' "$INTERRUPTED_RUN/state.json" || fail 'installed retry did not create state'

CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/state/create-run.sh" "$RUN_ID" 'installed root checkpoint test' >/dev/null

python3 - "$PROJECT/.lazybuddy/runs/$RUN_ID/state.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    state = json.load(handle)
state["iteration"]["count"] = 4
state["tasks"] = [{
    "id": "T1",
    "title": "checkpoint task",
    "description": "installed root fifth-cycle regression",
    "owner": "test",
    "status": "queued",
    "depends_on": [],
}]
with open(path, "w", encoding="utf-8") as handle:
    json.dump(state, handle)
PY

OUTPUT=$(CWD="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$INSTALLED_PLUGIN" bash "$INSTALLED_PLUGIN/scripts/loop/run-cycle.sh" "$RUN_ID")
printf '%s\n' "$OUTPUT" | grep -q '"status": "continue"' || fail 'fifth cycle did not continue'
test ! -e "$PROJECT/lazybuddy-plugin" || fail 'fixture unexpectedly has a source-tree plugin path'
CHECKPOINT=$(find "$PROJECT/.lazybuddy/runs/$RUN_ID/checkpoints" -mindepth 1 -maxdepth 1 -type d | head -n 1)
test -n "$CHECKPOINT" || fail 'fifth cycle did not create a checkpoint directory'
test -f "$CHECKPOINT/state.json" || fail 'checkpoint state snapshot missing'
python3 - "$PROJECT/.lazybuddy/runs/$RUN_ID/state.json" "$PROJECT/.lazybuddy/runs/$RUN_ID/events.jsonl" <<'PY'
import json
import sys

state_path, events_path = sys.argv[1:]
with open(state_path, encoding="utf-8") as handle:
    state = json.load(handle)
if state["iteration"]["count"] != 5 or not state.get("last_checkpoint"):
    raise SystemExit("fifth cycle did not record a checkpoint")
with open(events_path, encoding="utf-8") as handle:
    events = [json.loads(line) for line in handle if line.strip()]
if not any(event.get("event") == "checkpoint_created" for event in events):
    raise SystemExit("checkpoint event missing")
PY

echo "PASS installed-root fifth-cycle checkpoint"
