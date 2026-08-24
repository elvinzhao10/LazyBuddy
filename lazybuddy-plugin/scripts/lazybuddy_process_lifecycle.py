from __future__ import annotations

import signal
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, TypeAlias, assert_never


MIN_PROCESS_GROUP_ID: Final = 2


class CleanupStatus(StrEnum):
    VERIFIED_ABSENT = "verified-absent"
    VERIFIED_REMAINING = "verified-remaining"
    INSPECTION_UNAVAILABLE = "inspection-unavailable"
    SIGNAL_REFUSED = "signal-refused"
    IDENTITY_CHANGED = "identity-changed"


class SignalStatus(StrEnum):
    SENT = "sent"
    NOT_FOUND = "not-found"
    REFUSED = "refused"


@dataclass(frozen=True, slots=True)
class ProcessRecord:
    pid: int
    parent_pid: int
    group_id: int
    state: str
    started: str


@dataclass(frozen=True, slots=True)
class InspectionAvailable:
    records: tuple[ProcessRecord, ...]


@dataclass(frozen=True, slots=True)
class InspectionUnavailable:
    reason: str


InspectionResult: TypeAlias = InspectionAvailable | InspectionUnavailable


@dataclass(frozen=True, slots=True)
class SignalResult:
    status: SignalStatus
    detail: str = ""

    @classmethod
    def sent(cls) -> SignalResult:
        return cls(SignalStatus.SENT)

    @classmethod
    def not_found(cls) -> SignalResult:
        return cls(SignalStatus.NOT_FOUND)

    @classmethod
    def refused(cls, detail: str) -> SignalResult:
        return cls(SignalStatus.REFUSED, detail)


@dataclass(frozen=True, slots=True)
class CleanupReceipt:
    status: CleanupStatus
    tracked_pids: tuple[int, ...]
    detail: str = ""

    def as_json(self) -> dict[str, str | list[int]]:
        return {
            "status": self.status.value,
            "tracked_pids": list(self.tracked_pids),
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class OwnershipTracker:
    root: ProcessRecord
    tracked: tuple[ProcessRecord, ...]
    inspection_problem: str = ""

    @classmethod
    def establish(cls, root: ProcessRecord, inspection: InspectionResult) -> OwnershipTracker:
        if root.pid < MIN_PROCESS_GROUP_ID or root.group_id != root.pid:
            return cls(root=root, tracked=(root,), inspection_problem="root process group identity is invalid")
        return cls(root=root, tracked=(root,)).observe(inspection)

    def observe(self, inspection: InspectionResult) -> OwnershipTracker:
        match inspection:
            case InspectionUnavailable(reason=reason):
                return OwnershipTracker(self.root, self.tracked, self.inspection_problem or reason)
            case InspectionAvailable(records=values):
                tracked = {record.pid: record for record in self.tracked}
                observed_root = next((record for record in values if record.pid == self.root.pid), None)
                root_continuous = (
                    observed_root is not None
                    and observed_root.started == self.root.started
                    and observed_root.group_id == self.root.group_id
                )
                children: dict[int, list[ProcessRecord]] = {}
                for record in values:
                    children.setdefault(record.parent_pid, []).append(record)
                pending = [self.root.pid, *tracked]
                visited: set[int] = set()
                while pending:
                    parent = pending.pop()
                    if parent in visited:
                        continue
                    visited.add(parent)
                    for child in children.get(parent, []):
                        tracked.setdefault(child.pid, child)
                        pending.append(child.pid)
                if root_continuous:
                    for record in values:
                        if record.group_id == self.root.group_id:
                            tracked.setdefault(record.pid, record)
                return OwnershipTracker(
                    root=self.root,
                    tracked=tuple(sorted(tracked.values(), key=lambda item: item.pid)),
                    inspection_problem=self.inspection_problem,
                )
            case unreachable:
                assert_never(unreachable)


Inspector: TypeAlias = Callable[[], InspectionResult]
GroupSignaler: TypeAlias = Callable[[int, int], SignalResult]


def _current_owned(
    tracker: OwnershipTracker,
    inspection: InspectionAvailable,
) -> tuple[tuple[ProcessRecord, ...], bool, bool, bool]:
    current = {record.pid: record for record in inspection.records if not record.state.startswith("Z")}
    owned: list[ProcessRecord] = []
    escaped = False
    identity_changed = False
    foreign_group_member = False
    for tracked in tracker.tracked:
        observed = current.get(tracked.pid)
        if observed is None:
            continue
        if observed.started != tracked.started:
            identity_changed = True
        elif observed.group_id == tracker.root.group_id:
            owned.append(observed)
        else:
            escaped = True
    tracked_pids = {record.pid for record in tracker.tracked}
    foreign_group_member = any(
        record.group_id == tracker.root.group_id and record.pid not in tracked_pids
        for record in current.values()
    )
    return tuple(owned), escaped, identity_changed, foreign_group_member


def _receipt(
    status: CleanupStatus,
    tracker: OwnershipTracker,
    detail: str = "",
) -> CleanupReceipt:
    return CleanupReceipt(status, tuple(record.pid for record in tracker.tracked), detail)


def cleanup_owned_processes(
    tracker: OwnershipTracker,
    inspector: Inspector,
    signaler: GroupSignaler,
) -> CleanupReceipt:
    if tracker.inspection_problem:
        return _receipt(CleanupStatus.INSPECTION_UNAVAILABLE, tracker, tracker.inspection_problem)
    refused_detail = ""
    for signal_number in (signal.SIGTERM, signal.SIGKILL):
        inspection = inspector()
        match inspection:
            case InspectionUnavailable(reason=reason):
                return _receipt(CleanupStatus.INSPECTION_UNAVAILABLE, tracker, reason)
            case InspectionAvailable():
                tracker = tracker.observe(inspection)
                owned, escaped, identity_changed, foreign_group_member = _current_owned(tracker, inspection)
            case unreachable:
                assert_never(unreachable)
        if identity_changed:
            return _receipt(CleanupStatus.IDENTITY_CHANGED, tracker, "tracked PID start identity changed")
        if foreign_group_member:
            return _receipt(CleanupStatus.IDENTITY_CHANGED, tracker, "untracked process occupies owned group identity")
        if escaped and not owned:
            return _receipt(CleanupStatus.VERIFIED_REMAINING, tracker, "tracked descendant left owned group")
        if not owned:
            return _receipt(CleanupStatus.VERIFIED_ABSENT, tracker)
        if tracker.root.group_id < MIN_PROCESS_GROUP_ID or tracker.root.group_id != tracker.root.pid:
            return _receipt(CleanupStatus.IDENTITY_CHANGED, tracker, "owned process group identity changed")
        signal_result = signaler(tracker.root.group_id, signal_number)
        match signal_result.status:
            case SignalStatus.SENT | SignalStatus.NOT_FOUND:
                pass
            case SignalStatus.REFUSED:
                refused_detail = signal_result.detail
            case unreachable:
                assert_never(unreachable)
        post_signal = inspector()
        match post_signal:
            case InspectionUnavailable(reason=reason):
                return _receipt(CleanupStatus.INSPECTION_UNAVAILABLE, tracker, reason)
            case InspectionAvailable():
                tracker = tracker.observe(post_signal)
                remaining, escaped, identity_changed, foreign_group_member = _current_owned(tracker, post_signal)
            case unreachable:
                assert_never(unreachable)
        if identity_changed:
            return _receipt(CleanupStatus.IDENTITY_CHANGED, tracker, "tracked PID start identity changed")
        if foreign_group_member:
            return _receipt(CleanupStatus.IDENTITY_CHANGED, tracker, "untracked process occupies owned group identity")
        if escaped:
            return _receipt(CleanupStatus.VERIFIED_REMAINING, tracker, "tracked descendant left owned group")
        if not remaining:
            return _receipt(CleanupStatus.VERIFIED_ABSENT, tracker)
        if refused_detail:
            return _receipt(CleanupStatus.SIGNAL_REFUSED, tracker, refused_detail)
    return _receipt(CleanupStatus.VERIFIED_REMAINING, tracker, "owned process survived TERM and KILL")


def persistence_allowed(
    returncode: int,
    output_complete: bool,
    protocol_valid: bool,
    fingerprint_valid: bool,
    cleanup_status: CleanupStatus,
) -> bool:
    return (
        returncode == 0
        and output_complete
        and protocol_valid
        and fingerprint_valid
        and cleanup_status is CleanupStatus.VERIFIED_ABSENT
    )
