"""Pytest tests for lazybuddy_adaptive_hosts.map_adaptive_decision_to_hosts.

Covers CodeBuddy full-plugin (no skills), WorkBuddy full-plugin (with skills),
orchestrator agent invocation for orchestrated/long-horizon modes, MCP server
resolution from capability classes, fallback degraded path, and invalid
decision error handling.
"""
import sys
from pathlib import Path

import pytest

TOOLING_DIR = Path(__file__).resolve().parent.parent / "tooling"
sys.path.insert(0, str(TOOLING_DIR))

from lazybuddy_adaptive_hosts import (  # noqa: E402
    ALL_MCP_SERVERS, CAPABILITY_TO_MCP, CODEBUDDY_LOADS_SKILLS,
    HOOKS_FILE, ORCHESTRATION_MODES, ORCHESTRATOR_AGENT, WORKBUDDY_LOADS_SKILLS,
    map_adaptive_decision_to_hosts)
from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402


def _decision_for_mode(mode):
    if mode == "direct":
        return classify_adaptive_decision("Fix typo", {})
    if mode == "assisted":
        return classify_adaptive_decision("Diagnose stale data",
                                          {"scope": "bounded", "file_count": 4})
    if mode == "planned":
        return classify_adaptive_decision("Add export feature",
                                          {"scope": "broad",
                                           "acceptance_criteria": "incomplete"})
    if mode == "orchestrated":
        return classify_adaptive_decision("Change auth logic",
                                          {"risk_signals": ["security"]})
    if mode == "long-horizon":
        return classify_adaptive_decision("Multi-session migration",
                                          {"session_scope": "multi-session"})
    raise ValueError(f"unknown mode: {mode}")


ALL_MODES = ["direct", "assisted", "planned", "orchestrated", "long-horizon"]


def test_constants_exposed():
    assert CODEBUDDY_LOADS_SKILLS is False  # CodeBuddy plugin.json lacks "skills"
    assert WORKBUDDY_LOADS_SKILLS is True   # WorkBuddy plugin.json declares "skills"
    assert ORCHESTRATOR_AGENT == "lazybuddy-orchestrator"
    assert set(ORCHESTRATION_MODES) == {"orchestrated", "long-horizon"}
    assert HOOKS_FILE == "hooks/hooks.json"
    assert "status-dashboard" in ALL_MCP_SERVERS


def test_returned_dict_has_three_routes():
    decision = _decision_for_mode("direct")
    hosts = map_adaptive_decision_to_hosts(decision)
    assert set(hosts.keys()) == {"codebuddy_full_plugin", "workbuddy_full_plugin",
                                 "skills_mcp_only_fallback"}


@pytest.mark.parametrize("mode", ALL_MODES)
def test_codebuddy_never_has_skills(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    cb = hosts["codebuddy_full_plugin"]
    assert cb["skills"] == [], f"CodeBuddy must not load skills for mode={mode}"


@pytest.mark.parametrize("mode", ALL_MODES)
def test_workbuddy_skills_match_workflows(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    wb = hosts["workbuddy_full_plugin"]
    # WorkBuddy skills should equal the workflow surfaces (same names).
    expected = {
        "direct": [], "assisted": ["lazy-start-work"],
        "planned": ["lazy-ulw-plan", "lazy-start-work"],
        "orchestrated": ["lazy-ulw-plan", "lazy-start-work", "lazy-reviewer"],
        "long-horizon": ["lazy-ulw-plan", "lazy-start-work", "lazy-ulw-loop"],
    }
    assert wb["skills"] == expected[mode]


@pytest.mark.parametrize("mode", ALL_MODES)
def test_commands_match_workflows_in_both_hosts(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    expected = {
        "direct": [], "assisted": ["lazy-start-work"],
        "planned": ["lazy-ulw-plan", "lazy-start-work"],
        "orchestrated": ["lazy-ulw-plan", "lazy-start-work", "lazy-reviewer"],
        "long-horizon": ["lazy-ulw-plan", "lazy-start-work", "lazy-ulw-loop"],
    }
    assert hosts["codebuddy_full_plugin"]["commands"] == expected[mode]
    assert hosts["workbuddy_full_plugin"]["commands"] == expected[mode]


@pytest.mark.parametrize("mode", ALL_MODES)
def test_orchestrator_agent_only_for_orchestration_modes(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    cb_agents = hosts["codebuddy_full_plugin"]["agents"]
    wb_agents = hosts["workbuddy_full_plugin"]["agents"]
    if mode in ORCHESTRATION_MODES:
        assert cb_agents == [ORCHESTRATOR_AGENT]
        assert wb_agents == [ORCHESTRATOR_AGENT]
    else:
        assert cb_agents == []
        assert wb_agents == []


@pytest.mark.parametrize("mode", ALL_MODES)
def test_full_plugin_routes_are_not_degraded(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    assert hosts["codebuddy_full_plugin"]["degraded"] is False
    assert hosts["codebuddy_full_plugin"]["route"] == "full-plugin"
    assert hosts["codebuddy_full_plugin"]["host_readiness"] == "pending"
    assert hosts["workbuddy_full_plugin"]["degraded"] is False
    assert hosts["workbuddy_full_plugin"]["route"] == "full-plugin"
    assert hosts["workbuddy_full_plugin"]["host_readiness"] == "pending"


@pytest.mark.parametrize("mode", ALL_MODES)
def test_full_plugin_routes_load_hooks(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    assert hosts["codebuddy_full_plugin"]["hooks"] == [HOOKS_FILE]
    assert hosts["workbuddy_full_plugin"]["hooks"] == [HOOKS_FILE]


@pytest.mark.parametrize("mode", ALL_MODES)
def test_fallback_is_explicitly_degraded(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    fb = hosts["skills_mcp_only_fallback"]
    assert fb["degraded"] is True
    assert fb["route"] == "fallback-degraded"
    assert fb["host"] == "skills-mcp-only"
    assert fb["host_readiness"] == "pending"
    assert "degraded_reason" in fb
    assert isinstance(fb["degraded_reason"], str)
    assert len(fb["degraded_reason"]) > 0


@pytest.mark.parametrize("mode", ALL_MODES)
def test_fallback_has_no_commands_agents_hooks(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    fb = hosts["skills_mcp_only_fallback"]
    assert fb["commands"] == []
    assert fb["agents"] == []
    assert fb["hooks"] == []
    assert fb["orchestration_surface"] == "none"


@pytest.mark.parametrize("mode", ALL_MODES)
def test_fallback_skills_match_workflows(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    fb = hosts["skills_mcp_only_fallback"]
    expected = {
        "direct": [], "assisted": ["lazy-start-work"],
        "planned": ["lazy-ulw-plan", "lazy-start-work"],
        "orchestrated": ["lazy-ulw-plan", "lazy-start-work", "lazy-reviewer"],
        "long-horizon": ["lazy-ulw-plan", "lazy-start-work", "lazy-ulw-loop"],
    }
    assert fb["skills"] == expected[mode]


@pytest.mark.parametrize("mode", ALL_MODES)
def test_status_dashboard_always_in_mcp_servers(mode):
    decision = _decision_for_mode(mode)
    hosts = map_adaptive_decision_to_hosts(decision)
    assert "status-dashboard" in hosts["codebuddy_full_plugin"]["mcp_servers"]
    assert "status-dashboard" in hosts["workbuddy_full_plugin"]["mcp_servers"]
    assert "status-dashboard" in hosts["skills_mcp_only_fallback"]["mcp_servers"]


def test_orchestrated_mode_includes_verification_mcp():
    """Orchestrated capabilities include outcome-verification, which maps to verification MCP."""
    decision = _decision_for_mode("orchestrated")
    hosts = map_adaptive_decision_to_hosts(decision)
    assert "verification" in hosts["codebuddy_full_plugin"]["mcp_servers"]


def test_long_horizon_includes_run_ledger_mcp():
    """Long-horizon capabilities include task-state, which maps to run-ledger MCP."""
    decision = _decision_for_mode("long-horizon")
    hosts = map_adaptive_decision_to_hosts(decision)
    assert "run-ledger" in hosts["codebuddy_full_plugin"]["mcp_servers"]


def test_capability_to_mcp_map_covers_all_caps():
    expected_caps = {"text-search", "structural-search", "semantic-navigation",
                     "architecture-context", "documentation", "execution",
                     "task-state", "outcome-verification"}
    assert set(CAPABILITY_TO_MCP.keys()) == expected_caps


def test_invalid_decision_unknown_mode_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_hosts({"mode": "unknown"})
    assert "ADAPTIVE_HOSTS_INVALID_DECISION: unknown" in str(excinfo.value)


def test_invalid_decision_null_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_hosts(None)
    assert "ADAPTIVE_HOSTS_INVALID_DECISION: missing" in str(excinfo.value)


def test_invalid_decision_missing_mode_raises():
    with pytest.raises(ValueError) as excinfo:
        map_adaptive_decision_to_hosts({})
    assert "ADAPTIVE_HOSTS_INVALID_DECISION: missing" in str(excinfo.value)


def test_codebuddy_workbuddy_internal_names_can_differ():
    """CodeBuddy commands == workflow names; WorkBuddy skills == workflow names.

    The plugin does NOT require identical internal names between CodeBuddy
    and WorkBuddy; it requires that each host maps the canonical workflow
    surface name to its own resource type (commands vs skills).
    """
    decision = _decision_for_mode("planned")
    hosts = map_adaptive_decision_to_hosts(decision)
    cb = hosts["codebuddy_full_plugin"]
    wb = hosts["workbuddy_full_plugin"]
    # CodeBuddy has commands but no skills.
    assert cb["commands"] == ["lazy-ulw-plan", "lazy-start-work"]
    assert cb["skills"] == []
    # WorkBuddy has both skills and commands.
    assert wb["skills"] == ["lazy-ulw-plan", "lazy-start-work"]
    assert wb["commands"] == ["lazy-ulw-plan", "lazy-start-work"]
