#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 bounded-lifecycle-state-machine-regression.py <bounded-runner>
from __future__ import annotations

import importlib.util
import sys
from collections.abc import Callable
from pathlib import Path


def load_runner(path: Path):
    spec = importlib.util.spec_from_file_location("bounded_lifecycle_red", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


runner = load_runner(Path(sys.argv[1]))


def record(pid: int, parent: int, group: int, started: str):
    return runner.ProcessRecord(pid, parent, group, "S", started)


root = record(4100, 1, 4100, "root-start")
child = record(4101, 4100, 4100, "child-start")
escaped = record(4101, 1, 5100, "child-start")
reused = record(4101, 1, 4100, "new-start")


def available(*records):
    return runner.InspectionAvailable(tuple(records))


def unavailable(reason: str):
    return runner.InspectionUnavailable(reason)


class SequenceInspector:
    def __init__(self, *results) -> None:
        self._results = list(results)

    def __call__(self):
        assert self._results, "inspection sequence exhausted"
        return self._results.pop(0)


class RecordingSignaler:
    def __init__(self, *results) -> None:
        self._results = list(results)
        self.groups: list[int] = []

    def __call__(self, group_id: int, _signal_number: int):
        self.groups.append(group_id)
        assert self._results, "signal sequence exhausted"
        return self._results.pop(0)


def cleanup_case(name: str, observations, signal_results, expected: str, expected_groups: list[int]) -> None:
    tracker = runner.OwnershipTracker.establish(root, available(root, child))
    signaler = RecordingSignaler(*signal_results)
    receipt = runner.cleanup_owned_processes(
        tracker,
        SequenceInspector(*observations),
        signaler,
    )
    assert receipt.status.value == expected, (name, receipt)
    assert signaler.groups == expected_groups, (name, signaler.groups)
    print(f"PASS: {name} -> {expected}")


cleanup_case("empty successful post-inspection", (available(),), (), "verified-absent", [])
cleanup_case(
    "ESRCH followed by unavailable inspection",
    (available(child), unavailable("ps-timeout")),
    (runner.SignalResult.not_found(),),
    "inspection-unavailable",
    [4100],
)
cleanup_case(
    "EPERM with verified survivor",
    (available(child), available(child)),
    (runner.SignalResult.refused("eperm"),),
    "signal-refused",
    [4100],
)
cleanup_case(
    "TERM and KILL leave verified survivor",
    (available(child), available(child), available(child), available(child)),
    (runner.SignalResult.sent(), runner.SignalResult.sent()),
    "verified-remaining",
    [4100, 4100],
)
cleanup_case("PID start identity reuse", (available(reused),), (), "identity-changed", [])
cleanup_case("tracked descendant escaped PGID", (available(escaped),), (), "verified-remaining", [])
cleanup_case("missing process inspection", (unavailable("ps-missing"),), (), "inspection-unavailable", [])
cleanup_case("malformed process inspection", (unavailable("ps-malformed"),), (), "inspection-unavailable", [])
cleanup_case("timed-out process inspection", (unavailable("ps-timeout"),), (), "inspection-unavailable", [])

assert runner.persistence_allowed(0, True, True, True, runner.CleanupStatus.VERIFIED_ABSENT)
for status in (
    runner.CleanupStatus.VERIFIED_REMAINING,
    runner.CleanupStatus.INSPECTION_UNAVAILABLE,
    runner.CleanupStatus.SIGNAL_REFUSED,
    runner.CleanupStatus.IDENTITY_CHANGED,
):
    assert not runner.persistence_allowed(0, True, True, True, status), status
assert not runner.persistence_allowed(0, False, True, True, runner.CleanupStatus.VERIFIED_ABSENT)
assert not runner.persistence_allowed(0, True, False, True, runner.CleanupStatus.VERIFIED_ABSENT)
assert not runner.persistence_allowed(0, True, True, False, runner.CleanupStatus.VERIFIED_ABSENT)
print("PASS: exhaustive persistence boundary")
