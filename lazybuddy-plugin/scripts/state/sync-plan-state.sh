#!/usr/bin/env bash
# sync-plan-state.sh — Reconcile plan checkboxes with state.json tasks/progress (G-017 fix).
# Usage: sync-plan-state.sh <run_id> [--fix]
#
# G-017: plan.md checkboxes and state.json tasks[]/progress{} are two representations
# that can diverge (e.g. a checkbox is flipped but update-task.sh wasn't called, or
# progress counters drift). This script detects drift and, with --fix, reconciles:
#   - progress.total_checkboxes / completed_checkboxes recomputed from the plan
#   - task.status synced to match checkbox state (checked -> done, unchecked -> pending)
#   - plan-only tasks (in plan but not in tasks[]) reported (not auto-created)
#
# Without --fix: prints a drift report and exits 0 (no writes).
set -euo pipefail

RUN_ID="${1:-}"
FIX="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/state-paths.sh"

if ! state_require_safe_run_id "$RUN_ID"; then
    exit 1
fi

CWD="${CWD:-.}"
state_require_run_dir "$CWD" "$RUN_ID" || exit 1
STATE_FILE="$STATE_RUN_DIR/state.json"
EVENTS_FILE="$STATE_RUN_DIR/events.jsonl"
state_require_existing_run_file "$STATE_FILE" "state.json" || exit 1
state_require_safe_run_file "$EVENTS_FILE" "events.jsonl" || exit 1
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

PLAN_REF=$(python3 - "$STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1]) as handle:
    print(json.load(handle).get('plan_reference', ''))
PY
) || PLAN_REF=""
if [ -z "$PLAN_REF" ]; then
    echo "Error: no plan_reference in state.json for run '$RUN_ID'" >&2
    exit 1
fi

state_resolve_plan_reference "$CWD" "$PLAN_REF" || exit 1
PLAN_PATH="$STATE_PLAN_PATH"
state_require_existing_run_file "$PLAN_PATH" "plan file" || exit 1
if [ ! -f "$PLAN_PATH" ]; then
    echo "Error: plan file not found: $PLAN_PATH" >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE=$(mktemp "$STATE_RUN_DIR/.state.json.XXXXXX")
EVENTS_TMP=$(mktemp "$STATE_RUN_DIR/.events.jsonl.XXXXXX")
cleanup_transaction_temps() { rm -f "$TMP_FILE" "$EVENTS_TMP"; }
trap cleanup_transaction_temps EXIT

python3 - "$STATE_FILE" "$PLAN_PATH" "$FIX" "$NOW" "$RUN_ID" "$CWD" "$TMP_FILE" "$EVENTS_FILE" "$EVENTS_TMP" <<'PYEOF'
import json, sys, re, os

state_file, plan_path, fix, now, run_id, cwd, tmp_file, events_file, events_tmp = sys.argv[1:]
fix = (fix == "--fix")

with open(state_file) as f:
    state = json.load(f)
with open(plan_path) as f:
    plan_lines = f.readlines()

# Parse checkboxes from ## TODOs and ## Final Verification Wave sections
headings = {"TODOs", "Final Verification Wave"}
in_section = False
plan_boxes = []  # {id, title, checked, section}
for line in plan_lines:
    s = line.strip()
    if s.startswith("## "):
        in_section = s[3:].strip() in headings
        continue
    if not in_section:
        continue
    m = re.match(r"^-\s+\[([ xX])\]\s+(.+)$", s)
    if m:
        checked = m.group(1).lower() == "x"
        title = m.group(2).strip()
        # extract task id prefix like "T1:" if present
        mid = re.match(r"^([A-Za-z]*\d+)\s*:\s*(.+)$", title)
        tid = mid.group(1) if mid else None
        plan_boxes.append({"id": tid, "title": title, "checked": checked})

total = len(plan_boxes)
completed = sum(1 for b in plan_boxes if b["checked"])

tasks = state.get("tasks", [])
tasks_by_id = {t.get("id"): t for t in tasks if t.get("id")}

drift = []

# 1. progress counter drift
prog = state.get("progress", {})
if prog.get("total_checkboxes") != total or prog.get("completed_checkboxes") != completed:
    drift.append("progress drift: state=%s/%s  plan=%d/%d" % (
        prog.get("completed_checkboxes", 0), prog.get("total_checkboxes", 0), completed, total))

# 2. task.status vs checkbox drift (match by id)
for box in plan_boxes:
    if box["id"] and box["id"] in tasks_by_id:
        t = tasks_by_id[box["id"]]
        box_done = box["checked"]
        task_done = t.get("status") == "done"
        if box_done != task_done:
            drift.append("status drift: %s plan=%s state=%s" % (
                box["id"], "checked" if box_done else "unchecked", t.get("status")))

# 3. plan-only tasks (in plan with id but not in state tasks[])
for box in plan_boxes:
    if box["id"] and box["id"] not in tasks_by_id:
        drift.append("plan-only task: %s '%s' not in state.json tasks[]" % (box["id"], box["title"][:60]))

# Report
print("=== plan<->state sync for run '%s' ===" % run_id)
print("plan: %d checkboxes, %d checked" % (total, completed))
print("state tasks: %d" % len(tasks))
if drift:
    print("DRIFT DETECTED (%d):" % len(drift))
    for d in drift:
        print("  - " + d)
else:
    print("NO DRIFT — plan and state are in sync.")

if not fix:
    if drift:
        print("\n(dry-run; pass --fix to reconcile)")
    sys.exit(0)

# Reconcile
changed = False
# fix progress
if prog.get("total_checkboxes") != total or prog.get("completed_checkboxes") != completed:
    state["progress"] = {"total_checkboxes": total, "completed_checkboxes": completed}
    changed = True
# fix task statuses
for box in plan_boxes:
    if box["id"] and box["id"] in tasks_by_id:
        t = tasks_by_id[box["id"]]
        want = "done" if box["checked"] else "pending"
        if t.get("status") != want:
            t["status"] = want
            changed = True
if changed:
    statuses = {task.get("id"): task.get("status") for task in tasks}
    for task in tasks:
        if task.get("status") == "done":
            incomplete = [dependency for dependency in task.get("depends_on", []) if statuses.get(dependency) != "done"]
            if incomplete:
                raise SystemExit("Error: dependency %s must be done before task '%s'" % (", ".join(incomplete), task.get("id", "?")))
    state["updated_at"] = now
    with open(tmp_file, "w") as f:
        json.dump(state, f, indent=2)
    ev = {"ts": now, "run_id": run_id, "event": "plan_state_synced", "drift_fixed": len(drift)}
    with open(events_tmp, "w") as output:
        if os.path.exists(events_file):
            with open(events_file) as source:
                output.write(source.read())
        output.write(json.dumps(ev) + "\n")
    print("\nRECONCILED: progress + task statuses updated (%d drift fixed)." % len(drift))
else:
    print("\nNothing to write (only counters/statuses are auto-fixed; plan-only tasks need manual add).")
PYEOF

if [ -s "$TMP_FILE" ]; then
    state_commit_transaction "$STATE_RUN_DIR" sync_plan_state \
        "$(state_transaction_write_arg state.json "$STATE_FILE" "$TMP_FILE")" \
        "$(state_transaction_write_arg events.jsonl "$EVENTS_FILE" "$EVENTS_TMP")"
fi
exit 0
