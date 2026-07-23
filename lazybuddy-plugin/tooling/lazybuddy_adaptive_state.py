from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Final, NamedTuple

from lazybuddy_adaptive_fingerprint import request_digest
from lazybuddy_adaptive_snapshot import (
    validate_adaptive_snapshot,
    write_adaptive_snapshot,
    write_state_file_atomic,
)


TERMINAL_STATUSES: Final = {"complete", "failed", "cancelled"}
RUN_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
FINGERPRINT_FIELDS: Final = (
    "hostFingerprint",
    "requestDigest",
    "revisionFingerprint",
    "scopeFingerprint",
)


class ActiveState(NamedTuple):
    run_id: str
    state: dict
    state_path: Path


class StateResolution(NamedTuple):
    status: str
    target: ActiveState | None = None


def _unsafe_directory(path: Path) -> bool:
    return path.is_symlink() or path.exists() and not path.is_dir()


def _unsafe_file(path: Path) -> bool:
    return path.is_symlink() or path.exists() and not path.is_file()


def _load_candidate(run_dir: Path) -> ActiveState | None:
    if run_dir.is_symlink() or not run_dir.is_dir():
        raise OSError("unsafe run directory")
    run_id = run_dir.name
    if RUN_ID_PATTERN.fullmatch(run_id) is None:
        raise OSError("unsafe run identifier")
    state_path = run_dir / "state.json"
    if not state_path.exists():
        return None
    if _unsafe_file(state_path):
        raise OSError("unsafe state file")
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise OSError("unreadable state file") from error
    if not isinstance(state, dict) or state.get("run_id") != run_id:
        raise OSError("invalid state identity")
    if state.get("status") in TERMINAL_STATUSES:
        return None
    return ActiveState(run_id=run_id, state=state, state_path=state_path)


def _related(candidate: ActiveState, current_request_digest: str) -> bool:
    objective = candidate.state.get("objective")
    if isinstance(objective, str) and request_digest(objective) == current_request_digest:
        return True
    adaptive = candidate.state.get("adaptive")
    return (
        isinstance(adaptive, dict)
        and validate_adaptive_snapshot(adaptive)
        and adaptive.get("requestDigest") == current_request_digest
    )


def resolve_active_state(
    project_root: Path,
    current_request_digest: str,
) -> StateResolution:
    state_root = project_root / ".lazybuddy"
    runs_root = state_root / "runs"
    if _unsafe_directory(state_root):
        return StateResolution(status="unsafe-state-path")
    if not state_root.exists():
        return StateResolution(status="no-active-state")
    if _unsafe_directory(runs_root):
        return StateResolution(status="unsafe-state-path")
    if not runs_root.exists():
        return StateResolution(status="no-active-state")
    active: list[ActiveState] = []
    try:
        for run_dir in sorted(runs_root.iterdir()):
            candidate = _load_candidate(run_dir)
            if candidate is not None:
                active.append(candidate)
    except OSError:
        return StateResolution(status="unsafe-state-path")
    if not active:
        return StateResolution(status="no-active-state")
    related = [candidate for candidate in active if _related(candidate, current_request_digest)]
    if not related:
        return StateResolution(status="unrelated-active-state")
    selected = max(
        related,
        key=lambda candidate: str(candidate.state.get("updated_at", "")),
    )
    return StateResolution(status="target", target=selected)


def changed_fingerprint_material(prior: dict, current: dict) -> list[str]:
    return [field for field in FINGERPRINT_FIELDS if prior.get(field) != current.get(field)]


def persist_snapshot(target: ActiveState, snapshot: dict) -> None:
    write_adaptive_snapshot(target.state, snapshot)
    write_state_file_atomic(str(target.state_path), target.state)
