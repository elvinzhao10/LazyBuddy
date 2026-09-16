"""T5 tests — durable decision memory and correction handling (v1.3.0).

One table-driven replay/append suite covering the five event types plus the
malformed / idempotent / reference-cycle / truncation / active-view /
correction-scope-isolation / bounded-retrieval / absent-file boundaries from
plan task T5 and ``canonical_formats.decision_ledger``.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_decision_ledger import (  # noqa: E402
    DEFAULT_CONTEXT_BUDGET_CHARS,
    Decision,
    LedgerMalformed,
    LedgerRejected,
    append_event,
    load_ledger,
    new_decision_id,
    new_event_id,
    replay,
    retrieve_relevant,
)
from lazybuddy_decision_ledger import validate_event  # noqa: E402


def _recorded(decision_id=None, scope="billing", project="lazyseries", evidence=None,
              review_by=None, summary="Use provider X for billing."):
    return {
        "event_id": new_event_id(),
        "type": "decision-recorded",
        "decision_id": decision_id or new_decision_id(),
        "summary": "Use provider X for billing.",
        "rationale": "Existing contract, lowest cost.",
        "project": project,
        "scope": scope,
        "source_plan": "plan-1",
        "source_revision": "abc123",
        "evidence": evidence if evidence is not None else ["run-1/evidence.json"],
        "summary": summary,
        "status": "active",
        **({"review_by": review_by} if review_by else {}),
    }


def _superseded(old, new, reason="policy changed"):
    return {
        "event_id": new_event_id(),
        "type": "decision-superseded",
        "old_decision_id": old,
        "new_decision_id": new,
        "reason": reason,
    }


def _voided(target, reason="never shipped"):
    return {
        "event_id": new_event_id(),
        "type": "decision-voided",
        "target_decision_id": target,
        "reason": reason,
    }


def _correction_opened(ref, scope="billing", defect=None):
    return {
        "event_id": new_event_id(),
        "type": "correction-opened",
        "decision_or_task_ref": ref,
        "scope": scope,
        "defect_evidence": defect if defect is not None else ["run-2/defect.log"],
    }


def _correction_resolved(target, fix=None):
    return {
        "event_id": new_event_id(),
        "type": "correction-resolved",
        "target_correction_id": target,
        "verified_fix_evidence": fix if fix is not None else ["run-2/fix.log"],
    }


# (label, events, expect_ok, expect_active_decisions, expect_errors)
REPLAY_ROWS = [
    ("single-recorded", [
        _recorded(scope="billing"),
    ], True, 1, []),
    ("recorded-then-superseded", [
        _recorded(decision_id="D1", scope="billing"),
        _recorded(decision_id="D2", scope="billing"),
        _superseded("D1", "D2"),
    ], True, 1, []),
    ("recorded-then-voided", [
        _recorded(decision_id="D1", scope="billing"),
        _voided("D1"),
    ], True, 0, []),
    ("supersede-chain-active-newest", [
        _recorded(decision_id="D1", scope="billing"),
        _superseded("D1", "D2"),
        _recorded(decision_id="D2", scope="billing"),
    ], True, 1, []),
    ("correction-open-then-resolve", [
        _recorded(decision_id="D1", scope="billing"),
        _correction_opened("D1", scope="billing"),
        _correction_resolved(None),  # filled below per-row is hard; see dedicated test
    ], True, 1, []),
]


@pytest.mark.parametrize("label,events,expect_ok,expect_active,expect_errors",
                         REPLAY_ROWS, ids=[r[0] for r in REPLAY_ROWS])
def test_replay_event_types(label, events, expect_ok, expect_active, expect_errors):
    # The correction-opened/resolved row needs the correction id wired up.
    if label == "correction-open-then-resolve":
        corr_id = events[1]["event_id"]
        events[2] = _correction_resolved(corr_id)
    view = replay(events)
    assert len(view.decisions) == expect_active, f"{label}: active={len(view.decisions)}"


def test_all_five_event_types_produce_active_view():
    d1, d2 = "D1", "D2"
    events = [
        _recorded(decision_id=d1, scope="billing"),
        _recorded(decision_id=d2, scope="nav"),
        _superseded(d1, "D3"),
        _recorded(decision_id="D3", scope="billing"),
        _correction_opened(d2, scope="nav"),
    ]
    view = replay(events)
    # d1 superseded -> not active; d2 active but has open correction in nav.
    assert d1 not in view.decisions
    assert d2 in view.decisions
    assert "D3" in view.decisions
    assert len(view.open_corrections()) == 1
    assert view.completion_blocked("nav") is True
    assert view.completion_blocked("billing") is False


def test_malformed_record_fails_visibly_preserves_bytes(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    good = _recorded(decision_id="D1", scope="billing")
    ledger.write_text(
        '{"event_id":"e1","type":"decision-recorded","decision_id":"D1"}\n'
        'THIS IS NOT JSON\n',
        encoding="utf-8",
    )
    with pytest.raises(LedgerMalformed) as exc:
        load_ledger(ledger)
    assert exc.value.byte_offset is not None
    # Bytes preserved: file is unchanged after a failed load.
    assert "THIS IS NOT JSON" in ledger.read_text(encoding="utf-8")
    # The good line is still intact.
    assert '"D1"' in ledger.read_text(encoding="utf-8")
    _ = good  # exercised shape


def test_truncated_line_handling(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text(
        '{"event_id":"e1","type":"decision-recorded","decision_id":"D1"}\n'
        '{"event_id":"e2","type":"decision-superseded","old_decision_id":"D1",\n',
        encoding="utf-8",
    )
    with pytest.raises(LedgerMalformed):
        load_ledger(ledger)
    # Truncated tail is NOT silently dropped.
    assert ledger.read_text(encoding="utf-8").count("\n") == 2


def test_leading_non_json_line_is_malformed(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    # A JSONL header pretending to be a decision must be rejected.
    ledger.write_text(
        '{"schema":"decisions/ledger.jsonl"}\n'
        '{"event_id":"e1","type":"decision-recorded","decision_id":"D1"}\n',
        encoding="utf-8",
    )
    # The first line is not a valid event type -> malformed.
    with pytest.raises(LedgerMalformed):
        load_ledger(ledger)


def test_absent_file_is_empty_memory(tmp_path):
    ledger = tmp_path / "does-not-exist.jsonl"
    events = load_ledger(ledger)
    assert events == []
    view = replay(events)
    assert view.decisions == {}
    assert view.corrections == {}
    assert view.completion_blocked("anything") is False


def test_idempotent_reappend_is_noop(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    event = _recorded(decision_id="D1", scope="billing")
    assert append_event(ledger, event) == "appended"
    # Re-submit identical content.
    assert append_event(ledger, event) == "noop"
    # The ledger contains exactly one line.
    assert len(load_ledger(ledger)) == 1


def test_differing_content_same_id_rejected(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    event = _recorded(decision_id="D1", scope="billing")
    append_event(ledger, event)
    evil = dict(event)
    evil["summary"] = "Changed summary under same id"
    with pytest.raises(LedgerRejected):
        append_event(ledger, evil)
    # Ledger unchanged: still the single original event.
    assert len(load_ledger(ledger)) == 1
    assert load_ledger(ledger)[0]["summary"] == "Use provider X for billing."


def test_unknown_reference_rejected(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    # supersede referencing an unknown decision.
    with pytest.raises(LedgerRejected):
        append_event(ledger, _superseded("D_MISSING", "D2"))
    # void referencing an unknown decision.
    with pytest.raises(LedgerRejected):
        append_event(ledger, _voided("D_MISSING"))
    # resolve referencing an unknown correction.
    assert append_event(ledger, _correction_opened("T1", scope="billing")) == "appended"
    with pytest.raises(LedgerRejected):
        append_event(ledger, _correction_resolved("C_MISSING"))


def test_supersession_cycle_rejected(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing"))
    append_event(ledger, _recorded(decision_id="D2", scope="billing"))
    # D1 -> D2
    append_event(ledger, _superseded("D1", "D2"))
    # D2 -> D1 would close a cycle.
    with pytest.raises(LedgerRejected):
        append_event(ledger, _superseded("D2", "D1"))
    # Direct self-supersede also rejected.
    with pytest.raises(LedgerRejected):
        append_event(ledger, _superseded("D1", "D1"))


def test_replay_derived_active_view_supersede_and_void(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing"))
    append_event(ledger, _recorded(decision_id="D2", scope="nav"))
    append_event(ledger, _recorded(decision_id="D3", scope="billing"))
    append_event(ledger, _superseded("D1", "D3"))
    append_event(ledger, _voided("D2"))
    view = replay(load_ledger(ledger))
    assert view.decisions.keys() == {"D3"}
    assert "D1" in view.superseded_ids
    assert "D2" in view.voided_ids
    # No in-place mutation: the recorded event for D1 still carries status.
    d1_event = next(e for e in view.events if e.get("decision_id") == "D1")
    assert d1_event["type"] == "decision-recorded"


def test_correction_scope_isolation(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing"))
    append_event(ledger, _recorded(decision_id="D2", scope="nav"))
    corr = _correction_opened("D1", scope="billing")
    append_event(ledger, corr)
    view = replay(load_ledger(ledger))
    # Open correction in billing does NOT block nav.
    assert view.completion_blocked("billing") is True
    assert view.completion_blocked("nav") is False
    # Resolving the correction clears the block in billing.
    append_event(ledger, _correction_resolved(corr["event_id"]))
    view2 = replay(load_ledger(ledger))
    assert view2.completion_blocked("billing") is False
    assert view2.open_corrections() == []


def test_bounded_retrieval_reports_truncation(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    # Many decisions in one scope; tiny budget forces truncation.
    for i in range(20):
        append_event(ledger, _recorded(decision_id=f"D{i}", scope="billing",
                                       summary=("decision number %d " % i) * 5))
    view = replay(load_ledger(ledger))
    result = retrieve_relevant(view, scope="billing", budget_chars=200)
    assert result.total_matching == 20
    assert result.truncated is True
    assert result.dropped_count > 0
    assert len(result.items) < 20


def test_retrieval_within_budget_not_truncated(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing"))
    append_event(ledger, _recorded(decision_id="D2", scope="nav"))
    view = replay(load_ledger(ledger))
    result = retrieve_relevant(view, budget_chars=DEFAULT_CONTEXT_BUDGET_CHARS)
    assert result.truncated is False
    assert result.total_matching == 2


def test_missing_evidence_marks_revalidation(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    # No evidence -> needs revalidation (not erased).
    append_event(ledger, _recorded(decision_id="D1", scope="billing", evidence=[]))
    view = replay(load_ledger(ledger))
    assert "D1" in view.decisions
    assert view.decisions["D1"].needs_revalidation is True
    assert "D1" in view.revalidation_ids


def test_expired_review_date_marks_revalidation(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing",
                                    evidence=["e1"], review_by="2000-01-01"))
    view = replay(load_ledger(ledger))
    assert view.decisions["D1"].needs_revalidation is True


def test_active_decision_not_flagged_for_revalidation(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    append_event(ledger, _recorded(decision_id="D1", scope="billing",
                                    evidence=["e1"]))
    view = replay(load_ledger(ledger))
    assert view.decisions["D1"].needs_revalidation is False


def test_validate_event_shapes():
    # A well-formed decision-recorded validates clean.
    assert validate_event(_recorded(decision_id="D1", scope="billing")) == []
    # Missing required field fails.
    bad = _recorded(decision_id="D1", scope="billing")
    del bad["summary"]
    assert validate_event(bad)
    # Unknown type fails.
    assert validate_event({"event_id": "x", "type": "nonsense"})
    # Supersede missing reason fails.
    bad_sup = _superseded("D1", "D2")
    del bad_sup["reason"]
    assert validate_event(bad_sup)


def test_append_preserves_bytes_on_malformed_existing(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text('GARBAGE LINE NOT JSON\n', encoding="utf-8")
    event = _recorded(decision_id="D1", scope="billing")
    with pytest.raises(LedgerMalformed):
        append_event(ledger, event)
    # Nothing appended; malformed bytes preserved.
    assert ledger.read_text(encoding="utf-8") == 'GARBAGE LINE NOT JSON\n'
