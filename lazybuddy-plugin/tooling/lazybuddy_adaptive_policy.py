from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Final, NamedTuple


CONTRACT_PATH: Final = (
    Path(__file__).resolve().parent.parent
    / "contracts"
    / "adaptive-harness-contract.v1.json"
)
ALL_STAGES: Final = (
    "understand",
    "plan",
    "implement",
    "debug",
    "verify",
    "review",
    "continue",
)
ALL_RESPONSIBILITIES: Final = (
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
ALL_CAPABILITIES: Final = (
    "text-search",
    "structural-search",
    "semantic-navigation",
    "architecture-context",
    "documentation",
    "execution",
    "task-state",
    "outcome-verification",
)
EXPLICIT_WORKFLOWS: Final = (
    ("lazy-init-deep", "assisted"),
    ("lazy-ulw-plan", "planned"),
    ("lazy-start-work", "assisted"),
    ("lazy-review-work", "orchestrated"),
    ("lazy-ulw-loop", "long-horizon"),
    ("lazy-ultrawork", "orchestrated"),
    ("lazy-verifier", "direct"),
)
APPROVAL_PATTERNS: Final = (
    (
        "account-marketplace-or-publish-mutation",
        re.compile(
            r"\bpublish(?:\s+(?:the|these|those|our|my|this))?\s+"
            r"(?:release(?:\s+artifacts?)?|artifacts?|builds?|packages?|plugins?|version)\b|"
            r"\b(?:publish|mutate|change|add)(?:\s+\w+){0,4}\s+"
            r"(?:account|marketplace|external service)\b|"
            r"\b(?:account|marketplace|external service)(?:\s+\w+){0,4}\s+"
            r"(?:publish|mutate|change|add)\b",
            re.I,
        ),
    ),
    ("browser-or-desktop-control", re.compile(
        r"\b(?:control|click|open|automate)\s+(?:the\s+)?(?:browser|desktop)\b|\buse\s+playwright\b", re.I)),
    ("credentials-auth-or-paid-service", re.compile(r"\b(?:credential|api key|access token|deploy token|secret|log in|paid service)\b", re.I)),
    ("host-mcp-settings-mutation", re.compile(
        r"\b(?:add|change|edit|modify|configure)\s+(?:(?:an?|the)\s+)?(?:host|mcp|connector|settings?)\b", re.I)),
    ("install-or-download", re.compile(r"\b(?:install|download)\b", re.I)),
    ("persistent-capability", re.compile(r"\b(?:persist|enable permanently|keep installed)\b", re.I)),
    ("remote-data-egress", re.compile(
        r"\b(?:upload|send|export)\s+(?:(?:an?|the|this|that|our|my)\s+)?"
        r"(?:repo(?:sitory)?(?:\s+data)?|source|code|data)\s+(?:to|outside)\b|"
        r"\b(?:git\s+)?push\b.*\b(?:origin|remote|main|master|production)\b", re.I)),
)
NEGATION_PATTERN: Final = re.compile(
    r"\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,4}$",
    re.I,
)
WORKFLOW_NEGATION_PATTERN: Final = re.compile(
    r"\b(?:do\s+not|don't|never|avoid|without|skip|exclude|not)\b",
    re.I,
)
NEGATED_ACTION_PATTERN: Final = re.compile(
    r"\b(?:use|using|run|invoke|start|select|choose|enable|activate|apply|"
    r"follow|execute|load|call|mention|reference|describe|discuss|explain|"
    r"compare|include|recommend|pick)\b",
    re.I,
)
AFFIRMATIVE_WORKFLOW_ACTION_PATTERN: Final = re.compile(
    r"\b(?:use|using|run|invoke|start|select|choose|enable|activate|apply|"
    r"follow|execute)\b",
    re.I,
)
AFFIRMATIVE_NEGATION_PATTERN: Final = re.compile(
    r"\b(?:do\s+not|don't)\s+forget(?:\s+to)?\b|"
    r"\bnever\s+fail\s+to\b|\bwithout\s+fail\b",
    re.I,
)
INCIDENTAL_WORKFLOW_PREFIX: Final = re.compile(
    r"\b(?:describe|discuss|explain|mention|reference|compare|quote|"
    r"document|list)\b(?:\s+[a-z0-9'-]+){0,8}\s*$",
    re.I,
)
INCIDENTAL_WORKFLOW_SUFFIX: Final = re.compile(
    r"\b(?:only\s+)?as\s+(?:an?\s+)?(?:example|mention|reference|quote)\b",
    re.I,
)
WORKFLOW_MENTION_PATTERN: Final = re.compile(
    r"/?(lazy-(?:init-deep|review-work|start-work|ultrawork|ulw-loop|ulw-plan|verifier))\b",
    re.I,
)
RESPONSIBILITY_ORDER: Final = (
    "exploration",
    "planning",
    "debugging",
    "implementation",
    "verification",
    "quality-review",
    "security-review",
    "release-review",
    "continuity",
)


class PolicySelection(NamedTuple):
    capabilities: list[str]
    explicit_workflow: str | None
    mode: str
    responsibilities: list[str]
    stages: list[str]
    verification_level: str


@lru_cache(maxsize=1)
def _contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def contract_policy() -> dict:
    return _contract()


def approval_classes(text: str) -> list[str]:
    selected: list[str] = []
    for name, pattern in APPROVAL_PATTERNS:
        for match in pattern.finditer(text):
            prefix = text[max(0, match.start() - 64) : match.start()]
            if NEGATION_PATTERN.search(prefix) is None:
                selected.append(name)
                break
    return selected


def _normalise_workflow_context(text: str) -> str:
    return re.sub(r"[^a-z0-9']+", " ", text.lower()).strip()


def _clause_prefix(text: str, end: int) -> str:
    starts = [text.rfind(separator, 0, end) for separator in ".;!?\n"]
    return text[max(starts) + 1 : end]


def _clause_suffix(text: str, start: int) -> str:
    suffix = text[start:]
    return re.split(r"[.;!?\n]", suffix, maxsplit=1)[0]


def _is_negated_workflow(prefix: str) -> bool:
    normalised = _normalise_workflow_context(prefix)
    if AFFIRMATIVE_NEGATION_PATTERN.search(normalised):
        return False
    cue = WORKFLOW_NEGATION_PATTERN.search(normalised)
    if cue is None:
        return False
    return not normalised[cue.end() :].strip() or bool(
        NEGATED_ACTION_PATTERN.search(normalised[cue.end() :])
    )


def _is_incidental_workflow(prefix: str, suffix: str) -> bool:
    return bool(
        INCIDENTAL_WORKFLOW_PREFIX.search(_normalise_workflow_context(prefix))
        or INCIDENTAL_WORKFLOW_SUFFIX.search(_normalise_workflow_context(suffix))
    )


def _is_affirmative_replacement(text: str, mention_start: int) -> bool:
    mentions = list(WORKFLOW_MENTION_PATTERN.finditer(text, 0, mention_start))
    if not mentions:
        return False
    previous = mentions[-1]
    between = text[previous.end() : mention_start]
    if re.search(r"[.;!?\n]", between):
        return False
    return bool(
        AFFIRMATIVE_WORKFLOW_ACTION_PATTERN.search(between)
        and not _is_negated_workflow(between)
    )


def explicit_workflow(text: str) -> tuple[str, str] | None:
    modes = dict(EXPLICIT_WORKFLOWS)
    for mention in WORKFLOW_MENTION_PATTERN.finditer(text):
        prefix = _clause_prefix(text, mention.start())
        suffix = _clause_suffix(text, mention.end())
        negated = _is_negated_workflow(prefix)
        if (
            (negated and not _is_affirmative_replacement(text, mention.start()))
            or _is_incidental_workflow(prefix, suffix)
        ):
            continue
        workflow = mention.group(1).lower()
        return workflow, modes[workflow]
    return None


def _context_workflow(context: dict) -> tuple[str, str] | None:
    named = context.get("named_workflow")
    if isinstance(named, str):
        for workflow, mode in EXPLICIT_WORKFLOWS:
            if named == workflow:
                return workflow, mode
    workflow_class = context.get("named_workflow_class")
    signals = context.get("signals")
    explicitly_named = (
        context.get("authoritative_instruction") is True
        or isinstance(signals, dict)
        and signals.get("explicit_user_workflow") is True
    )
    if explicitly_named and workflow_class == "plan-only":
        return "lazy-ulw-plan", "planned"
    return None


def _risk_signals(text: str, context: dict) -> tuple[bool, bool, bool]:
    raw_signals = context.get("risk_signals")
    signals = raw_signals if isinstance(raw_signals, list) else []
    combined = " ".join(str(signal) for signal in signals)
    security = bool(re.search(r"security|authorization|permission", f"{text} {combined}", re.I))
    release = bool(re.search(r"release|publication|publish|deploy|version bump", f"{text} {combined}", re.I))
    workstreams = context.get("independent_workstreams")
    multiple = isinstance(workstreams, list) and len(workstreams) >= 2
    return security, release, multiple


def _selected_mode(text: str, context: dict) -> tuple[str, str | None]:
    explicit = explicit_workflow(text) or _context_workflow(context)
    if explicit is not None:
        return explicit[1], explicit[0]
    signals = context.get("signals")
    if isinstance(signals, dict) and signals.get("verification_failure") is True:
        return "assisted", None
    if (
        context.get("session_scope") == "multi-session"
        or context.get("checkpoint_requirement") == "durable"
        or re.search(r"multi-session|multiple sessions|durable checkpoint|long-horizon|across (?:the )?next (?:week|month)|over (?:the )?next (?:week|month)", text, re.I)
    ):
        return "long-horizon", None
    security, release, multiple = _risk_signals(text, context)
    if security or release or multiple or approval_classes(text):
        return "orchestrated", None
    if context.get("preferred_provider_unavailable") is True:
        return "assisted", None
    if (
        context.get("scope") == "broad"
        or context.get("acceptance_criteria") == "incomplete"
        or re.search(r"\brefactor\b.*\b(?:all|public|validation)\b", text, re.I)
    ):
        return "planned", None
    file_count = context.get("file_count", context.get("file_count_estimate", 0))
    if (
        context.get("scope") in ("bounded", "cross-file")
        or context.get("repository_familiarity") == "unfamiliar"
        or re.search(r"\binvestigate why\b", text, re.I)
        or isinstance(file_count, int) and 2 <= file_count <= 5
    ):
        return "assisted", None
    return "direct", None


def select_policy(text: str, context: dict) -> PolicySelection:
    mode, selected_workflow = _selected_mode(text, context)
    stale_material = context.get("stale_material", context.get("material_change"))
    if (
        selected_workflow is None
        and isinstance(stale_material, list)
        and stale_material
        and mode == "direct"
    ):
        mode = "assisted"
        selected_workflow = None
    config = _contract()["modes"][mode]
    stages = list(config["stages"])
    responsibilities = list(config["responsibilities"])
    capabilities = list(config["capabilities"])
    verification_level = config["verification_level"]
    explicit = explicit_workflow(text) or _context_workflow(context)
    plan_only = (
        explicit is not None
        and explicit[0] == "lazy-ulw-plan"
    )
    if plan_only:
        stages = ["understand", "plan"]
        responsibilities = ["exploration", "planning"]
        capabilities = [capability for capability in capabilities if capability != "execution"]
        verification_level = "targeted"
    security, release, _ = _risk_signals(text, context)
    if mode == "orchestrated":
        review_responsibilities = []
        if security:
            review_responsibilities.append("security-review")
        if release:
            review_responsibilities.append("release-review")
        selected = set(responsibilities + review_responsibilities)
        responsibilities = [
            responsibility
            for responsibility in RESPONSIBILITY_ORDER
            if responsibility in selected
        ]
    else:
        selected = set(responsibilities)
        responsibilities = [
            responsibility
            for responsibility in RESPONSIBILITY_ORDER
            if responsibility in selected
        ]
    return PolicySelection(
        capabilities=capabilities,
        explicit_workflow=selected_workflow,
        mode=mode,
        responsibilities=responsibilities,
        stages=stages,
        verification_level=verification_level,
    )


def escalation_history(context: dict) -> list[dict]:
    signals = context.get("signals")
    if not isinstance(signals, dict) or signals.get("verification_failure") is not True:
        return []
    history = [
        {
            "fromMode": "direct",
            "sequence": 1,
            "stageAdded": "debug",
            "toMode": "direct",
            "trigger": "verification-failure",
        }
    ]
    if context.get("scope_revealed_broader") is True:
        history.append(
            {
                "fromMode": "direct",
                "sequence": 2,
                "stageAdded": "understand",
                "toMode": "assisted",
                "trigger": "broader-scope-revealed",
            }
        )
    return history
