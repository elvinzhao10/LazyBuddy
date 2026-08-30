from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import TypedDict

import pytest


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
HOOK = PLUGIN_ROOT / "scripts" / "hooks" / "user-prompt-submit.sh"
MAX_HOOK_INPUT_BYTES = 1024 * 1024


class HookDecision(TypedDict):
    explicitWorkflow: str | None
    mode: str


class HookDirective(TypedDict):
    decision: HookDecision
    dispatched: str
    persistence: str


def _run_hook(project: Path, prompt: str) -> HookDirective:
    payload = json.dumps({"cwd": str(project), "prompt": prompt})
    environment = os.environ.copy()
    environment.update({"CODEBUDDY_PLUGIN_ROOT": str(PLUGIN_ROOT), "CWD": str(project)})
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    result = json.loads(completed.stdout)
    assert isinstance(result, dict)
    return result


@pytest.mark.parametrize(
    ("prompt", "expected_workflow", "expected_mode"),
    (
        (
            "Do not, under any circumstances whatsoever, use the `lazy-ulw-plan` "
            "workflow; fix the typo directly.",
            None,
            "direct",
        ),
        (
            "Please explain, in detail, the lazy-ulw-plan workflow as a reference; "
            "fix the typo directly.",
            None,
            "direct",
        ),
        ("Do not implement this change; use lazy-ulw-plan.", "lazy-ulw-plan", "planned"),
        ("Do not forget to use lazy-ulw-plan.", "lazy-ulw-plan", "planned"),
    ),
)
def test_hook_workflow_parser_respects_negation_incidental_and_affirmative_context(
    tmp_path: Path,
    prompt: str,
    expected_workflow: str | None,
    expected_mode: str,
) -> None:
    # Given: a real hook payload with a prompt containing a workflow mention.
    project = tmp_path / "project"
    project.mkdir()

    # When: the installed UserPromptSubmit hook parses the payload.
    directive = _run_hook(project, prompt)

    # Then: only an affirmative workflow mention controls adaptive mode.
    decision = directive["decision"]
    assert isinstance(decision, dict)
    assert decision["explicitWorkflow"] == expected_workflow
    assert decision["mode"] == expected_mode


def test_hook_rejects_oversized_input_without_retaining_or_echoing_prompt(
    tmp_path: Path,
) -> None:
    # Given: a valid-looking event whose encoded bytes exceed the intake bound.
    project = tmp_path / "project"
    project.mkdir()
    raw_marker = "RAW_OVERSIZED_LAZYBUDDY_HOOK_MARKER"
    payload = json.dumps({"cwd": str(project), "prompt": "fix " + raw_marker + "x" * MAX_HOOK_INPUT_BYTES})
    assert len(payload.encode("utf-8")) > MAX_HOOK_INPUT_BYTES
    environment = os.environ.copy()
    environment.update({"CODEBUDDY_PLUGIN_ROOT": str(PLUGIN_ROOT), "CWD": str(project)})

    # When: the hook receives the oversized event.
    completed = subprocess.run(
        ["bash", str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )

    # Then: it fails closed with the fixed directive and never discloses input.
    assert completed.returncode == 0
    directive = json.loads(completed.stdout)
    assert directive["dispatched"] == "blocked:malformed-input"
    assert directive["persistence"] == "skipped:malformed-input"
    assert raw_marker not in completed.stdout
    assert raw_marker not in completed.stderr


def _fake_validator(path: Path, output: str) -> None:
    path.write_text(
        "#!/bin/bash\nprintf '%s\\n' "
        + " ".join(repr(line) for line in output.splitlines())
        + "\n",
        encoding="utf-8",
    )
    path.chmod(0o755)


def _run_doctor(tmp_path: Path, output: str) -> subprocess.CompletedProcess[str]:
    plugin = tmp_path / "plugin"
    shutil.copytree(PLUGIN_ROOT, plugin)
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _fake_validator(fake_bin / "codebuddy", output)
    environment = os.environ.copy()
    environment.update(
        {
            "CODEBUDDY_PLUGIN_ROOT": str(plugin),
            "LAZYBUDDY_DOCTOR_HOST": "package",
            "LAZYBUDDY_HOST_VALIDATOR_TIMEOUT_SECONDS": "1",
            "PATH": f"{fake_bin}:{environment.get('PATH', '')}",
        },
    )
    return subprocess.run(
        [
            "bash",
            str(plugin / "scripts" / "lazybuddy-plugin-doctor.sh"),
            "--host-validator",
            str(fake_bin / "codebuddy"),
        ],
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )


def test_doctor_rejects_leading_failure_prose_before_valid_json(tmp_path: Path) -> None:
    # Given: a validator result wrapper marked pass but explicit failure prose precedes valid JSON.
    result = _run_doctor(
        tmp_path,
        "Validation failed: manifest rejected\n{\"valid\":true}",
    )

    # Then: the doctor must classify the validator as failed.
    assert result.returncode == 1
    assert "[FAIL] CodeBuddy manifest validator" in result.stdout
