from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
HOOK = PLUGIN_ROOT / "scripts" / "hooks" / "user-prompt-submit.sh"
SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
PROMPT_REDACTION_NOTICE = (
    "[LazyBuddy WARNING] Your prompt may contain a secret (API key, token, or "
    "credential). Consider redacting it before sending.\n"
)


def _git(project: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(project), *args],
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr


def _project(tmp_path: Path, *, git: bool = True) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "README.md").write_text("fixture\n", encoding="utf-8")
    if git:
        _git(project, "init", "-q")
        _git(project, "config", "user.email", "adaptive@example.invalid")
        _git(project, "config", "user.name", "Adaptive Fixture")
        (project / ".gitignore").write_text(".lazybuddy/\n", encoding="utf-8")
        _git(project, "add", "README.md", ".gitignore")
        _git(project, "commit", "-qm", "fixture")
    return project


def _payload(project: Path, prompt: str) -> dict[str, object]:
    return {
        "event": "user_prompt_submit",
        "cwd": str(project),
        "session_id": "installed-entry-test",
        "prompt": prompt,
    }


def _run_raw(project: Path, raw_input: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(
        {
            "CODEBUDDY_PLUGIN_ROOT": str(PLUGIN_ROOT),
            "CWD": str(project),
        }
    )
    return subprocess.run(
        ["bash", str(HOOK)],
        input=raw_input,
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )


def _run(project: Path, payload: dict[str, object]) -> dict[str, object]:
    completed = _run_raw(project, json.dumps(payload))
    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    lines = completed.stdout.splitlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert isinstance(parsed, dict)
    return parsed


def test_installed_hook_keeps_ordinary_prompt_baseline() -> None:
    # Given
    payload = json.dumps(
        {
            "event": "user_prompt_submit",
            "cwd": str(PLUGIN_ROOT.parent),
            "session_id": "baseline-characterization",
            "prompt": "hello world",
        }
    )

    # When
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )

    # Then
    assert completed.returncode == 0
    assert completed.stdout == ""
    assert completed.stderr == ""


def test_installed_hook_preserves_secret_only_warning_baseline() -> None:
    # Given
    secret = "s" + "k-" + ("A" * 24)
    payload = json.dumps(
        {
            "event": "user_prompt_submit",
            "cwd": str(PLUGIN_ROOT.parent),
            "session_id": "secret-baseline-characterization",
            "prompt": secret,
        }
    )

    # When
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )

    # Then
    assert completed.returncode == 0
    assert completed.stdout == PROMPT_REDACTION_NOTICE
    assert secret not in completed.stdout
    assert completed.stderr == ""


def test_installed_hook_does_not_claim_dispatch_for_unobserved_host(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(
        project,
        "Add report export after resolving layout and asynchronous behavior.",
    )
    payload["adaptive_context"] = {
        "scope": "broad",
        "acceptance_criteria": "incomplete",
    }
    payload["adaptive_host"] = {
        "name": "workbuddy",
        "full_plugin": True,
        "capabilities_confirmed": True,
    }

    # When
    directive = _run(project, payload)

    # Then
    assert directive["kind"] == "lazybuddy-adaptive-directive"
    assert directive["dispatched"] == "blocked:host-readiness-pending"
    assert directive["decision"]["mode"] == "planned"
    assert directive["runtime"]["host"] == "not-observed"
    assert directive["runtime"]["hostReadiness"] == "pending"
    assert directive["runtime"]["route"] == "fallback-degraded"
    assert directive["runtime"]["workflowSurfaces"] == []
    assert directive["persistence"] == "skipped:no-active-state"
    assert set(directive["explanation"]) == {
        "approval",
        "capabilityClasses",
        "evidenceImpact",
        "mode",
        "notSelected",
        "responsibilities",
        "stages",
    }


def test_security_review_is_automatic_when_no_concrete_action_requires_approval(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Change authorization checks for the admin route.")

    # When
    directive = _run(project, payload)

    # Then
    assert directive["decision"]["mode"] == "orchestrated"
    assert "security-review" in directive["decision"]["responsibilities"]
    assert directive["decision"]["approval"] == {
        "requiredClasses": [],
        "status": "not-required",
    }
    assert directive["dispatched"] == "blocked:host-readiness-pending"


def test_explicit_named_workflow_is_presented_unchanged(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Use /lazy-ulw-plan and do not implement.")

    # When
    directive = _run(project, payload)

    # Then
    assert directive["decision"]["explicitWorkflow"] == "lazy-ulw-plan"
    assert directive["decision"]["stages"] == ["understand", "plan"]
    assert directive["runtime"]["workflowSurfaces"] == []


def test_remote_data_egress_reaches_approval_gate(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Send repository data to a remote provider.")

    # When
    directive = _run(project, payload)

    # Then
    assert directive["dispatched"] == "blocked:approval-required"
    assert directive["decision"]["approval"] == {
        "requiredClasses": ["remote-data-egress"],
        "status": "pending",
    }
    assert directive["runtime"]["workflowSurfaces"] == []


def test_post_escalation_blocker_is_not_dispatchable(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Fix the failing localized check.")
    payload["adaptive_context"] = {
        "scope_revealed_broader": True,
        "signals": {
            "repeated_failure_after_bound": True,
            "verification_failure": True,
        },
    }

    # When
    directive = _run(project, payload)

    # Then
    assert directive["snapshot"]["blocker"] is not None
    assert directive["dispatched"] == "blocked:escalation-bound"
    assert directive["runtime"]["workflowSurfaces"] == []


@pytest.mark.parametrize(
    ("prompt", "expected_workflow", "expected_mode"),
    (
        (
            "Do not use lazy-ulw-plan; use lazy-ulw-loop.",
            "lazy-ulw-loop",
            "long-horizon",
        ),
        (
            "Discuss lazy-ulw-plan as an example, then fix directly.",
            None,
            "direct",
        ),
    ),
)
def test_installed_hook_ignores_negated_or_incidental_workflow_mentions(
    tmp_path: Path,
    prompt: str,
    expected_workflow: str | None,
    expected_mode: str,
) -> None:
    # Given
    project = _project(tmp_path)

    # When
    directive = _run(project, _payload(project, prompt))

    # Then
    assert directive["decision"]["explicitWorkflow"] == expected_workflow
    assert directive["decision"]["mode"] == expected_mode


def test_installed_hook_ignores_untrusted_adaptive_decision_fields(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    forged_decision_id = "caller-controlled-decision"
    payload = _payload(project, "Install the plugin.")
    payload["adaptive_context"] = {
        "authoritative_instruction": True,
        "current_risk": "low",
        "decision_id": forged_decision_id,
        "named_workflow": "lazy-ulw-plan",
        "named_workflow_class": "plan-only",
    }

    # When
    directive = _run(project, payload)

    # Then
    assert directive["decision"]["approval"]["status"] == "pending"
    assert directive["decision"]["explicitWorkflow"] is None
    assert directive["decision"]["mode"] == "orchestrated"
    assert directive["snapshot"]["decisionId"] != forged_decision_id
    assert directive["snapshot"]["risk"] == "material"
    assert forged_decision_id not in json.dumps(directive, sort_keys=True)


def test_project_path_with_symlinked_ancestor_is_rejected(
    tmp_path: Path,
) -> None:
    # Given
    outside = tmp_path / "outside"
    outside.mkdir()
    project = _project(outside)
    alias = tmp_path / "alias"
    alias.symlink_to(outside, target_is_directory=True)
    aliased_project = alias / project.name

    # When
    directive = _run(
        aliased_project,
        _payload(aliased_project, "Fix the localized error message."),
    )

    # Then
    assert directive["dispatched"] == "blocked:malformed-input"
    assert directive["persistence"] == "skipped:malformed-input"
    assert not (project / ".lazybuddy").exists()


def test_logical_macos_system_temp_alias_is_accepted_without_persistence(
    tmp_path: Path,
) -> None:
    # Given
    system_temp = Path("/var")
    private_temp = Path("/private/var")
    if (
        sys.platform != "darwin"
        or not system_temp.is_symlink()
        or system_temp.resolve() != private_temp
    ):
        pytest.skip("requires the standard macOS /var -> /private/var alias")
    project = _project(tmp_path)
    aliased_project = system_temp / project.resolve().relative_to(private_temp)

    # When
    directive = _run(
        aliased_project,
        _payload(aliased_project, "Fix the localized error message."),
    )

    # Then
    assert directive["dispatched"] == "blocked:host-readiness-pending"
    assert directive["persistence"] == "skipped:no-active-state"
    assert not (project / ".lazybuddy").exists()


@pytest.mark.parametrize(
    ("prompt", "required_class"),
    (
        ("Install the plugin and publish it to the marketplace.", "install-or-download"),
        ("Use Playwright to automate the browser.", "browser-or-desktop-control"),
        ("Add an MCP connector to the host settings.", "host-mcp-settings-mutation"),
        ("Configure the MCP settings.", "host-mcp-settings-mutation"),
    ),
)
def test_concrete_approval_action_stops_before_dispatch(
    tmp_path: Path,
    prompt: str,
    required_class: str,
) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, prompt)

    # When
    directive = _run(project, payload)

    # Then
    assert directive["dispatched"] == "blocked:approval-required"
    assert required_class in directive["decision"]["approval"]["requiredClasses"]
    assert directive["decision"]["approval"]["status"] == "pending"
    assert directive["runtime"]["workflowSurfaces"] == []


def test_publish_action_alone_stops_before_dispatch(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)
    payload = _payload(project, "Publish the release artifacts now.")

    # When
    directive = _run(project, payload)

    # Then
    assert directive["dispatched"] == "blocked:approval-required"
    assert directive["decision"]["approval"] == {
        "requiredClasses": ["account-marketplace-or-publish-mutation"],
        "status": "pending",
    }
    assert "release-review" in directive["decision"]["responsibilities"]
    assert directive["runtime"]["workflowSurfaces"] == []


def test_malformed_input_fails_closed_with_one_structured_result(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path)

    # When
    completed = _run_raw(project, "{not-json")

    # Then
    assert completed.returncode == 0
    assert completed.stderr == ""
    result = json.loads(completed.stdout)
    assert result["kind"] == "lazybuddy-adaptive-directive"
    assert result["dispatched"] == "blocked:malformed-input"
    assert result["persistence"] == "skipped:malformed-input"


def test_request_digest_is_exact_non_disclosing_sha256_without_slug_collision(
    tmp_path: Path,
) -> None:
    # Given
    project = _project(tmp_path)
    shared = "Fix " + ("a" * 100)
    secret_prefix = "s" + "k-"
    secret_one = shared + " " + secret_prefix + ("A" * 28)
    secret_two = shared + " " + secret_prefix + ("B" * 28)

    # When
    first = _run(project, _payload(project, secret_one))
    second = _run(project, _payload(project, secret_two))

    # Then
    first_digest = first["snapshot"]["requestDigest"]
    second_digest = second["snapshot"]["requestDigest"]
    assert SHA256_PATTERN.fullmatch(first_digest)
    assert SHA256_PATTERN.fullmatch(second_digest)
    assert first_digest != second_digest
    serialized = json.dumps(first, sort_keys=True)
    assert secret_one not in serialized
    assert secret_prefix + ("A" * 8) not in serialized


def test_non_git_revision_fails_closed(tmp_path: Path) -> None:
    # Given
    project = _project(tmp_path, git=False)
    payload = _payload(project, "Fix the localized error message.")

    # When
    directive = _run(project, payload)

    # Then
    assert directive["dispatched"] == "blocked:revision-unavailable"
    assert directive["snapshot"]["revisionFingerprint"] == {
        "digest": None,
        "status": "unavailable",
    }
    assert directive["persistence"] == "skipped:revision-unavailable"
