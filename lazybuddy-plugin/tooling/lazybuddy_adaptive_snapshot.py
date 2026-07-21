"""Adaptive snapshot helper for v1.0.3 LazyBuddy run state (W3.4).

Wraps the optional ``adaptive`` block in ``state.json`` per plan Section 11.
The adaptive orchestrator is the only writer (single-writer rule). Atomic
writes follow the LazyBuddy state-scripts convention: mktemp + mv (no
fcntl.flock — see W0.3 change-map). v1.0.2 state without the block continues
to load (backward compatibility).
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from typing import Optional

SNAPSHOT_REQUIRED_FIELDS = (
    "version",
    "decisionId",
    "requestSlug",
    "mode",
    "stages",
    "currentStage",
    "responsibilities",
    "capabilityClasses",
    "runtimeResolution",
    "reasons",
    "escalationCount",
    "revisionMarker",
    "blocker",
    "nextAction",
)

SINGLE_WRITER = "orchestrator"


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_adaptive_snapshot(snapshot: object) -> bool:
    """Return True iff *snapshot* has all 14 required Section 11 fields with plausible types."""
    if not isinstance(snapshot, dict):
        return False
    for field in SNAPSHOT_REQUIRED_FIELDS:
        if field not in snapshot:
            return False
    if not isinstance(snapshot.get("version"), int):
        return False
    if not isinstance(snapshot.get("mode"), str):
        return False
    if not isinstance(snapshot.get("stages"), list):
        return False
    if not isinstance(snapshot.get("responsibilities"), list):
        return False
    if not isinstance(snapshot.get("capabilityClasses"), list):
        return False
    if not isinstance(snapshot.get("runtimeResolution"), dict):
        return False
    if not isinstance(snapshot.get("reasons"), list):
        return False
    if not isinstance(snapshot.get("escalationCount"), int):
        return False
    if snapshot.get("blocker") is not None and not isinstance(
        snapshot.get("blocker"), (dict, str)
    ):
        return False
    return True


def read_adaptive_snapshot(run_state: dict) -> Optional[dict]:
    """Return the ``adaptive`` block from *run_state*, or None when absent/null."""
    if not isinstance(run_state, dict):
        return None
    block = run_state.get("adaptive")
    if block is None:
        return None
    return block  # type: ignore[return-value]


def write_adaptive_snapshot(run_state: dict, snapshot: dict) -> None:
    """Validate *snapshot*, set ``run_state['adaptive']`` and stamp ``updated_at``.

    Raises ValueError if the snapshot is missing required Section 11 fields.
    The caller is responsible for the atomic write to disk (mktemp + mv pattern
    used by LazyBuddy state scripts). Single-writer rule: only the orchestrator
    should call this.
    """
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    if not validate_adaptive_snapshot(snapshot):
        raise ValueError(
            "adaptive snapshot is missing required fields or has invalid types"
        )
    snapshot = dict(snapshot)
    snapshot["updated_at"] = _iso_now()
    run_state["adaptive"] = snapshot


def clear_adaptive_snapshot(run_state: dict) -> None:
    """Set ``run_state['adaptive']`` to None (clears the block, preserves the key)."""
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    run_state["adaptive"] = None


def write_state_file_atomic(state_path: str, run_state: dict) -> None:
    """Write *run_state* to *state_path* using the mktemp+mv atomic pattern.

    Mirrors ``scripts/state/update-task.sh``: mktemp in the same directory,
    write JSON, fsync, then rename atomically. No flock (per W0.3 findings).
    """
    if not isinstance(run_state, dict):
        raise TypeError("run_state must be a dict")
    directory = os.path.dirname(os.path.abspath(state_path)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".state.json.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(run_state, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, state_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def load_state_file(state_path: str) -> dict:
    """Read and parse a state.json file. Returns an empty dict if the file is empty."""
    with open(state_path) as f:
        return json.load(f)
