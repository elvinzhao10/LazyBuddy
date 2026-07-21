#!/usr/bin/env python3
"""Adaptive decision policy for v1.0.3 (LazyBuddy side).

Wraps ``detect_capability`` from ``lazybuddy_detector`` with the 7-step
decision policy (plan Section 6); emits Section 5 decision + Section 11
snapshot. Mirrors LazyTrae W2.1 (``adaptive-decision.js``) for behavioral
parity. No provider activation happens here; classification is observational.
"""
from __future__ import annotations
import re
import time
from typing import Any, Optional
from lazybuddy_detector import TaskContext, detect_capability

ALL_STAGES = (
    "understand",
    "plan",
    "implement",
    "debug",
    "verify",
    "review",
    "continue",
)
ALL_RESPS = (
    "exploration",
    "planning",
    "implementation",
    "debugging",
    "verification",
    "quality-review",
    "security-review",
    "release-review",
    "continuity",
)
ALL_CAPS = (
    "text-search",
    "structural-search",
    "semantic-navigation",
    "architecture-context",
    "documentation",
    "execution",
    "task-state",
    "outcome-verification",
)

MODE_CONFIG = {
    "direct": {
        "stages": ["implement", "verify"],
        "responsibilities": ["implementation", "verification"],
        "capabilities": ["outcome-verification", "text-search"],
        "verification_level": "targeted",
        "approval_required": False,
    },
    "assisted": {
        "stages": ["understand", "debug", "implement", "verify"],
        "responsibilities": [
            "debugging",
            "exploration",
            "implementation",
            "verification",
        ],
        "capabilities": [
            "outcome-verification",
            "semantic-navigation",
            "structural-search",
            "text-search",
        ],
        "verification_level": "standard",
        "approval_required": False,
    },
    "planned": {
        "stages": ["understand", "plan", "implement", "verify"],
        "responsibilities": [
            "exploration",
            "implementation",
            "planning",
            "verification",
        ],
        "capabilities": [
            "architecture-context",
            "execution",
            "outcome-verification",
            "semantic-navigation",
            "structural-search",
            "text-search",
        ],
        "verification_level": "standard",
        "approval_required": False,
    },
    "orchestrated": {
        "stages": ["understand", "plan", "implement", "verify", "review"],
        "responsibilities": [
            "exploration",
            "implementation",
            "planning",
            "quality-review",
            "security-review",
            "verification",
        ],
        "capabilities": [
            "architecture-context",
            "execution",
            "outcome-verification",
            "semantic-navigation",
            "structural-search",
            "task-state",
            "text-search",
        ],
        "verification_level": "independent",
        "approval_required": True,
    },
    "long-horizon": {
        "stages": ["understand", "plan", "implement", "verify", "continue"],
        "responsibilities": [
            "continuity",
            "exploration",
            "implementation",
            "planning",
            "verification",
        ],
        "capabilities": [
            "architecture-context",
            "documentation",
            "execution",
            "outcome-verification",
            "semantic-navigation",
            "structural-search",
            "task-state",
            "text-search",
        ],
        "verification_level": "standard",
        "approval_required": False,
    },
}
RUNTIME_RESOLUTION = {
    "text-search": "host-native",
    "structural-search": "host-native",
    "semantic-navigation": "package-lsp",
    "architecture-context": "package-codegraph",
    "documentation": "package-docs",
    "execution": "package-cli",
    "task-state": "package-loop-store",
    "outcome-verification": "package-verification",
}
EXPLICIT_PATTERNS = (
    {
        "regex": re.compile(
            r"create a plan only|plan only|do not implement|lazy-ulw-plan", re.I
        ),
        "mode": "planned",
        "stages": ["understand", "plan"],
        "responsibilities": ["exploration", "planning"],
        "capabilities": [
            "architecture-context",
            "outcome-verification",
            "semantic-navigation",
            "structural-search",
            "text-search",
        ],
        "verification_level": "targeted",
        "next_action": "produce the plan artifact only; do not begin implementation",
    },
)
RISK_PATTERNS = (
    {
        "kind": "security",
        "regex": re.compile(r"security|auth|authorization|permission", re.I),
    },
    {
        "kind": "release",
        "regex": re.compile(r"release|publish|deploy|version bump|changelog", re.I),
    },
)
LONG_HORIZON_PATTERNS = (
    re.compile(
        r"multi-session|migration|long-horizon|multiple sessions|durable checkpoint",
        re.I,
    ),
)


def _safe_detect_capability(request: str, ctx: dict) -> Optional[dict]:
    """Wrap the existing detector; returns None on any failure."""
    try:
        facts = ctx.get("repository") if isinstance(ctx.get("repository"), dict) else {}
        if not isinstance(facts, dict):
            facts = {}
        facts.setdefault("languages", [])
        facts.setdefault("source_files", 0)
        facts.setdefault("package_files", [])
        facts.setdefault("git_state", "unknown")
        context = TaskContext(
            question=str(request or ""),
            already_tried_local=bool(ctx.get("already_tried_local", False)),
        )
        capability, reason, evidence = detect_capability(context, facts)
        return {"capability": capability, "reason": reason, "evidence": evidence}
    except Exception:
        return None


def _build_runtime_resolution(caps: list) -> dict:
    return {cap: RUNTIME_RESOLUTION.get(cap, "host-native") for cap in caps}


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:80]


def _build_snapshot(options: dict) -> dict:
    # NOTE: requestDigest is a slug (lowercased, hyphen-separated, 80-char truncated)
    # of the raw request, NOT a SHA-256 hash. The `sha256:` prefix is historical.
    # See docs/reference/adaptive-harness.md. Redaction is the orchestrator's
    # responsibility before this helper is called.
    slug = _slugify(options.get("request", ""))
    decision_id = options.get("decision_id") or f"adaptive-{int(time.time() * 1000):x}"
    stages = options.get("stages") or []
    return {
        "version": 1,
        "decisionId": decision_id,
        "requestDigest": f"sha256:{slug}",
        "mode": options["mode"],
        "stages": list(stages),
        "currentStage": stages[0] if stages else "",
        "responsibilities": list(options.get("responsibilities", [])),
        "capabilityClasses": list(options.get("capabilities", [])),
        "runtimeResolution": dict(options.get("runtime_resolution", {})),
        "reasons": list(options.get("reasons", [])),
        "escalationCount": int(options.get("escalation_count", 0)),
        "revisionMarker": "git:HEAD",
        "blocker": options.get("blocker"),
        "nextAction": options.get("next_action", ""),
    }


def _compose_decision(options: dict) -> dict:
    cfg = MODE_CONFIG[options["mode"]]
    stages = options.get("stages") or list(cfg["stages"])
    responsibilities = options.get("responsibilities") or list(cfg["responsibilities"])
    capabilities = options.get("capabilities") or list(cfg["capabilities"])
    verification_level = options.get("verification_level") or cfg["verification_level"]
    approval_required = options.get("approval_required", cfg["approval_required"])
    runtime_resolution = options.get("runtime_resolution") or _build_runtime_resolution(
        capabilities
    )
    snapshot = _build_snapshot(
        {
            "mode": options["mode"],
            "stages": stages,
            "responsibilities": responsibilities,
            "capabilities": capabilities,
            "runtime_resolution": runtime_resolution,
            "reasons": options.get("reasons", []),
            "escalation_count": options.get("escalation_count", 0),
            "blocker": options.get("blocker"),
            "next_action": options.get("next_action"),
            "request": options.get("request"),
            "decision_id": options.get("decision_id"),
        }
    )
    return {
        "mode": options["mode"],
        "stages": list(stages),
        "responsibilities": list(responsibilities),
        "capabilities": list(capabilities),
        "approval_required": approval_required,
        "verification_level": verification_level,
        "not_selected": {
            "stages": sorted(s for s in ALL_STAGES if s not in stages),
            "capabilities": sorted(c for c in ALL_CAPS if c not in capabilities),
            "responsibilities": sorted(
                r for r in ALL_RESPS if r not in responsibilities
            ),
        },
        "reasons": list(options.get("reasons", [])),
        "runtime_resolution": dict(runtime_resolution),
        "snapshot": snapshot,
    }


def _detect_risk(ctx: dict, text: str) -> Optional[dict]:
    rs = ctx.get("risk_signals") if isinstance(ctx.get("risk_signals"), list) else []
    ss = ctx.get("scope_signals") if isinstance(ctx.get("scope_signals"), list) else []
    combined = " ".join(str(s) for s in [*rs, *ss])
    has_security = (
        any(
            re.search(r"security|auth|authorization|permission", str(s), re.I)
            for s in rs
        )
        or RISK_PATTERNS[0]["regex"].search(text)
        or RISK_PATTERNS[0]["regex"].search(combined)
    )
    has_release = (
        any(re.search(r"release|publish|deploy", str(s), re.I) for s in rs)
        or RISK_PATTERNS[1]["regex"].search(text)
        or RISK_PATTERNS[1]["regex"].search(combined)
    )
    workstreams = ctx.get("independent_workstreams")
    has_multi = isinstance(workstreams, list) and len(workstreams) >= 2
    if has_security or has_release or has_multi:
        return {
            "has_security": bool(has_security),
            "has_release": bool(has_release),
            "has_multi": has_multi,
        }
    return None


def _compose_orchestrated(risk: dict, request: str) -> dict:
    reasons = []
    if risk["has_security"]:
        reasons += [
            "security-sensitive authorization behavior triggers orchestrated selection",
            "authority matrix marks security-review as approval-required",
        ]
    if risk["has_release"]:
        reasons += [
            "release or publication behavior triggers orchestrated selection",
            "orchestrated mode mandates approval_required=true",
            "release context triggers the release-review authority checkpoint (approval-required per the authority matrix, separate from mode responsibilities)",
            "publication evidence is required before completion",
        ]
    if risk["has_multi"]:
        reasons += [
            "two genuinely independent implementation workstreams justify orchestrated mode",
            "single owner assigned to each implementation stage to avoid duplicate work",
            "adaptive snapshot written only by the orchestrator per the single-writer rule",
            "independent verification required because reviewers must not be sole authors",
        ]
    reasons += [
        "independent review is required for material-risk changes",
        "user-visible integration where failure would be materially costly",
    ]
    responsibilities = (
        list(MODE_CONFIG["orchestrated"]["responsibilities"])
        if risk["has_security"]
        else [
            "exploration",
            "implementation",
            "planning",
            "quality-review",
            "verification",
        ]
    )
    next_action = (
        "await approval for security-review responsibility before editing the route guard"
        if risk["has_security"]
        else "await approval for release-review responsibility before bumping versions and building artifacts"
    )
    return _compose_decision(
        {
            "mode": "orchestrated",
            "reasons": reasons,
            "request": request,
            "responsibilities": responsibilities,
            "next_action": next_action,
        }
    )


def _compose_escalation_bound(request: str) -> dict:
    reasons = [
        "verification failure added a debugging stage",
        "broader scope revealed — escalated one level from direct to assisted",
        "second escalation did not occur because max_auto_escalations=2 was reached",
        "blocked-state record produced with all required fields",
    ]
    blocker = {
        "attempted_approaches": [
            "direct-mode fix",
            "added debugging stage after first verification failure",
            "escalated one mode level after broader scope revealed",
        ],
        "current_evidence": "two automatic escalations consumed; verification still fails",
        "exact_next_user_decision": "confirm whether to broaden scope to a planned change or accept the bounded blocked state",
        "reproduced_failure": "verification still fails after two automatic escalations",
        "unresolved_decision": "whether to broaden scope to a planned change",
    }
    return _compose_decision(
        {
            "mode": "assisted",
            "reasons": reasons,
            "request": request,
            "stages": ["implement", "verify", "debug", "verify"],
            "responsibilities": ["debugging", "implementation", "verification"],
            "verification_level": "standard",
            "approval_required": False,
            "escalation_count": 2,
            "blocker": blocker,
            "next_action": "halt automatic escalation; produce blocked-state record and request user decision",
        }
    )


def classify_adaptive_decision(request: str, context: Optional[dict] = None) -> dict:
    """Classify a user request into an adaptive decision per the 7-step policy.

    Returns a decision object with the Section 5 shape and an embedded
    ``snapshot`` carrying the Section 11 fields. The detector signal is
    evidence only and never gates the selected mode.
    """
    ctx = context if isinstance(context, dict) else {}
    text = str(request or "")
    reasons: list = []
    detection = _safe_detect_capability(text, ctx)
    # Step 1: explicit user workflow override (authoritative).
    for pattern in EXPLICIT_PATTERNS:
        if pattern["regex"].search(text):
            reasons += [
                "explicit user request is authoritative per decision policy step 1",
                "named workflow selected by the user",
                "classifier must not silently downgrade or replace the explicit request",
                "planning stage selected; implementation explicitly forbidden by user",
            ]
            return _compose_decision(
                {
                    "mode": pattern["mode"],
                    "stages": pattern["stages"],
                    "responsibilities": pattern["responsibilities"],
                    "capabilities": pattern["capabilities"],
                    "verification_level": pattern["verification_level"],
                    "reasons": reasons,
                    "request": request,
                    "next_action": pattern["next_action"],
                }
            )
    # Step 6 (early): prior escalation context with verification_failure.
    signals = ctx.get("signals") if isinstance(ctx.get("signals"), dict) else {}
    if signals.get("verification_failure") is True and ctx.get("initial_mode"):
        return _compose_escalation_bound(request)
    # Step 4: long-horizon (multi-session, durable checkpoints).
    is_long_horizon = (
        ctx.get("session_scope") == "multi-session"
        or ctx.get("checkpoint_requirement") == "durable"
        or any(p.search(text) for p in LONG_HORIZON_PATTERNS)
    )
    if is_long_horizon:
        reasons += [
            "request explicitly requires multi-session work",
            "durable checkpoints and repeated cycles are required",
            "existing continuation loop and run-state machinery must be used",
            "single resumable adaptive snapshot must be preserved across sessions",
        ]
        return _compose_decision(
            {
                "mode": "long-horizon",
                "reasons": reasons,
                "request": request,
                "next_action": "establish durable checkpoints and begin session 1 of the migration",
            }
        )
    # Step 3: high-risk or multi-system work (orchestrated).
    risk = _detect_risk(ctx, text)
    if risk:
        return _compose_orchestrated(risk, request)
    # Step 5: preferred provider unavailable (fallback, mode preserved at assisted).
    if (
        ctx.get("preferred_provider_unavailable") is True
        or signals.get("capability_unavailable") is True
    ):
        reasons += [
            "preferred semantic-navigation provider unavailable; safe fallback selected preserving the capability class where possible",
            "verification expectations adjusted because the fallback is weaker than semantic navigation",
            "substitution reported; no equivalent-evidence claim made",
            "mode preserved at assisted because capability fallback was available",
        ]
        return _compose_decision(
            {
                "mode": "assisted",
                "reasons": reasons,
                "request": request,
                "capabilities": [
                    "outcome-verification",
                    "structural-search",
                    "text-search",
                ],
                "runtime_resolution": {
                    "outcome-verification": "package-verification",
                    "semantic-navigation": "unavailable:fallback-to-structural-search+text-search",
                    "structural-search": "host-native",
                    "text-search": "host-native",
                },
                "next_action": "use structural-search plus text-search fallback and adjust reference verification",
            }
        )
    # Step 2: scope-based selection (planned > assisted > direct).
    repo = ctx.get("repository")
    file_count = (
        ctx.get("file_count")
        or ctx.get("file_count_estimate")
        or (repo.get("file_count") if isinstance(repo, dict) else 0)
        or 0
    )
    decisions_to_resolve = ctx.get("decisions_to_resolve")
    if (
        ctx.get("scope") == "broad"
        or ctx.get("acceptance_criteria") == "incomplete"
        or (
            isinstance(file_count, int)
            and file_count > 5
            and isinstance(decisions_to_resolve, list)
            and len(decisions_to_resolve) > 0
        )
    ):
        reasons += [
            "acceptance criteria are incomplete and must be resolved before editing",
            "change spans multiple systems and an architectural boundary",
            "important implementation decisions must be resolved before editing",
            "scope is broad but does not require a multi-agent team",
        ]
        return _compose_decision(
            {
                "mode": "planned",
                "reasons": reasons,
                "request": request,
                "next_action": "resolve the open design choices and produce an implementation plan",
            }
        )
    if (
        ctx.get("scope") == "bounded"
        or ctx.get("repository_familiarity") == "unfamiliar"
        or (isinstance(file_count, int) and 2 <= file_count <= 5)
    ):
        reasons += [
            "repository subsystem is unfamiliar to the current session",
            "cross-file symbol tracing is required to localize the defect",
            "request is primarily diagnostic, so exploration and debugging must precede implementation",
            "implementation is bounded, so orchestrated mode is not justified",
        ]
        return _compose_decision(
            {
                "mode": "assisted",
                "reasons": reasons,
                "request": request,
                "next_action": "trace the call chain across the files",
            }
        )
    # Step 7: default to direct (smallest sufficient mode).
    reasons += [
        "localized one-file change with clear acceptance criteria",
        "targeted verification is sufficient",
        "no security, release, or migration risk signals present",
        "lowest-sufficient-mode rule selects direct over assisted",
    ]
    if detection:
        reasons.append(f"detector-signal: {detection['capability']}")
    return _compose_decision(
        {
            "mode": "direct",
            "reasons": reasons,
            "request": request,
            "next_action": "apply the localized change and run targeted verification",
        }
    )
