#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Final, NamedTuple

from lazybuddy_adaptive_detector import classify_adaptive_decision
from lazybuddy_adaptive_explanation import adaptive_explanation_fields
from lazybuddy_adaptive_fingerprint import (
    canonical_fingerprint,
    request_digest,
    revision_fingerprint,
)
from lazybuddy_adaptive_hosts import map_adaptive_decision_to_hosts
from lazybuddy_adaptive_state import (
    changed_fingerprint_material,
    persist_snapshot,
    resolve_active_state,
)


ACTION_PATTERN: Final = re.compile(
    r"\b(?:add|build|change|configure|correct|create|debug|deploy|diagnose|export|fix|implement|install|migrate|plan|publish|refactor|release|resume|review|send|setup|update|upload|use)\b|"
    r"/?lazy-(?:init-deep|review-work|start-work|ultrawork|ulw-loop|ulw-plan|verifier)\b",
    re.I,
)
SECRET_PATTERN: Final = re.compile(
    r"sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._/+=]{20,}|gh[pousr]_[A-Za-z0-9]{20,}"
)
MAX_HOOK_INPUT_BYTES: Final = 1024 * 1024
PROMPT_REDACTION_NOTICE: Final = (
    "[LazyBuddy WARNING] Your prompt may contain a secret (API key, token, or "
    "credential). Consider redacting it before sending."
)
SYSTEM_TEMP_ALIASES: Final[tuple[tuple[str, str], ...]] = (
    ("/var", "/private/var"),
    ("/tmp", "/private/tmp"),
)


class HookInput(NamedTuple):
    context: dict
    continuation_requested: bool
    host: dict
    project_root: Path
    prompt: str
    session_id: str | None


MATERIAL_FINGERPRINTS: Final = (
    "host",
    "profile",
    "probe",
    "binary",
    "session",
    "worktree",
    "mcp",
    "generated_asset",
    "marketplace",
)
STORED_FINGERPRINTS: Final = (*MATERIAL_FINGERPRINTS, "root", "revision")
BINDING_FIELDS: Final = {"session_id", "host", "worktree", "fingerprints"}
SHA256_PATTERN: Final = re.compile(r"^sha256:[0-9a-f]{64}$")


def _canonical_context(raw_context: dict) -> dict:
    context: dict = {}
    allowed_values = {
        "acceptance_criteria": {"incomplete"},
        "checkpoint_requirement": {"durable"},
        "repository_familiarity": {"unfamiliar"},
        "scope": {"bounded", "broad", "cross-file"},
        "session_scope": {"multi-session"},
    }
    for field, allowed in allowed_values.items():
        value = raw_context.get(field)
        if isinstance(value, str) and value in allowed:
            context[field] = value
    file_count = raw_context.get("file_count")
    if isinstance(file_count, int) and not isinstance(file_count, bool) and 2 <= file_count <= 5:
        context["file_count"] = file_count
    for field in (
        "preferred_provider_unavailable",
        "repeated_failure_after_bound",
        "scope_revealed_broader",
    ):
        if raw_context.get(field) is True:
            context[field] = True
    signals = raw_context.get("signals")
    if isinstance(signals, dict):
        selected_signals = {
            field: True
            for field in ("repeated_failure_after_bound", "verification_failure")
            if signals.get(field) is True
        }
        if selected_signals:
            context["signals"] = selected_signals
    workstreams = raw_context.get("independent_workstreams")
    if isinstance(workstreams, list) and len(workstreams) >= 2:
        context["independent_workstreams"] = ["workstream-1", "workstream-2"]
    risk_signals = raw_context.get("risk_signals")
    if isinstance(risk_signals, list):
        normalized_risk: list[str] = []
        combined = " ".join(
            value for value in risk_signals if isinstance(value, str)
        )
        if re.search(r"security|authorization|permission", combined, re.I):
            normalized_risk.append("security-sensitive")
        if re.search(r"release|publication|publish|deploy|version bump", combined, re.I):
            normalized_risk.append("release-or-publication")
        if normalized_risk:
            context["risk_signals"] = normalized_risk
    return context


def _blocked(reason: str) -> dict:
    return {
        "dispatched": f"blocked:{reason}",
        "kind": "lazybuddy-adaptive-directive",
        "persistence": f"skipped:{reason}",
    }


def _canonicalize_system_temp_alias(path: Path) -> Path:
    if sys.platform != "darwin":
        return path
    for logical_raw, canonical_raw in SYSTEM_TEMP_ALIASES:
        logical = Path(logical_raw)
        canonical = Path(canonical_raw)
        try:
            relative = path.relative_to(logical)
            if not logical.is_symlink() or logical.resolve(strict=True) != canonical:
                continue
            if any(parent.is_symlink() for parent in (canonical, *canonical.parents)):
                continue
        except (OSError, ValueError):
            continue
        return canonical / relative
    return path


def _parse_input(raw_input: str) -> HookInput | None:
    try:
        payload = json.loads(raw_input)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    prompt = payload.get("user_prompt") or payload.get("prompt") or payload.get("message")
    cwd = payload.get("cwd") or os.environ.get("CWD")
    context = payload.get("adaptive_context", {})
    host = payload.get("adaptive_host", {})
    if (
        not isinstance(prompt, str)
        or not prompt
        or not isinstance(cwd, str)
        or not isinstance(context, dict)
        or not isinstance(host, dict)
    ):
        return None
    raw_root = Path(cwd)
    try:
        if not raw_root.is_absolute() or ".." in raw_root.parts:
            return None
        safe_root = _canonicalize_system_temp_alias(raw_root)
        if any(path.is_symlink() for path in (safe_root, *safe_root.parents)):
            return None
        project_root = safe_root.resolve(strict=True)
    except OSError:
        return None
    if not project_root.is_dir():
        return None
    return HookInput(
        context=_canonical_context(context),
        continuation_requested=payload.get("continuation_requested") is True,
        host={},
        project_root=project_root,
        prompt=prompt,
        session_id=(
            payload.get("session_id")
            if isinstance(payload.get("session_id"), str)
            and 0 < len(payload["session_id"]) <= 256
            else None
        ),
    )


def _git_timeout() -> float:
    raw_value = os.environ.get("LAZYBUDDY_ADAPTIVE_GIT_TIMEOUT_SECONDS", "2")
    try:
        value = float(raw_value)
    except ValueError:
        return 2.0
    return min(max(value, 0.05), 5.0)


def _host_boundary() -> tuple[dict, bool, str]:
    material = {
        "capabilitiesConfirmed": False,
        "fullPlugin": False,
        "host": "not-observed",
        "reviewResponsibilitiesRequireApproval": False,
    }
    return material, False, "not-observed"


def _runtime_mapping(decision: dict, confirmed: bool, host_name: str) -> dict:
    routes = map_adaptive_decision_to_hosts(decision)
    if confirmed:
        route_key = f"{host_name}_full_plugin"
        selected = routes[route_key]
    else:
        selected = routes["skills_mcp_only_fallback"]
    workflow_surfaces = list(selected["commands"] or selected["skills"])
    explicit = decision.get("explicitWorkflow")
    if isinstance(explicit, str):
        workflow_surfaces = [explicit]
    if (
        not confirmed
        or decision["approval_required"]
        or isinstance(decision["snapshot"].get("blocker"), dict)
    ):
        workflow_surfaces = []
    return {
        "agents": list(selected["agents"]),
        "degraded": selected["degraded"],
        "hooks": list(selected["hooks"]),
        "host": host_name,
        "hostReadiness": selected["host_readiness"],
        "mcpServers": list(selected["mcp_servers"]),
        "route": selected["route"],
        "workflowSurfaces": workflow_surfaces,
    }


def _selected_binding_fingerprint(
    state: dict | None,
    session_id: str | None,
    fallback: str,
) -> tuple[str, bool]:
    if state is None:
        return fallback, True
    bindings = state.get("runtime_fingerprints")
    if bindings is None or bindings == []:
        return fallback, True
    if not isinstance(bindings, list) or session_id is None:
        return fallback, False
    selected = next(
        (
            binding
            for binding in bindings
            if isinstance(binding, dict)
            and binding.get("session_id") == session_id
        ),
        None,
    )
    if not isinstance(selected, dict):
        return fallback, False
    if set(selected) != BINDING_FIELDS:
        return fallback, False
    host = selected.get("host")
    worktree = selected.get("worktree")
    if (
        not isinstance(host, str)
        or not host
        or not isinstance(worktree, str)
        or not Path(worktree).is_absolute()
    ):
        return fallback, False
    fingerprints = selected.get("fingerprints")
    if not isinstance(fingerprints, dict) or set(fingerprints) != set(STORED_FINGERPRINTS):
        return fallback, False
    for name in STORED_FINGERPRINTS:
        value = fingerprints.get(name)
        if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
            return fallback, False
    material = {name: fingerprints[name] for name in MATERIAL_FINGERPRINTS}
    return canonical_fingerprint(material), True


def _decision_context(
    hook_input: HookInput,
    state: dict | None,
) -> tuple[dict, bool, str, bool]:
    host_material, confirmed, host_name = _host_boundary()
    context = dict(hook_input.context)
    fallback_fingerprint = canonical_fingerprint(host_material)
    host_fingerprint, binding_available = _selected_binding_fingerprint(
        state,
        hook_input.session_id,
        fallback_fingerprint,
    )
    context["host_fingerprint"] = host_fingerprint
    context["scope_fingerprint"] = canonical_fingerprint(
        {
            "acceptanceCriteria": context.get("acceptance_criteria"),
            "checkpointRequirement": context.get("checkpoint_requirement"),
            "decisionsToResolve": context.get("decisions_to_resolve"),
            "fileCount": context.get("file_count"),
            "independentWorkstreams": context.get("independent_workstreams"),
            "projectRoot": str(hook_input.project_root),
            "repositoryFamiliarity": context.get("repository_familiarity"),
            "scope": context.get("scope", "unspecified"),
            "scopeSignals": context.get("scope_signals"),
            "sessionScope": context.get("session_scope"),
        }
    )
    context["revision_fingerprint"] = revision_fingerprint(
        hook_input.project_root,
        timeout_seconds=_git_timeout(),
    ).as_dict()
    return context, confirmed, host_name, binding_available


def build_directive(hook_input: HookInput) -> dict:
    state_resolution = resolve_active_state(
        hook_input.project_root,
        request_digest(hook_input.prompt),
    )
    target = state_resolution.target
    target_state = target.state if target is not None else None
    context, confirmed, host_name, binding_available = _decision_context(
        hook_input,
        target_state,
    )
    decision = classify_adaptive_decision(hook_input.prompt, context)
    snapshot = decision["snapshot"]
    changed_material: list[str] = []
    continuation = "new"
    stale = False
    if target is not None:
        prior = target.state.get("adaptive")
        if isinstance(prior, dict):
            changed_material = changed_fingerprint_material(prior, snapshot)
            if changed_material:
                stale_context = dict(context)
                stale_context["stale_material"] = changed_material
                decision = classify_adaptive_decision(hook_input.prompt, stale_context)
                snapshot = decision["snapshot"]
                continuation = "stale-reclassified"
                stale = True
            else:
                resumed_context = dict(context)
                resumed_context["snapshot"] = prior
                decision = classify_adaptive_decision(hook_input.prompt, resumed_context)
                snapshot = decision["snapshot"]
                if snapshot["decisionId"] == prior.get("decisionId"):
                    continuation = "resumed"
                else:
                    changed_material = ["risk"]
                    continuation = "stale-reclassified"
                    stale = True
    revision = snapshot["revisionFingerprint"]
    runtime = _runtime_mapping(decision, confirmed, host_name)
    dispatched = (
        "presented-to-host"
        if confirmed
        else "blocked:host-readiness-pending"
    )
    if not binding_available:
        dispatched = "blocked:runtime-fingerprint-unavailable"
        persistence = "skipped:runtime-fingerprint-unavailable"
    elif revision["status"] != "available":
        dispatched = "blocked:revision-unavailable"
        persistence = "skipped:revision-unavailable"
    elif state_resolution.status == "unsafe-state-path":
        dispatched = "blocked:unsafe-state-path"
        persistence = "blocked:unsafe-state-path"
    elif decision["approval_required"]:
        dispatched = "blocked:approval-required"
        persistence = f"skipped:{state_resolution.status}" if target is None else f"persisted:{target.run_id}"
        if target is not None:
            persist_snapshot(target, snapshot)
    elif isinstance(snapshot.get("blocker"), dict):
        dispatched = "blocked:escalation-bound"
        persistence = f"skipped:{state_resolution.status}" if target is None else f"persisted:{target.run_id}"
        if target is not None:
            persist_snapshot(target, snapshot)
    elif stale:
        persistence = "skipped:stale-state-preserved"
    elif target is not None:
        persist_snapshot(target, snapshot)
        persistence = f"persisted:{target.run_id}"
    else:
        persistence = f"skipped:{state_resolution.status}"
    directive = {
        "changedMaterial": changed_material,
        "continuation": continuation,
        "decision": {
            "approval": decision["approval"],
            "explicitWorkflow": decision["explicitWorkflow"],
            "mode": decision["mode"],
            "responsibilities": decision["responsibilities"],
            "stages": decision["stages"],
            "verificationLevel": decision["verification_level"],
        },
        "dispatched": dispatched,
        "explanation": adaptive_explanation_fields(snapshot),
        "kind": "lazybuddy-adaptive-directive",
        "persistence": persistence,
        "runtime": runtime,
        "snapshot": snapshot,
    }
    if SECRET_PATTERN.search(hook_input.prompt):
        directive["inputWarning"] = "secret-like-content-redacted"
    return directive


def main() -> int:
    raw_input = sys.stdin.buffer.read(MAX_HOOK_INPUT_BYTES + 1)
    hook_input = None
    if len(raw_input) <= MAX_HOOK_INPUT_BYTES:
        try:
            hook_input = _parse_input(raw_input.decode("utf-8"))
        except UnicodeDecodeError:
            hook_input = None
    if hook_input is None:
        print(json.dumps(_blocked("malformed-input"), separators=(",", ":"), sort_keys=True))
        return 0
    secret_like = SECRET_PATTERN.search(hook_input.prompt) is not None
    if ACTION_PATTERN.search(hook_input.prompt) is None:
        if secret_like:
            print(PROMPT_REDACTION_NOTICE)
        return 0
    directive = build_directive(hook_input)
    print(json.dumps(directive, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
