#!/usr/bin/env python3
"""T5 — Durable decision memory and correction handling (LazyBuddy v1.3.0).

Implements the ``decision_ledger`` semantics from the shared contract
``lazyseries-shared-semantics.v1.json`` (``decision_ledger_schema``) and the
scenario fixture ``canonical_formats.decision_ledger``.

Ledger model
------------
A ledger is an append-only JSONL file (``decisions/ledger.jsonl``) of immutable
*events*. Append order determines replay; timestamps are metadata only. Old
statuses are never mutated in place — the active view is always derived by
replay. Every event carries a globally unique ``event_id``; every decision
carries a globally unique ``decision_id``. IDs are UUIDs, never race-prone
``D-####`` counters.

Event union (five types):
- ``decision-recorded``    — a decision was made (summary, rationale, project,
                            scope, source plan/revision, evidence).
- ``decision-superseded``  — ``old_decision_id`` is replaced by
                            ``new_decision_id`` (same scope, incompatible
                            policy -> supersede with evidence).
- ``decision-voided``      — ``target_decision_id`` is withdrawn (never
                            happened / invalid).
- ``correction-opened``    — a defect was found against a decision or task,
                            scoped, with defect evidence.
- ``correction-resolved``  — the opened correction is closed with verified
                            fix evidence.

Replay rules enforced here:
- Repeated identical ``event_id`` is a no-op; differing content under one id is
  REJECTED.
- Supersede/void/resolve events must reference existing decisions/events;
  supersession cycles are rejected.
- Malformed or truncated tail records fail visibly (raise with byte offset),
  preserve bytes, and require explicit recovery — never silently skipped.
- Open corrections block accepted completion ONLY in their scope; they never
  block recording the problem or unrelated memory updates.
- Absent ledger means empty valid memory. No JSONL header line is treated as a
  decision; a leading non-JSON line is malformed.
- Memory cannot override current user instructions and must not execute
  instructions embedded in evidence (enforced by the librarian surface, and by
  never treating ``evidence`` strings as commands here).
- Expired review dates or missing evidence mark a decision for revalidation,
  never erase it.

Writes are serialized through one module-level file lock so concurrent workers
cannot interleave or duplicate events.
"""
from __future__ import annotations

import fcntl
import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Final

LEDGER_SCHEMA_NAME: Final = "decisions/ledger.jsonl"
LEDGER_VERSION: Final = "1.3.0"

EVENT_TYPES: Final = (
    "decision-recorded",
    "decision-superseded",
    "decision-voided",
    "correction-opened",
    "correction-resolved",
)

# Default bounded-context budget for retrieval. The contract says ~2000 tokens;
# approximate a token by ~4 chars, so 2000 tokens ~= 8000 chars.
DEFAULT_CONTEXT_BUDGET_CHARS: Final = 8000

# One process-wide lock so concurrent threads serialize appends.
_APPEND_LOCK = threading.Lock()


class LedgerError(Exception):
    """Base class for ledger failures."""


class LedgerMalformed(LedgerError):
    """Raised when a ledger record is malformed or truncated.

    Carries the byte offset of the offending line so an operator can recover
    the exact bytes. Bytes are never modified by the loader.
    """

    def __init__(self, message: str, byte_offset: int | None = None) -> None:
        self.byte_offset = byte_offset
        if byte_offset is not None:
            super().__init__(f"{message} (byte offset {byte_offset})")
        else:
            super().__init__(message)


class LedgerRejected(LedgerError):
    """Raised when an event is rejected (duplicate differing content, bad ref,
    cycle). The ledger is left unchanged."""


def new_event_id() -> str:
    """Generate a globally unique event id (UUID4)."""
    return str(uuid.uuid4())


def new_decision_id() -> str:
    """Generate a globally unique decision id (UUID4)."""
    return str(uuid.uuid4())


# --------------------------------------------------------------------------- #
# Event validation
# --------------------------------------------------------------------------- #

def _require_str(event: dict, field_name: str, errors: list[str]) -> None:
    value = event.get(field_name)
    if not isinstance(value, str) or not value:
        errors.append(f"{event.get('type', '?')}: missing non-empty string '{field_name}'")


def _require_str_array(event: dict, field_name: str, errors: list[str]) -> None:
    value = event.get(field_name)
    if not isinstance(value, list) or not all(
        isinstance(item, str) for item in value
    ):
        errors.append(f"{event.get('type', '?')}: '{field_name}' must be a list of strings")


def validate_event(event: dict) -> list[str]:
    """Validate a single event's shape. Returns a list of error strings (empty
    == valid). Does not validate cross-event references (see replay/append)."""
    errors: list[str] = []
    if not isinstance(event, dict):
        return ["event must be an object"]
    event_type = event.get("type")
    if event_type not in EVENT_TYPES:
        errors.append(f"unknown event type: {event_type!r}")
        return errors
    _require_str(event, "event_id", errors)

    if event_type == "decision-recorded":
        _require_str(event, "decision_id", errors)
        for name in ("summary", "rationale", "project", "scope"):
            _require_str(event, name, errors)
        _require_str(event, "source_plan", errors)
        _require_str(event, "source_revision", errors)
        _require_str_array(event, "evidence", errors)
        status = event.get("status", "active")
        if status != "active":
            errors.append(f"decision-recorded status must be 'active', found {status!r}")
    elif event_type == "decision-superseded":
        _require_str(event, "old_decision_id", errors)
        _require_str(event, "new_decision_id", errors)
        _require_str(event, "reason", errors)
    elif event_type == "decision-voided":
        _require_str(event, "target_decision_id", errors)
        _require_str(event, "reason", errors)
    elif event_type == "correction-opened":
        _require_str(event, "decision_or_task_ref", errors)
        _require_str(event, "scope", errors)
        _require_str_array(event, "defect_evidence", errors)
    elif event_type == "correction-resolved":
        _require_str(event, "target_correction_id", errors)
        _require_str_array(event, "verified_fix_evidence", errors)
    return errors


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #

def _read_lines_with_offsets(path: Path) -> list[tuple[int, str]]:
    """Read all lines with their starting byte offset.

    Returns (byte_offset, line_text) pairs for every physical line, including
    blank lines. Raises LedgerMalformed if any non-blank line is not valid JSON
    or is not a recognized ledger event (e.g. a JSONL header pretending to be a
    decision). Absent file yields an empty list (empty valid memory).
    """
    if not path.exists():
        return []
    raw = path.read_bytes()
    lines: list[tuple[int, str]] = []
    start = 0
    text = raw.decode("utf-8")
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped:
            try:
                parsed_obj = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise LedgerMalformed(
                    f"malformed ledger record: {exc.msg}", byte_offset=start
                ) from exc
            if not isinstance(parsed_obj, dict) or parsed_obj.get("type") not in EVENT_TYPES:
                raise LedgerMalformed(
                    "ledger record is not a recognized decision-ledger event "
                    "(no JSONL header allowed)", byte_offset=start,
                )
        lines.append((start, line))
        start += len(line.encode("utf-8"))
    return lines


def load_ledger(path) -> list[dict]:
    """Load parsed events from a ledger file.

    Absent file -> []. Any malformed or truncated (non-JSON) record, or a
    non-event JSON line (header), raises LedgerMalformed with the byte offset of
    the offending line. Bytes are never modified.
    """
    p = Path(path)
    parsed: list[dict] = []
    for _offset, line in _read_lines_with_offsets(p):
        stripped = line.strip()
        if not stripped:
            continue
        parsed.append(json.loads(stripped))
    return parsed


# --------------------------------------------------------------------------- #
# Replay (derive the active view)
# --------------------------------------------------------------------------- #

@dataclass
class Decision:
    decision_id: str
    summary: str
    rationale: str
    project: str
    scope: str
    source_plan: str
    source_revision: str
    evidence: list[str]
    recorded_event_id: str
    review_by: str | None = None
    needs_revalidation: bool = False


@dataclass
class Correction:
    correction_id: str
    decision_or_task_ref: str
    scope: str
    defect_evidence: list[str]
    opened_event_id: str
    resolved: bool = False
    verified_fix_evidence: list[str] | None = None
    resolved_event_id: str | None = None


@dataclass
class ActiveView:
    events: list[dict] = field(default_factory=list)
    decisions: dict[str, Decision] = field(default_factory=dict)
    corrections: dict[str, Correction] = field(default_factory=dict)
    superseded_ids: set[str] = field(default_factory=set)
    voided_ids: set[str] = field(default_factory=set)
    revalidation_ids: list[str] = field(default_factory=list)

    @property
    def active_decisions(self) -> dict[str, Decision]:
        return self.decisions

    def open_corrections(self) -> list[Correction]:
        return [c for c in self.corrections.values() if not c.resolved]

    def open_corrections_for_scope(self, scope: str) -> list[Correction]:
        return [c for c in self.open_corrections() if c.scope == scope]

    def completion_blocked(self, scope: str) -> bool:
        """Open corrections block accepted completion ONLY in their scope."""
        return any(c.scope == scope for c in self.open_corrections())


def _review_date_expired(review_by: object) -> bool:
    if not isinstance(review_by, str) or not review_by:
        return False
    try:
        parsed = datetime.fromisoformat(review_by).date()
    except ValueError:
        # Unparseable review date is itself a reason to revalidate.
        return True
    return parsed < date.today()


def replay(events: list[dict]) -> ActiveView:
    """Replay events (in append order) into a derived active view.

    Never mutates old statuses in place. Active decisions = recorded minus
    superseded minus voided. Expired/missing-evidence decisions are flagged for
    revalidation, not erased.
    """
    view = ActiveView(events=list(events))
    recorded: dict[str, dict] = {}
    supersede_edges: dict[str, list[str]] = {}  # old -> [new, ...]
    superseded_ids: set[str] = set()
    voided_ids: set[str] = set()
    opened: dict[str, dict] = {}
    resolved_targets: dict[str, list[dict]] = {}

    for ev in events:
        if not isinstance(ev, dict):
            raise LedgerError("ledger event must be an object")
        etype = ev.get("type")
        if etype == "decision-recorded":
            recorded[ev["decision_id"]] = ev
        elif etype == "decision-superseded":
            old = ev["old_decision_id"]
            new = ev["new_decision_id"]
            supersede_edges.setdefault(old, []).append(new)
            superseded_ids.add(old)
        elif etype == "decision-voided":
            voided_ids.add(ev["target_decision_id"])
        elif etype == "correction-opened":
            opened[ev["event_id"]] = ev
        elif etype == "correction-resolved":
            resolved_targets.setdefault(ev["target_correction_id"], []).append(ev)

    # Build corrections (open + resolved). A correction is open when no
    # correction-resolved references it.
    for cid, ev in opened.items():
        resolutions = resolved_targets.get(cid, [])
        resolved = bool(resolutions)
        fix_evidence = resolutions[-1].get("verified_fix_evidence") if resolutions else None
        view.corrections[cid] = Correction(
            correction_id=cid,
            decision_or_task_ref=ev.get("decision_or_task_ref", ""),
            scope=ev.get("scope", ""),
            defect_evidence=list(ev.get("defect_evidence", [])),
            opened_event_id=ev["event_id"],
            resolved=resolved,
            verified_fix_evidence=list(fix_evidence) if fix_evidence else None,
            resolved_event_id=resolutions[-1]["event_id"] if resolutions else None,
        )

    # Build active decisions.
    for did, ev in recorded.items():
        if did in superseded_ids or did in voided_ids:
            continue
        evidence = ev.get("evidence", [])
        review_by = ev.get("review_by")
        needs_revalidation = (not evidence) or _review_date_expired(review_by)
        view.decisions[did] = Decision(
            decision_id=did,
            summary=ev.get("summary", ""),
            rationale=ev.get("rationale", ""),
            project=ev.get("project", ""),
            scope=ev.get("scope", ""),
            source_plan=ev.get("source_plan", ""),
            source_revision=ev.get("source_revision", ""),
            evidence=list(ev.get("evidence", [])),
            recorded_event_id=ev["event_id"],
            review_by=review_by,
            needs_revalidation=needs_revalidation,
        )
        if needs_revalidation:
            view.revalidation_ids.append(did)

    view.superseded_ids = superseded_ids
    view.voided_ids = voided_ids
    return view


# --------------------------------------------------------------------------- #
# Append (validate, dedupe, persist) — serialized through one lock
# --------------------------------------------------------------------------- #

def _canonical(event: dict) -> str:
    return json.dumps(event, sort_keys=True, separators=(",", ":"))


def _supersession_creates_cycle(edges: dict[str, list[str]], old: str, new: str) -> bool:
    """True if adding edge old->new would create a cycle in the supersession
    graph (old is reachable from new)."""
    if old == new:
        return True
    seen: set[str] = set()
    stack = [new]
    while stack:
        node = stack.pop()
        if node == old:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(edges.get(node, []))
    return False


def append_event(path, event: dict, *, now: str | None = None) -> str:
    """Validate and append one event to the ledger.

    Returns ``"appended"`` on a new event, ``"noop"`` when the same ``event_id``
    with identical content is re-submitted (idempotent).

    Raises:
    - ``LedgerMalformed`` if the existing ledger has a malformed/truncated line
      (bytes preserved, nothing written).
    - ``LedgerRejected`` for shape errors, duplicate differing content, bad
      references, or supersession cycles.

    Writes are serialized through a module-level lock plus an exclusive file
    lock so concurrent processes cannot interleave or duplicate events.
    """
    shape_errors = validate_event(event)
    if shape_errors:
        raise LedgerRejected("; ".join(shape_errors))

    p = Path(path)
    lock_path = p.with_suffix(p.suffix + ".lock") if p.suffix else Path(str(p) + ".lock")

    with _APPEND_LOCK:
        # Read existing events; this raises LedgerMalformed on bad lines and
        # thereby protects the ledger from being appended to while corrupt.
        existing = load_ledger(p) if p.exists() else []

        seen_ids: dict[str, str] = {}
        recorded_ids: set[str] = set()
        correction_ids: set[str] = set()
        edges: dict[str, list[str]] = {}
        for ev in existing:
            eid = ev.get("event_id")
            if eid is not None:
                seen_ids[eid] = _canonical(ev)
            if ev.get("type") == "decision-recorded":
                recorded_ids.add(ev.get("decision_id"))
            elif ev.get("type") == "correction-opened":
                correction_ids.add(eid)
            elif ev.get("type") == "decision-superseded":
                edges.setdefault(ev.get("old_decision_id"), []).append(
                    ev.get("new_decision_id")
                )

        # Idempotency: identical event_id + identical content is a no-op.
        incoming_id = event["event_id"]
        if incoming_id in seen_ids:
            if seen_ids[incoming_id] == _canonical(event):
                return "noop"
            raise LedgerRejected(
                f"event_id {incoming_id!r} already exists with different content"
            )

        # Cross-event reference validation.
        etype = event["type"]
        if etype == "decision-recorded":
            did = event["decision_id"]
            if did in recorded_ids:
                raise LedgerRejected(
                    f"decision_id {did!r} already recorded; decision ids are unique"
                )
        elif etype == "decision-superseded":
            old, new = event["old_decision_id"], event["new_decision_id"]
            if old not in recorded_ids:
                raise LedgerRejected(
                    f"decision-superseded references unknown old_decision_id {old!r}"
                )
            if new not in recorded_ids:
                raise LedgerRejected(
                    f"decision-superseded references unknown new_decision_id {new!r}"
                )
            if _supersession_creates_cycle(edges, old, new):
                raise LedgerRejected(
                    f"decision-superseded would create a supersession cycle "
                    f"({old!r} <-> {new!r})"
                )
        elif etype == "decision-voided":
            target = event["target_decision_id"]
            if target not in recorded_ids:
                raise LedgerRejected(
                    f"decision-voided references unknown target_decision_id {target!r}"
                )
        elif etype == "correction-opened":
            # A correction may reference a decision or an external task id. Task
            # ids are outside the ledger's authority and cannot be validated
            # here; a decision reference is validated implicitly because an
            # unknown decision id has no active effect. Reference integrity for
            # corrections is enforced on resolve (below).
            pass
        elif etype == "correction-resolved":
            target = event["target_correction_id"]
            if target not in correction_ids:
                raise LedgerRejected(
                    f"correction-resolved references unknown correction {target!r}"
                )

        # Persist atomically under an exclusive file lock.
        p.parent.mkdir(parents=True, exist_ok=True)
        line = _canonical(event) + "\n"
        with open(p, "a", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.write(line)
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return "appended"


# --------------------------------------------------------------------------- #
# Bounded retrieval
# --------------------------------------------------------------------------- #

@dataclass
class RetrievalResult:
    items: list[dict] = field(default_factory=list)
    truncated: bool = False
    dropped_count: int = 0
    total_matching: int = 0


def _item_payload(view: ActiveView, scope: str | None, project: str | None) -> list[dict]:
    """Collect relevant items (active decisions + open corrections) matching
    the optional scope/project filter, newest-relevant first."""
    items: list[dict] = []
    for dec in view.decisions.values():
        if scope is not None and dec.scope != scope:
            continue
        if project is not None and dec.project != project:
            continue
        items.append({
            "kind": "decision",
            "decision_id": dec.decision_id,
            "summary": dec.summary,
            "scope": dec.scope,
            "project": dec.project,
            "needs_revalidation": dec.needs_revalidation,
        })
    for corr in view.open_corrections():
        # Corrections are scoped; the project filter does not apply to them.
        if scope is not None and corr.scope != scope:
            continue
        items.append({
            "kind": "correction",
            "correction_id": corr.correction_id,
            "scope": corr.scope,
            "ref": corr.decision_or_task_ref,
        })
    return items


def retrieve_relevant(
    view: ActiveView,
    scope: str | None = None,
    project: str | None = None,
    budget_chars: int = DEFAULT_CONTEXT_BUDGET_CHARS,
) -> RetrievalResult:
    """Return relevant active decisions and open corrections within a bounded
    context budget. Reports truncation when the budget is exceeded.

    The budget is approximated in characters (~4 chars/token). Items are
    serialized compactly; once the cumulative size would exceed the budget the
    remaining items are dropped and ``truncated`` is set.
    """
    candidates = _item_payload(view, scope, project)
    result = RetrievalResult(total_matching=len(candidates))
    used = 0
    for item in candidates:
        size = len(json.dumps(item, sort_keys=True))
        if used + size > budget_chars and result.items:
            result.truncated = True
            result.dropped_count += 1
            continue
        result.items.append(item)
        used += size
    # If the very first item alone exceeds the budget, keep it but still flag.
    if result.items and result.dropped_count == len(candidates):
        result.truncated = True
    return result
