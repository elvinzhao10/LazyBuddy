#!/usr/bin/env python3
"""T2 — Dual entry convergence for LazyBuddy v1.3.0.

Both activation routes converge on the SAME execution authority and gates:

- **Explicit entry**  : ``/lazy-start-work <plan>`` is an execution instruction,
  not a re-interview. It validates the plan + gates, then starts eligible
  authorized tasks. It does NOT authorize unrelated publishing, spending,
  trust, or destructive actions.
- **Automatic entry** : an ordinary natural-language implementation request
  selects a workflow automatically and executes only within authorized scope.
  No magic slash command is required for the automatic route.

The module is data-driven where the existing scenario fixture allows: the
route-classification rows mirror ``contracts/fixtures/lazyseries-v130-scenarios.v1.json``
(S1, S2, S3, S4, S5, S6, S13, S14). The canonical fixture is the executable
contract; the test harness encodes equivalent rows locally because the fixture
carries free-form ``expect`` blobs rather than machine-checkable assertions.

Semantics enforced here (lazy-series shared contract v1.3.0):

- ``execution_intent`` (``plan_only`` | ``execute``) is persisted SEPARATELY
  from ``workflow_mode`` and the current stage. Default ``plan_only``.
- Plan-only invariant: explanation requests, quoted commands, explicit
  "plan only", a mere file edit, or an ambiguous "yes" with multiple pending
  questions can NEVER mutate product files and can NEVER set ``execute``.
  Only an explicit later execution request flips intent to ``execute``.
- Missing host hook support: detect the absent hook and offer the explicit
  entry route with an ACCURATE status (``pending``, never ``PASS``). No silent
  automatic claim.
- Duplicate host events must not duplicate dispatch: dispatch is idempotent and
  keyed on event identity.
- Resume: select the single compatible run, or ask only when genuinely ambiguous.
"""
from __future__ import annotations

import re
from typing import Final, NamedTuple

# --- patterns (kept in-repo style, borrowing the runtime action vocabulary) ---

EXPLICIT_START_WORKFLOW: Final = re.compile(
    r"/?lazy-start-work\b", re.I
)
EXPLICIT_PLAN_WORKFLOW: Final = re.compile(
    r"/?lazy-ulw-plan\b", re.I
)
PLAN_ONLY_PATTERN: Final = re.compile(
    r"\b(?:plan only|plan-only|do not implement|don'?t implement|"
    r"do not code|don'?t code|do not build|only plan|just plan|"
    r"no implementation|without implementing)\b", re.I
)
EXPLANATION_PATTERN: Final = re.compile(
    r"\b(?:explain|describe|discuss|summarise|summarize|how (?:does|do|to)|"
    r"what (?:is|are)|why (?:does|do|is))\b", re.I
)
QUOTED_COMMAND_PATTERN: Final = re.compile(
    r"(?:show|give|provide|print|display|here'?s|here is)\b[^.?!;\n]*"
    r"\b(?:the )?(?:command|script|snippet|example|query)\b", re.I
)
ACTION_PATTERN: Final = re.compile(
    r"\b(?:add|analyze|audit|build|change|configure|correct|create|debug|deploy|"
    r"diagnose|export|fix|implement|install|investigate|migrate|plan|publish|"
    r"refactor|release|remove|rename|resume|review|send|setup|simplify|streamline|"
    r"test|update|upload|use|validate)\b", re.I
)
COMPLEX_PATTERN: Final = re.compile(
    r"\b(?:build|team|approval|report|billing|multi|integration|platform|"
    r"service|dashboard|pipeline|system|tracker)\b", re.I
)
# An ambiguous bare acknowledgement with no actionable instruction cannot grant
# execution authority on its own when there are pending questions.
AMBIGUOUS_ACK_PATTERN: Final = re.compile(
    r"^\s*(?:yes|ok|okay|sure|sounds good|go ahead|proceed|do it|"
    r"just do it|make it so)\s*[.!?]*\s*$", re.I
)

EXECUTION_INTENTS: Final = ("plan_only", "execute")
ROUTES: Final = ("explicit-execution", "automatic-activation")
TIERS: Final = ("small", "medium", "complex")


class RouteDecision(NamedTuple):
    route: str
    execution_intent: str
    tier: str | None
    executes_code: bool
    mutates_product_files: bool
    hook_status: str
    note: str


def _has_action_verb(request: str) -> bool:
    return ACTION_PATTERN.search(request) is not None


def _is_explicit_start(request: str) -> bool:
    return EXPLICIT_START_WORKFLOW.search(request) is not None


def _is_plan_only_request(request: str) -> bool:
    if EXPLICIT_PLAN_WORKFLOW.search(request) is not None:
        return True
    if PLAN_ONLY_PATTERN.search(request) is not None:
        return True
    # Pure explanation / "show me the command" requests never execute.
    if EXPLANATION_PATTERN.search(request) is not None and not _has_action_verb(request):
        return True
    if QUOTED_COMMAND_PATTERN.search(request) is not None and not _has_action_verb(request):
        return True
    return False


def _classify_tier(request: str) -> str:
    if COMPLEX_PATTERN.search(request) is not None:
        return "complex"
    # A short, localized action verb request is small; otherwise medium.
    if _has_action_verb(request) and len(request.split()) <= 8:
        return "small"
    return "medium"


def classify_request_route(
    request: str,
    *,
    hook_supported: bool = True,
    has_plan: bool = True,
) -> RouteDecision:
    """Classify a single user request into a route + execution intent.

    Faithful to behaviors a/b of the v1.3.0 contract:

    - ``/lazy-start-work`` is an execution instruction (explicit-execution,
      ``execute``). It does not, by itself, authorize unrelated publish/spend/
      trust/destructive actions — those still pass through the existing
      approval gates in the policy layer.
    - A clear natural-language implementation request selects a workflow
      automatically and executes within authorized scope (automatic-activation,
      ``execute``). No slash command is required.
    - Explanation, quoted commands, explicit "plan only", a mere file edit, or
      an ambiguous acknowledgement with pending questions are ``plan_only`` and
      MUST NOT mutate product files or set ``execute``.
    """
    request = request or ""
    hook_status = "supported" if hook_supported else "pending"

    explicit_start = _is_explicit_start(request)
    plan_only_request = _is_plan_only_request(request)

    if explicit_start:
        # Explicit execution entry. Intent is execute; the policy/approval
        # gates still gate consequential scope.
        return RouteDecision(
            route="explicit-execution",
            execution_intent="execute",
            tier=None,
            executes_code=True,
            mutates_product_files=True,
            hook_status=hook_status,
            note="explicit /lazy-start-work execution entry",
        )

    if plan_only_request:
        return RouteDecision(
            route="automatic-activation",
            execution_intent="plan_only",
            tier=None,
            executes_code=False,
            mutates_product_files=False,
            hook_status=hook_status,
            note="plan-only request: no product mutation, no execute",
        )

    if not _has_action_verb(request):
        # No actionable verb: a quoted example, a mere file path edit, or an
        # ambiguous acknowledgement cannot grant execution authority.
        return RouteDecision(
            route="automatic-activation",
            execution_intent="plan_only",
            tier=None,
            executes_code=False,
            mutates_product_files=False,
            hook_status=hook_status,
            note="no actionable instruction: cannot grant execution authority",
        )

    # Clear natural-language implementation request: automatic activation that
    # executes within authorized scope. No slash command required.
    tier = _classify_tier(request)
    return RouteDecision(
        route="automatic-activation",
        execution_intent="execute",
        tier=tier,
        executes_code=True,
        mutates_product_files=True,
        hook_status=hook_status,
        note="clear implementation request: automatic activation, in-scope execute",
    )


def detect_hook_support(host_context: dict | None = None) -> bool:
    """Detect whether the host provides prompt-submit hook support.

    Returns ``True`` when a host hook is observed, ``False`` (missing support)
    when the host does not advertise the hook. The caller must then fall back
    to the explicit entry route with an ACCURATE (``pending``) status and must
    NOT make a silent automatic claim (behavior b, S14).
    """
    if not isinstance(host_context, dict):
        # No host context observed -> assume unsupported (fail safe, accurate).
        return False
    # A host advertises hook support via a capability/observation flag.
    if host_context.get("hook_support") is True:
        return True
    if host_context.get("hook_support") is False:
        return False
    # Legacy/observational signal: the runtime recorded a prompt-submit hook.
    observed = host_context.get("observed_hooks")
    if isinstance(observed, list) and "UserPromptSubmit" in observed:
        return True
    # Absent => unsupported. Never silently claim support.
    return False


def event_identity(
    session_id: str | None,
    request_digest: str,
    run_id: str | None = None,
) -> str:
    """Stable identity for a host prompt event, used for idempotent dispatch."""
    sid = session_id or "no-session"
    rid = run_id or "no-run"
    return f"{sid}|{rid}|{request_digest}"


def is_duplicate_event(seen: set[str], identity: str) -> bool:
    """Return True if this event identity was already dispatched (idempotency)."""
    if not isinstance(seen, set):
        raise TypeError("seen must be a set")
    return identity in seen


def mark_event_dispatched(seen: set[str], identity: str) -> None:
    """Record an event identity as dispatched (idempotent — no-op if present)."""
    if not isinstance(seen, set):
        raise TypeError("seen must be a set")
    seen.add(identity)


def select_resume_candidate(
    candidates: list[dict],
    session_id: str | None = None,
) -> dict | None:
    """Select the single compatible run for resume, or None when ambiguous.

    Behavior (T2 #6): when exactly one candidate matches the current session
    identity, return it. When multiple compatible candidates exist (genuinely
    ambiguous), return ``None`` so the caller ASKS rather than guessing.
    """
    if not isinstance(candidates, list):
        raise TypeError("candidates must be a list")
    if not candidates:
        return None
    compatible = [
        candidate
        for candidate in candidates
        if isinstance(candidate, dict)
        and candidate.get("session_id") in (session_id, None)
    ]
    if len(compatible) == 1:
        return compatible[0]
    # Zero or many => ambiguous (or nothing compatible). Let the caller ask.
    if not compatible and candidates:
        return None
    return None
