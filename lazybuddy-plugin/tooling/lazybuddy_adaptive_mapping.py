#!/usr/bin/env python3
"""Adaptive mapping for v1.0.3 (LazyBuddy side).

Maps an adaptive decision (output of ``classify_adaptive_decision`` in
``lazybuddy_adaptive_detector``) to existing LazyBuddy workflow surfaces
per plan Section 10 (Runtime-specific mapping).

This is a thin adapter: it selects existing surfaces (Skills, commands,
agents, hooks, MCP services, run/state). It does not duplicate execution
logic and does not introduce a second orchestration runtime.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any

CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent
    / "contracts"
    / "adaptive-harness-contract.v1.json"
)

# LazyBuddy always uses lazy-verifier for verification and the lazy-status
# command for status reporting, regardless of mode.
VERIFICATION_SURFACE = "lazy-verifier"
STATUS_SURFACE = "lazy-status"

# LazyBuddy mode -> workflow surface mapping (plan Section 10).
# - direct: user edits directly; no workflow surface.
# - assisted: single-task delegation via lazy-start-work.
# - planned: lazy-ulw-plan, then lazy-start-work.
# - orchestrated: lazy-ulw-plan + lazy-start-work + lazy-reviewer.
# - long-horizon: lazy-ulw-plan + lazy-start-work + lazy-ulw-loop.
MODE_SURFACES = {
    "direct": {"workflows": (), "orchestration": "none"},
    "assisted": {"workflows": ("lazy-start-work",), "orchestration": "start-work"},
    "planned": {
        "workflows": ("lazy-ulw-plan", "lazy-start-work"),
        "orchestration": "start-work",
    },
    "orchestrated": {
        "workflows": ("lazy-ulw-plan", "lazy-start-work", "lazy-reviewer"),
        "orchestration": "start-work",
    },
    "long-horizon": {
        "workflows": ("lazy-ulw-plan", "lazy-start-work", "lazy-ulw-loop"),
        "orchestration": "loop-runtime",
    },
}
KNOWN_MODES = tuple(MODE_SURFACES.keys())


def load_adaptive_contract() -> dict:
    """Read and parse the adaptive harness contract.

    The contract carries the ``authority_matrix`` used to populate
    ``responsibility_owners``. Reading the JSON directly (rather than via
    lazybuddy_policy.load_contract, which loads the separate automatic-tooling
    contract) keeps this adapter decoupled from unrelated policy concerns.
    """
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _is_valid_decision(decision: Any) -> bool:
    if not isinstance(decision, dict):
        return False
    mode = decision.get("mode")
    if not isinstance(mode, str) or not mode:
        return False
    return mode in MODE_SURFACES


def map_adaptive_decision_to_surfaces(decision: dict) -> dict:
    """Map an adaptive decision onto LazyBuddy workflow surfaces.

    Input: a decision dict produced by ``classify_adaptive_decision`` (must
      include a ``mode`` field set to one of: direct, assisted, planned,
      orchestrated, long-horizon).

    Returns:
      {
        "workflow_surfaces": [...],     # named workflows to invoke
        "responsibility_owners": {...}, # responsibility -> owner (authority_matrix)
        "verification_surface": "lazy-verifier",
        "status_surface": "lazy-status",
        "orchestration_surface": "none" | "start-work" | "loop-runtime",
      }

    Raises ValueError("ADAPTIVE_MAPPING_INVALID_DECISION: <mode>") when the
    input is null, missing a mode, or carries an unknown mode.
    """
    if not _is_valid_decision(decision):
        mode = (
            decision.get("mode") if isinstance(decision, dict) else None
        ) or "missing"
        raise ValueError(f"ADAPTIVE_MAPPING_INVALID_DECISION: {mode}")
    contract = load_adaptive_contract()
    authority_matrix = contract.get("authority_matrix", {})
    mode_config = MODE_SURFACES[decision["mode"]]
    return {
        "workflow_surfaces": list(mode_config["workflows"]),
        "responsibility_owners": dict(authority_matrix),
        "verification_surface": VERIFICATION_SURFACE,
        "status_surface": STATUS_SURFACE,
        "orchestration_surface": mode_config["orchestration"],
    }
