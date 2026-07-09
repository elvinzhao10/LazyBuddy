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

if [ -z "$RUN_ID" ]; then
    echo "Usage: sync-plan-state.sh <run_id> [--fix]" >&2
    exit 1
fi

CWD="${CWD:-.}"
STATE_FILE="$CWD/.lazyworkbuddy/runs/$RUN_ID/state.json"
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: state.json not found for run '$RUN_ID'" >&2
    exit 1
fi

PLAN_REF=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('plan_reference',''))" 2>/dev/null || echo "")
if [ -z "$PLAN_REF" ]; then
    echo "Error: no plan_reference in state.json for run '$RUN_ID'" >&2
    exit 1
fi

if [[ "$PLAN_REF" == /* ]]; then
    PLAN_PATH="$PLAN_REF"
else
    PLAN_PATH="$CWD/$PLAN_REF"
fi
if [ ! -f "$PLAN_PATH" ]; then
    echo "Error: plan file not found: $PLAN_PATH" >&2
    exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_FILE="$STATE_FILE.tmp.$$"

python3 - "$STATE_FILE" "$PLAN_PATH" "$FIX" "$NOW" "$RUN_ID" "$CWD" <<'PYEOF'
import json, sys, re, os

state_file, plan_path, fix, now, run_id, cwd = sys.argv[1:7]
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
    state["updated_at"] = now
    tmp = state_file + ".tmp.%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, state_file)
    # append event
    ev_file = os.path.join(os.path.dirname(state_file), "events.jsonl")
    ev = {"ts": now, "run_id": run_id, "event": "plan_state_synced", "drift_fixed": len(drift)}
    with open(ev_file, "a") as f:
        f.write(json.dumps(ev) + "\n")
    print("\nRECONCILED: progress + task statuses updated (%d drift fixed)." % len(drift))
else:
    print("\nNothing to write (only counters/statuses are auto-fixed; plan-only tasks need manual add).")
PYEOF

rm -f "$TMP_FILE" 2>/dev/null || true
exit 0
