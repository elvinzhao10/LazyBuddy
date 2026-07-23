from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
TOOLING_DIR = PLUGIN_ROOT / "tooling"
HOOK = PLUGIN_ROOT / "scripts" / "hooks" / "user-prompt-submit.sh"
sys.path.insert(0, str(TOOLING_DIR))

from lazybuddy_adaptive_detector import classify_adaptive_decision  # noqa: E402


NAMED_WORKFLOWS = (
    ("lazy-init-deep", "assisted", ["lazy-init-deep"]),
    ("lazy-start-work", "assisted", ["lazy-start-work"]),
    ("lazy-ulw-plan", "planned", ["lazy-ulw-plan"]),
    ("lazy-review-work", "orchestrated", ["lazy-review-work"]),
    ("lazy-ulw-loop", "long-horizon", ["lazy-ulw-loop"]),
    ("lazy-ultrawork", "orchestrated", ["lazy-ultrawork"]),
    ("lazy-verifier", "direct", ["lazy-verifier"]),
)
NAMED_EXECUTION_WORKFLOWS = (
    ("lazy-start-work", "assisted"),
    ("lazy-review-work", "orchestrated"),
    ("lazy-ulw-loop", "long-horizon"),
    ("lazy-ultrawork", "orchestrated"),
)
EQUIVALENT_RISK_REQUEST = (
    "Install a provider and upload this repository to a remote service."
)


def _git(project: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(project), *args],
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "README.md").write_text("fixture\n", encoding="utf-8")
    (project / ".gitignore").write_text(".lazybuddy/\n", encoding="utf-8")
    _git(project, "init", "-q")
    _git(project, "config", "user.email", "adaptive@example.invalid")
    _git(project, "config", "user.name", "Adaptive Fixture")
    _git(project, "add", "README.md", ".gitignore")
    _git(project, "commit", "-qm", "fixture")
    return project


def _installed_hook(project: Path, prompt: str) -> dict[str, object]:
    environment = os.environ.copy()
    environment.update(
        {
            "CODEBUDDY_PLUGIN_ROOT": str(PLUGIN_ROOT),
            "CWD": str(project),
        }
    )
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=json.dumps(
            {
                "event": "user_prompt_submit",
                "cwd": str(project),
                "prompt": prompt,
                "session_id": "explicit-parity-test",
            }
        ),
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    lines = completed.stdout.splitlines()
    assert len(lines) == 1
    directive = json.loads(lines[0])
    assert isinstance(directive, dict)
    return directive


@pytest.mark.parametrize(
    ("workflow", "expected_mode", "expected_surfaces"),
    NAMED_WORKFLOWS,
)
def test_installed_hook_keeps_bare_named_workflow_authoritative(
    tmp_path: Path,
    workflow: str,
    expected_mode: str,
    expected_surfaces: list[str],
) -> None:
    # Given
    project = _project(tmp_path)

    # When
    directive = _installed_hook(project, workflow)

    # Then
    assert directive["decision"]["explicitWorkflow"] == workflow
    assert directive["decision"]["mode"] == expected_mode
    assert expected_surfaces == [workflow]
    assert directive["runtime"]["workflowSurfaces"] == []
    assert directive["runtime"]["hostReadiness"] == "pending"
    if workflow == "lazy-ulw-plan":
        assert directive["decision"]["stages"] == ["understand", "plan"]


def test_equivalent_installation_and_egress_request_has_shared_risk_policy() -> None:
    # Given/When
    decision = classify_adaptive_decision(EQUIVALENT_RISK_REQUEST)

    # Then
    assert decision["mode"] == "orchestrated"
    assert decision["approval_classes"] == [
        "install-or-download",
        "remote-data-egress",
    ]
    assert decision["approval_required"] is True


def test_same_clause_explicit_workflow_replacement_selects_affirmative_workflow() -> None:
    # Given
    prompt = "Do not use lazy-ulw-plan, use lazy-ulw-loop instead."

    # When
    decision = classify_adaptive_decision(prompt)

    # Then
    assert decision["explicitWorkflow"] == "lazy-ulw-loop"
    assert decision["mode"] == "long-horizon"
    assert decision["stages"] == ["understand", "plan", "implement", "verify", "continue"]


@pytest.mark.parametrize(
    ("workflow", "expected_mode"),
    NAMED_EXECUTION_WORKFLOWS,
)
def test_named_execution_workflow_retains_structured_execution_semantics(
    workflow: str,
    expected_mode: str,
) -> None:
    # Given/When
    decision = classify_adaptive_decision(workflow)

    # Then
    assert decision["explicitWorkflow"] == workflow
    assert decision["mode"] == expected_mode
    assert "implement" in decision["stages"]
    assert "implementation" in decision["responsibilities"]
    assert "verify" in decision["stages"]
    assert isinstance(decision["snapshot"]["nextAction"], str)
    assert decision["snapshot"]["nextAction"]
    assert decision["reasons"]


def test_multi_session_request_preserves_structured_continuation_semantics() -> None:
    # Given/When
    decision = classify_adaptive_decision(
        "Migrate authentication across five sessions.",
        {"session_scope": "multi-session"},
    )

    # Then
    assert decision["mode"] == "long-horizon"
    assert "continue" in decision["stages"]
    assert "continuity" in decision["responsibilities"]
    assert isinstance(decision["snapshot"]["nextAction"], str)
    assert decision["snapshot"]["nextAction"]
    assert decision["reasons"]


def test_named_workflow_approval_boundary_is_structured_and_pending() -> None:
    # Given/When
    decision = classify_adaptive_decision(
        "Use lazy-ulw-loop to install the plugin.",
    )

    # Then
    assert decision["approval_classes"] == ["install-or-download"]
    assert decision["approval"] == {
        "requiredClasses": ["install-or-download"],
        "status": "pending",
    }
    assert decision["authority_boundary"]["approval_required"] == [
        "install-or-download"
    ]
    assert isinstance(decision["snapshot"]["nextAction"], str)
    assert decision["snapshot"]["nextAction"]
