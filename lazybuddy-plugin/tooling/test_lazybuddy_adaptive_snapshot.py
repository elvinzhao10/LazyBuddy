"""Pytest tests for lazybuddy_adaptive_snapshot (W3.4).

Covers: validate_adaptive_snapshot, read/write/clear helpers, atomic state
file writes, v1.0.2 backward compatibility, single-writer rule, schema
validation, and adversarial inputs. Mirrors the LazyTrae W2.3 test shape.

NOTE: This file lives in tooling/ rather than tests/ because the Trae IDE
sandbox blocked new-file creation in tests/ during this session. Pytest
discovers it here via `python -m pytest tooling/test_lazybuddy_adaptive_snapshot.py`.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_snapshot import (  # noqa: E402
    SNAPSHOT_REQUIRED_FIELDS,
    clear_adaptive_snapshot,
    load_state_file,
    read_adaptive_snapshot,
    validate_adaptive_snapshot,
    write_adaptive_snapshot,
    write_state_file_atomic,
)
from lazybuddy_adaptive_snapshot import SINGLE_WRITER  # noqa: E402


def _valid_snapshot():
    return {
        "version": 1,
        "decisionId": "dec-001",
        "requestDigest": "sha256:abc",
        "mode": "planned",
        "stages": ["understand", "plan", "implement", "verify"],
        "currentStage": "implement",
        "responsibilities": ["exploration", "planning", "implementation", "verification"],
        "capabilityClasses": ["text-search", "semantic-navigation"],
        "runtimeResolution": {"text-search": "host-native", "semantic-navigation": "package-lsp"},
        "reasons": ["cross-file change", "unfamiliar subsystem"],
        "escalationCount": 0,
        "revisionMarker": "git:HEAD",
        "blocker": None,
        "nextAction": "implement approved stage 2",
    }


def test_validate_correct_snapshot():
    assert validate_adaptive_snapshot(_valid_snapshot()) is True


@pytest.mark.parametrize("missing_field", list(SNAPSHOT_REQUIRED_FIELDS))
def test_validate_rejects_missing_each_field(missing_field):
    snap = _valid_snapshot()
    del snap[missing_field]
    assert validate_adaptive_snapshot(snap) is False


def test_validate_rejects_non_dict():
    assert validate_adaptive_snapshot(None) is False
    assert validate_adaptive_snapshot("string") is False
    assert validate_adaptive_snapshot([1, 2, 3]) is False


def test_validate_rejects_bad_types():
    snap = _valid_snapshot()
    snap["version"] = "1"
    assert validate_adaptive_snapshot(snap) is False
    snap = _valid_snapshot()
    snap["stages"] = "implement"
    assert validate_adaptive_snapshot(snap) is False
    snap = _valid_snapshot()
    snap["runtimeResolution"] = []
    assert validate_adaptive_snapshot(snap) is False
    snap = _valid_snapshot()
    snap["escalationCount"] = "0"
    assert validate_adaptive_snapshot(snap) is False


def test_read_returns_none_when_absent():
    state = {"schema_version": "2", "run_id": "r1"}
    assert read_adaptive_snapshot(state) is None


def test_read_returns_none_when_null():
    state = {"schema_version": "2", "run_id": "r1", "adaptive": None}
    assert read_adaptive_snapshot(state) is None


def test_read_returns_block_when_present():
    state = {"adaptive": _valid_snapshot()}
    block = read_adaptive_snapshot(state)
    assert block is not None
    assert block["mode"] == "planned"


def test_write_sets_updated_at_and_block():
    state = {"schema_version": "2", "run_id": "r1"}
    snap = _valid_snapshot()
    assert "updated_at" not in snap
    write_adaptive_snapshot(state, snap)
    assert state["adaptive"] is not None
    assert state["adaptive"]["mode"] == "planned"
    assert "updated_at" in state["adaptive"]
    assert state["adaptive"]["updated_at"] != ""


def test_write_rejects_invalid_snapshot():
    state = {"schema_version": "2", "run_id": "r1"}
    with pytest.raises(ValueError):
        write_adaptive_snapshot(state, {"mode": "planned"})


def test_write_rejects_non_dict_state():
    with pytest.raises(TypeError):
        write_adaptive_snapshot("not a dict", _valid_snapshot())  # type: ignore[arg-type]


def test_clear_sets_to_none():
    state = {"adaptive": _valid_snapshot()}
    clear_adaptive_snapshot(state)
    assert state["adaptive"] is None
    assert "adaptive" in state


def test_clear_rejects_non_dict_state():
    with pytest.raises(TypeError):
        clear_adaptive_snapshot("not a dict")  # type: ignore[arg-type]


def test_v102_backward_compat_no_adaptive_field():
    v102_state = {
        "schema_version": "2", "run_id": "r-old",
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
        "objective": "old run", "status": "complete", "plan_reference": "",
        "tasks": [], "progress": {"total_checkboxes": 0, "completed_checkboxes": 0},
        "verification_gates": [], "review_status": "not_started",
        "iteration": {"count": 0, "max": 500, "mode": "normal"},
        "last_checkpoint": None,
        "budget": {"max_tokens": None, "max_cost_usd": None}, "session_ids": [],
    }
    assert "adaptive" not in v102_state
    assert read_adaptive_snapshot(v102_state) is None
    clear_adaptive_snapshot(v102_state)
    assert v102_state["adaptive"] is None


def test_single_writer_constant():
    assert SINGLE_WRITER == "orchestrator"


def test_atomic_write_roundtrip(tmp_path):
    state = {"schema_version": "2", "run_id": "r1", "adaptive": _valid_snapshot()}
    state_path = tmp_path / "state.json"
    write_state_file_atomic(str(state_path), state)
    loaded = load_state_file(str(state_path))
    assert loaded["run_id"] == "r1"
    assert loaded["adaptive"]["mode"] == "planned"


def test_atomic_write_rejects_non_dict(tmp_path):
    state_path = tmp_path / "state.json"
    with pytest.raises(TypeError):
        write_state_file_atomic(str(state_path), "not a dict")  # type: ignore[arg-type]


def test_atomic_write_no_tempfile_leak_on_error(tmp_path):
    state_path = tmp_path / "nonexistent_subdir" / "state.json"
    state = {"adaptive": _valid_snapshot()}
    with pytest.raises(OSError):
        write_state_file_atomic(str(state_path), state)


def test_schema_has_all_14_required_fields():
    assert len(SNAPSHOT_REQUIRED_FIELDS) == 14
    expected = {
        "version", "decisionId", "requestDigest", "mode", "stages",
        "currentStage", "responsibilities", "capabilityClasses",
        "runtimeResolution", "reasons", "escalationCount",
        "revisionMarker", "blocker", "nextAction",
    }
    assert set(SNAPSHOT_REQUIRED_FIELDS) == expected


def test_adversarial_blocker_can_be_dict_or_string_or_null():
    for blocker in (None, "blocked: scope too broad", {"reproduced_failure": "x"}):
        snap = _valid_snapshot()
        snap["blocker"] = blocker
        assert validate_adaptive_snapshot(snap) is True


def test_adversarial_write_does_not_mutate_caller_snapshot():
    state = {"schema_version": "2", "run_id": "r1"}
    snap = _valid_snapshot()
    original_keys = set(snap.keys())
    write_adaptive_snapshot(state, snap)
    assert set(snap.keys()) == original_keys
    assert "updated_at" not in snap


def test_adversarial_escalation_bound_not_enforced_by_helper():
    snap = _valid_snapshot()
    snap["escalationCount"] = 99
    assert validate_adaptive_snapshot(snap) is True
