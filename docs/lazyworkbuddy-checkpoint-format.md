# Lazyworkbuddy Checkpoint Format v0.7

> Directory structure, manifest spec, and recovery procedure.

## Directory Structure

```
.lazyworkbuddy/runs/<run_id>/checkpoints/
├── 2026-07-09T13-00-00+08-00/    # ISO8601 timestamp (colons → hyphens)
│   ├── state.json                 # Full state at checkpoint time
│   ├── plan.md                    # Copy of plan_reference
│   └── manifest.json              # Checkpoint metadata
└── 2026-07-09T14-00-00+08-00/
    └── ...
```

## manifest.json Format

```json
{
  "checkpoint_id": "2026-07-09T13-00-00+08-00",
  "run_id": "run-20260709-001",
  "created_at": "2026-07-09T13:00:00+08:00",
  "checkbox_index": 7,
  "completion_percentage": 58.3,
  "reason": "auto",
  "event_count": 47,
  "plan_sha": "abc123def456",
  "state_checksum": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "iteration_count": 42,
  "mode": "ultrawork"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `checkpoint_id` | string | ISO8601 directory name |
| `run_id` | string | Parent run |
| `reason` | string | `auto`, `pre_destructive`, `paused`, `pre_compact` |
| `event_count` | int | Lines in events.jsonl at checkpoint |
| `plan_sha` | string | SHA256 of plan file |
| `state_checksum` | string | SHA256 of state.json for integrity |

## Trigger Rules

| Trigger | reason | Frequency |
|---------|--------|-----------|
| Every 5 checkboxes | `auto` | Periodic |
| Before destructive action | `pre_destructive` | On demand |
| Run paused | `paused` | On pause |
| Before context compaction | `pre_compact` | Hook-driven |

## Recovery Procedure

Recover = find latest checkpoint → verify integrity → restore → replay post-checkpoint events.

```bash
# 1. Find latest checkpoint
ls -1 .lazyworkbuddy/runs/run-20260709-001/checkpoints/ | sort | tail -1

# 2. Verify checksum
EXPECTED=$(jq -r '.state_checksum' "$CP_DIR/manifest.json" | cut -d: -f2)
ACTUAL=$(shasum -a 256 "$CP_DIR/state.json" | awk '{print $1}')
[ "$EXPECTED" = "$ACTUAL" ] || exit 1

# 3. Restore state
cp "$CP_DIR/state.json" .lazyworkbuddy/runs/run-20260709-001/state.json

# 4. Replay events after checkpoint timestamp
CP_TIME=$(jq -r '.created_at' "$CP_DIR/manifest.json")
jq -c --arg since "$CP_TIME" 'select(.timestamp > $since)' \
  events.jsonl | while read e; do
    # Apply event to rebuild state
    echo "$e" >> recovery_events.jsonl
done

# 5. Log restore + resume from next index
NEXT=$(jq -r '.progress.completed_checkboxes' state.json)
echo "Resume from checkbox: $NEXT"
```

### Shortcut

```bash
./scripts/state/recover-run.sh run-20260709-001
```

Performs all 5 steps: find, verify, restore, replay, log.

## Rotation

| Rule | Detail |
|------|--------|
| Retention | Last 3 checkpoints kept |
| On complete | Delete all; keep final state.json |
| On failure | Keep all for debugging |

---
_Extends `docs/lazyworkbuddy-state-ledger-design.md` with ISO8601 directory naming and events.jsonl replay for precise state reconstruction._
