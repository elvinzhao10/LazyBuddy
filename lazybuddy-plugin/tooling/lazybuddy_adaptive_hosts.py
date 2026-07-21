#!/usr/bin/env python3
"""Adaptive host mapping for v1.0.3 (LazyBuddy side).

Maps an adaptive decision to first-class CodeBuddy and WorkBuddy full-plugin
host resources per plan Section 10 and Section 18. Keeps Skills/MCP-only
fallback routing separate and explicitly degraded.

Structural difference: CodeBuddy's plugin.json does NOT declare a "skills"
field, so workflow surfaces map to commands+agents only. WorkBuddy's
plugin.json DOES declare "skills", so workflow surfaces also map to skills.
Internal names are NOT required to be identical between the two hosts.
"""
from __future__ import annotations
from typing import Any
from lazybuddy_adaptive_mapping import (KNOWN_MODES, MODE_SURFACES,
                                        map_adaptive_decision_to_surfaces)

# Agent invoked only when the mode requires orchestration or long-horizon
# continuation (single-writer rule for the adaptive snapshot).
ORCHESTRATOR_AGENT = "lazybuddy-orchestrator"
ORCHESTRATION_MODES = ("orchestrated", "long-horizon")

# All six declared MCP services in .mcp.json (loaded for full-plugin routes).
ALL_MCP_SERVERS = ("run-ledger", "verification", "status-dashboard",
                   "context-graph", "code-intel", "docs")
HOOKS_FILE = "hooks/hooks.json"

# CodeBuddy does NOT load skills (plugin.json lacks the "skills" field).
# WorkBuddy DOES load skills.
CODEBUDDY_LOADS_SKILLS = False
WORKBUDDY_LOADS_SKILLS = True

# Capability class -> MCP server (host-native capabilities have no MCP).
CAPABILITY_TO_MCP = {
    "semantic-navigation": ("lsp",),
    "architecture-context": ("context-graph", "code-intel"),
    "documentation": ("docs",),
    "task-state": ("run-ledger",),
    "outcome-verification": ("verification",),
    "execution": (),
    "text-search": (),
    "structural-search": (),
}
# Always include status-dashboard for status reporting regardless of mode.
ALWAYS_ON_MCP = ("status-dashboard",)


def _is_valid_decision(decision: Any) -> bool:
    if not isinstance(decision, dict):
        return False
    mode = decision.get("mode")
    if not isinstance(mode, str) or not mode:
        return False
    return mode in KNOWN_MODES


def _mcp_servers_for(decision: dict) -> list:
    """Resolve MCP servers from the decision's capability classes."""
    caps = decision.get("capabilities") or []
    if not isinstance(caps, list):
        caps = []
    servers: list = list(ALWAYS_ON_MCP)
    for cap in caps:
        if cap in CAPABILITY_TO_MCP:
            for server in CAPABILITY_TO_MCP[cap]:
                if server not in servers:
                    servers.append(server)
    # Sorted for deterministic output, with status-dashboard first.
    return [ALWAYS_ON_MCP[0]] + sorted(s for s in servers if s != ALWAYS_ON_MCP[0])


def _agents_for(decision: dict) -> list:
    """Orchestrated/long-horizon modes invoke the orchestrator agent."""
    if decision.get("mode") in ORCHESTRATION_MODES:
        return [ORCHESTRATOR_AGENT]
    return []


def _workflow_surfaces_for(decision: dict) -> list:
    """Pull workflow surfaces from the canonical MODE_SURFACES mapping."""
    mode = decision.get("mode")
    if mode not in MODE_SURFACES:
        return []
    return list(MODE_SURFACES[mode]["workflows"])


def _build_full_plugin_mapping(decision: dict, host: str, loads_skills: bool) -> dict:
    workflows = _workflow_surfaces_for(decision)
    commands = list(workflows)  # workflow surface name == command name in both hosts
    skills = list(workflows) if loads_skills else []
    agents = _agents_for(decision)
    mcp_servers = _mcp_servers_for(decision)
    return {
        "host": host,
        "route": "full-plugin",
        "degraded": False,
        "skills": skills,
        "commands": commands,
        "agents": agents,
        "hooks": [HOOKS_FILE],
        "mcp_servers": mcp_servers,
        "orchestration_surface": MODE_SURFACES[decision["mode"]]["orchestration"],
    }


def _build_fallback_mapping(decision: dict) -> dict:
    """Skills/MCP-only fallback for hosts that cannot load the full plugin.

    Explicitly degraded: no commands, agents, or hooks. Suitable for host
    environments that cannot consume the full plugin manifest (e.g., a host
    that only loads Skills and MCP servers but not commands/agents/hooks).
    This is NOT the product model for WorkBuddy; it is a degraded fallback.
    """
    workflows = _workflow_surfaces_for(decision)
    return {
        "host": "skills-mcp-only",
        "route": "fallback-degraded",
        "degraded": True,
        "degraded_reason": "Skills/MCP-only fallback; no commands, agents, or hooks loaded; "
                            "suitable for host environments that cannot load the full plugin manifest",
        "skills": list(workflows),
        "commands": [],
        "agents": [],
        "hooks": [],
        "mcp_servers": _mcp_servers_for(decision),
        "orchestration_surface": "none",
    }


def map_adaptive_decision_to_hosts(decision: dict) -> dict:
    """Map an adaptive decision to CodeBuddy and WorkBuddy full-plugin host resources.

    Returns a dict with three keys:
      - ``codebuddy_full_plugin``: full-plugin mapping for CodeBuddy (no skills,
        since CodeBuddy's plugin.json does not declare a "skills" field).
      - ``workbuddy_full_plugin``: full-plugin mapping for WorkBuddy (with skills,
        since WorkBuddy's plugin.json declares a "skills" field).
      - ``skills_mcp_only_fallback``: degraded fallback path that loads only
        Skills and MCP servers (no commands, agents, or hooks). Explicitly
        marked ``degraded=True``.

    Raises ValueError("ADAPTIVE_HOSTS_INVALID_DECISION: <mode>") when the input
    is null, missing a mode, or carries an unknown mode.
    """
    if not _is_valid_decision(decision):
        mode = (decision.get("mode") if isinstance(decision, dict) else None) or "missing"
        raise ValueError(f"ADAPTIVE_HOSTS_INVALID_DECISION: {mode}")
    # Reference the surface mapping for parity validation; result is not
    # returned directly but is used to ensure the decision is mappable.
    map_adaptive_decision_to_surfaces(decision)
    return {
        "codebuddy_full_plugin": _build_full_plugin_mapping(
            decision, host="codebuddy", loads_skills=CODEBUDDY_LOADS_SKILLS),
        "workbuddy_full_plugin": _build_full_plugin_mapping(
            decision, host="workbuddy", loads_skills=WORKBUDDY_LOADS_SKILLS),
        "skills_mcp_only_fallback": _build_fallback_mapping(decision),
    }
