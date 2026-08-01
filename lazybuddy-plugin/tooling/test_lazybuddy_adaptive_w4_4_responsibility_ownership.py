from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402

ORCHESTRATED_REQUEST = "Implement independent CSV and JSON export workstreams."
ORCHESTRATED_CONTEXT = {
    "independent_workstreams": ["csv-export", "json-export"],
    "scope": "cross-file",
}

# Map each workflow stage to its canonical owning responsibility.
# Per Section 8: "Assign one owner to each implementation stage."
# The review stage may be owned by quality-review OR security-review
# (security-review is the security-sensitive variant of the same owner slot).
STAGE_OWNER = {
    "understand": "exploration", "plan": "planning",
    "implement": "implementation", "debug": "debugging",
    "verify": "verification", "continue": "continuity",
}
REVIEW_OWNERS = frozenset({"quality-review", "security-review", "release-review"})
SPECIALIST_OWNERS = frozenset({
    "exploration", "planning", "debugging",
    "quality-review", "security-review", "release-review", "continuity",
})


def _no_duplicates(items):
    return len(items) == len(set(items))


def _owners_for_stage(stage, responsibilities):
    if stage == "review":
        return [r for r in responsibilities if r in REVIEW_OWNERS]
    owner = STAGE_OWNER.get(stage)
    if not owner:
        return []
    return [r for r in responsibilities if r == owner]


def test_scenario_1_direct_mode_has_no_delegated_specialist():
    """Direct mode carries only the primary implementer + verification; no specialists."""
    decision = classify_adaptive_decision(
        "Fix the typo in the error message at src/errors.js:42.",
        {"scope": "localized", "file_count": 1, "acceptance_criteria": "clear"},
    )
    assert decision["mode"] == "direct"
    for r in decision["responsibilities"]:
        assert r not in SPECIALIST_OWNERS, f"direct mode must not delegate specialist '{r}'"
    assert "implementation" in decision["responsibilities"], "direct mode includes the primary implementer"


def test_scenario_2_assisted_mode_uses_focused_specialist_no_review_team():
    """Assisted mode may add focused specialists but must not assemble a review team."""
    request = "Implement a single CSV export after tracing the existing path."
    decision = classify_adaptive_decision(
        request,
        {"scope": "bounded", "file_count": 4, "repository_familiarity": "unfamiliar",
         "signals": {"primarily_debugging": True}},
    )
    assert decision["mode"] == "assisted"
    for r in REVIEW_OWNERS:
        assert r not in decision["responsibilities"], f"assisted mode must not include review responsibility '{r}'"
    assert "continuity" not in decision["responsibilities"], "assisted mode must not include continuity (no durable state)"
    focused = [r for r in decision["responsibilities"] if r in ("exploration", "debugging")]
    assert len(focused) >= 1, "assisted mode includes at least one focused specialist (exploration or debugging)"


def test_scenario_3_planned_mode_assigns_exactly_one_owner_per_stage():
    """Planned mode: |stages| == |responsibilities| and each stage has one owner."""
    decision = classify_adaptive_decision(
        "Add a new export-to-PDF feature with unresolved design choices.",
        {"scope": "broad", "acceptance_criteria": "incomplete",
         "decisions_to_resolve": ["library", "layout"]},
    )
    assert decision["mode"] == "planned"
    assert len(decision["stages"]) == len(decision["responsibilities"]), \
        "planned mode has exactly one owner per stage (no orphans, no duplicates)"
    for stage in decision["stages"]:
        owners = _owners_for_stage(stage, decision["responsibilities"])
        assert len(owners) == 1, f"planned stage '{stage}' must have exactly one owner; got {len(owners)}"
    assert _no_duplicates(decision["stages"]), "planned mode stages must be unique"
    assert _no_duplicates(decision["responsibilities"]), "planned mode responsibilities must be unique"


def test_scenario_4_orchestrated_mode_with_independent_workstreams_one_owner_per_stage():
    """Orchestrated mode with independent workstreams: one owner per stage, no dups."""
    decision = classify_adaptive_decision(ORCHESTRATED_REQUEST, ORCHESTRATED_CONTEXT)
    assert decision["mode"] == "orchestrated"
    workstreams = ORCHESTRATED_CONTEXT["independent_workstreams"]
    assert isinstance(workstreams, list) and len(workstreams) >= 2, \
        "fixture context must declare genuinely independent workstreams"
    for stage in decision["stages"]:
        owners = _owners_for_stage(stage, decision["responsibilities"])
        assert len(owners) >= 1, f"orchestrated stage '{stage}' must have at least one owner (no orphans)"
    assert _no_duplicates(decision["responsibilities"]), \
        "orchestrated mode must not duplicate responsibilities (no parallel agents for the same role)"
    impl_count = decision["responsibilities"].count("implementation")
    assert impl_count == 1, f"orchestrated mode has exactly one implementation owner; got {impl_count}"


def test_scenario_5_long_horizon_mode_includes_continuity_responsibility():
    """Long-horizon mode must include the continuity responsibility."""
    decision = classify_adaptive_decision(
        "Migrate session auth to JWT over multiple sessions with durable checkpoints.",
        {"session_scope": "multi-session", "checkpoint_requirement": "durable"},
    )
    assert decision["mode"] == "long-horizon"
    assert "continuity" in decision["responsibilities"], "long-horizon mode must include the continuity responsibility"
    assert "continue" in decision["stages"], "long-horizon mode must include the continue stage"


def test_scenario_6_no_duplicate_responsibilities_across_every_mode():
    """Every mode must produce unique responsibilities and unique stages."""
    cases = [
        ("direct", "Fix typo at src/errors.js:42.", {"scope": "localized", "file_count": 1}),
        ("assisted", "Diagnose stale profile data across four files.",
         {"scope": "bounded", "file_count": 4, "repository_familiarity": "unfamiliar"}),
        ("planned", "Add export-to-PDF feature with unresolved design.",
         {"scope": "broad", "acceptance_criteria": "incomplete", "decisions_to_resolve": ["lib"]}),
        ("orchestrated", ORCHESTRATED_REQUEST, ORCHESTRATED_CONTEXT),
        ("long-horizon", "Migrate auth to JWT over multiple sessions.",
         {"session_scope": "multi-session", "checkpoint_requirement": "durable"}),
    ]
    for name, request, ctx in cases:
        decision = classify_adaptive_decision(request, ctx)
        assert _no_duplicates(decision["responsibilities"]), \
            f"{name} mode responsibilities must have no duplicates: {decision['responsibilities']}"
        assert _no_duplicates(decision["stages"]), \
            f"{name} mode stages must have no duplicates: {decision['stages']}"


def test_scenario_7_reviewers_are_not_sole_authors():
    """When a review responsibility is present, implementation must also be present."""
    review_cases = [
        ("security-orchestrated",
         "Change authorization logic for /admin/billing endpoint.",
         {"risk_signals": ["security-sensitive", "authorization-change"]}),
        ("independent-workstreams", ORCHESTRATED_REQUEST, ORCHESTRATED_CONTEXT),
    ]
    for name, request, ctx in review_cases:
        decision = classify_adaptive_decision(request, ctx)
        has_review = any(r in REVIEW_OWNERS for r in decision["responsibilities"])
        if has_review:
            assert "implementation" in decision["responsibilities"], \
                f"{name}: implementation must be present when a review responsibility is (reviewer != author)"


def test_scenario_8_negative_dependent_work_does_not_spawn_parallel_implementers():
    """Dependent debug-then-fix work must not duplicate implementers or debuggers."""
    decision = classify_adaptive_decision(
        "Fix the failing unit test in src/utils/date.test.js.",
        {"initial_mode": "direct", "signals": {"verification_failure": True}},
    )
    assert decision["mode"] == "assisted"
    impl_count = decision["responsibilities"].count("implementation")
    assert impl_count == 1, f"dependent debug-then-fix work must have exactly one implementer; got {impl_count}"
    debug_count = decision["responsibilities"].count("debugging")
    assert debug_count == 1, f"dependent debug-then-fix work must have exactly one debugger; got {debug_count}"


def test_scenario_9_orchestrated_ownership_has_one_implementation_owner():
    decision = classify_adaptive_decision(ORCHESTRATED_REQUEST, ORCHESTRATED_CONTEXT)
    assert decision["mode"] == "orchestrated"
    assert decision["verification_level"] == "independent"
    assert decision["approval_required"] is False
    for stage in decision["stages"]:
        owners = _owners_for_stage(stage, decision["responsibilities"])
        assert len(owners) >= 1, f"stage '{stage}' must have at least one owner"
    impl_count = decision["responsibilities"].count("implementation")
    assert impl_count == 1, f"independent workstreams must share one implementation responsibility; got {impl_count}"
