from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
RUNNER = PLUGIN_ROOT / "scripts" / "lazybuddy-bounded-run.py"
BINDER = PLUGIN_ROOT / "scripts" / "state" / "bind-session.py"
CREATE_RUN = PLUGIN_ROOT / "scripts" / "state" / "create-run.sh"
VALIDATE_STATE = PLUGIN_ROOT / "scripts" / "state" / "validate-state.sh"


def run_git(repository: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(repository), *args],
        check=False,
        capture_output=True,
        timeout=5,
    )
    assert completed.returncode == 0, completed.stderr.decode(errors="replace")


def repository(tmp_path: Path) -> Path:
    root = tmp_path / "worktree"
    root.mkdir()
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "runtime@example.invalid")
    run_git(root, "config", "user.name", "Runtime Fixture")
    (root / "tracked.txt").write_text("base\n", encoding="utf-8")
    run_git(root, "add", "tracked.txt")
    run_git(root, "commit", "-qm", "fixture")
    return root


def create_state(project: Path) -> Path:
    environment = {**os.environ, "CWD": str(project)}
    completed = subprocess.run(
        ["bash", str(CREATE_RUN), "runtime", "runtime fixture"],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
        timeout=5,
    )
    assert completed.returncode == 0, completed.stderr
    return project / ".lazybuddy" / "runs" / "runtime" / "state.json"


def binding_command(
    state_file: Path,
    worktree: Path,
    executable: Path,
    root: Path,
    mcp: Path,
    asset: Path,
    probe: Path,
    *,
    host: str = "codebuddy-cli",
    marketplace: Path | None = None,
    profile: str = "direct",
    session_id: str = "session-exact",
) -> list[str]:
    command = [
        sys.executable,
        str(BINDER),
        "--state-file", str(state_file),
        "--host", host,
        "--profile", profile,
        "--session-id", session_id,
        "--worktree", str(worktree),
        "--root", str(root),
        "--executable", str(executable),
        "--mcp-file", str(mcp),
        "--asset-file", str(asset),
        "--probe-file", str(probe),
    ]
    if marketplace is not None:
        command.extend(("--marketplace-file", str(marketplace)))
    return command


def test_runner_records_explicit_artifacts_and_typed_outcomes(tmp_path: Path) -> None:
    # Given
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    stdin_file = tmp_path / "stdin.txt"
    stdin_file.write_text("prompt-shaped: $(touch should-not-run)\n", encoding="utf-8")
    result_file = tmp_path / "result.json"
    cwd_file = tmp_path / "cwd.txt"
    stdout_file = tmp_path / "stdout.txt"
    stderr_file = tmp_path / "stderr.txt"

    # When
    completed = subprocess.run(
        [
            sys.executable, str(RUNNER), "--label", "artifacts", "--timeout", "2",
            "--result-file", str(result_file), "--cwd", str(cwd),
            "--cwd-file", str(cwd_file), "--stdin-file", str(stdin_file),
            "--stdout-file", str(stdout_file), "--stderr-file", str(stderr_file),
            "--max-output-bytes", "1024", "--", "/bin/sh", "-c",
            "pwd; IFS= read -r line; printf '%s' \"$line\"; printf error >&2",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    # Then
    payload = json.loads(result_file.read_text(encoding="utf-8"))
    assert completed.returncode == 0
    assert payload["status"] == "pass"
    assert payload["reason"] == "ok"
    assert payload["artifacts"] == {
        "cwd": str(cwd_file), "stdin": str(stdin_file),
        "stdout": str(stdout_file), "stderr": str(stderr_file),
    }
    assert payload["executable"]["path"] == "/bin/sh"
    assert payload["executable"]["digest"].startswith("sha256:")
    assert cwd_file.read_text(encoding="utf-8") == f"{cwd}\n"
    assert stdout_file.read_text(encoding="utf-8") == f"{cwd}\nprompt-shaped: $(touch should-not-run)"
    assert stderr_file.read_text(encoding="utf-8") == "error"
    assert not (cwd / "should-not-run").exists()


@pytest.mark.parametrize(
    ("name", "extra_args", "command", "expected_status", "expected_reason", "expected_exit"),
    (
        ("failure", (), ("/bin/sh", "-c", "exit 7"), "fail", "exit_7", 7),
        ("unavailable", (), ("/definitely/missing",), "unavailable", "launch_error", 125),
        ("timeout", (), ("/bin/sh", "-c", "sleep 30"), "timeout", "deadline_exceeded", 124),
        ("flood", ("--max-output-bytes", "64"), (sys.executable, "-c", "print('x' * 4096)"), "fail", "output_limit_exceeded", 1),
    ),
)
def test_runner_preserves_typed_non_success_outcomes(
    tmp_path: Path, name: str, extra_args: tuple[str, ...], command: tuple[str, ...],
    expected_status: str, expected_reason: str, expected_exit: int,
) -> None:
    # Given
    result_file = tmp_path / f"{name}.json"

    # When
    completed = subprocess.run(
        [sys.executable, str(RUNNER), "--label", name, "--timeout", "1",
         "--result-file", str(result_file), *extra_args, "--", *command],
        check=False, capture_output=True, text=True, timeout=5,
    )

    # Then
    payload = json.loads(result_file.read_text(encoding="utf-8"))
    assert completed.returncode == expected_exit
    assert payload["status"] == expected_status
    assert payload["reason"] == expected_reason


def test_runner_cancellation_terminates_resistant_owned_group(tmp_path: Path) -> None:
    # Given
    result_file = tmp_path / "cancel.json"
    cancel_file = tmp_path / "cancel.request"
    child_pid_file = tmp_path / "child.pid"
    command = [
        sys.executable, str(RUNNER), "--label", "cancel", "--timeout", "10",
        "--result-file", str(result_file), "--cancel-file", str(cancel_file), "--",
        "/bin/sh", "-c", f"trap '' TERM; (trap '' TERM; sleep 30) & echo $! > {child_pid_file}; wait",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 3
    while not child_pid_file.exists() and time.monotonic() < deadline:
        try:
            process.wait(timeout=0.02)
        except subprocess.TimeoutExpired:
            continue
    assert child_pid_file.exists()

    # When
    cancel_file.touch()
    stdout, stderr = process.communicate(timeout=5)

    # Then
    payload = json.loads(result_file.read_text(encoding="utf-8"))
    child_pid = int(child_pid_file.read_text(encoding="utf-8"))
    assert process.returncode == 130, (stdout, stderr)
    assert payload["status"] == "cancelled"
    assert payload["reason"] == "cancellation_requested"
    assert payload["cleanup"]["process_group_terminated"] is True
    assert subprocess.run(["/bin/kill", "-0", str(child_pid)], check=False).returncode != 0


def test_runner_rejects_artifact_parent_symlink_escape(tmp_path: Path) -> None:
    # Given
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(outside, target_is_directory=True)
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    stdin_file = tmp_path / "stdin"
    stdin_file.write_text("", encoding="utf-8")

    # When
    completed = subprocess.run(
        [
            sys.executable, str(RUNNER), "--label", "linked-artifact", "--timeout", "1",
            "--result-file", str(tmp_path / "result.json"), "--cwd", str(cwd),
            "--cwd-file", str(tmp_path / "cwd.txt"), "--stdin-file", str(stdin_file),
            "--stdout-file", str(linked_parent / "escaped.txt"),
            "--stderr-file", str(tmp_path / "stderr.txt"), "--", "/bin/sh", "-c", "printf escaped",
        ],
        check=False, capture_output=True, text=True, timeout=5,
    )

    # Then
    assert completed.returncode == 2
    assert not (outside / "escaped.txt").exists()


def test_runner_rejects_result_file_parent_symlink_escape(tmp_path: Path) -> None:
    # Given
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_parent = tmp_path / "result-link"
    linked_parent.symlink_to(outside, target_is_directory=True)

    # When
    completed = subprocess.run(
        [
            sys.executable, str(RUNNER), "--label", "linked-result", "--timeout", "1",
            "--result-file", str(linked_parent / "escaped.json"), "--", "/bin/sh", "-c", "exit 0",
        ],
        check=False, capture_output=True, text=True, timeout=5,
    )

    # Then
    assert completed.returncode == 2
    assert not (outside / "escaped.json").exists()


def test_session_binding_deduplicates_exact_id_and_rejects_stale_fingerprints(tmp_path: Path) -> None:
    # Given
    worktree = repository(tmp_path)
    project = tmp_path / "project"
    project.mkdir()
    state_file = create_state(project)
    root = tmp_path / "root"
    root.mkdir()
    executable = tmp_path / "fake-host"
    executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    executable.chmod(0o755)
    mcp, asset, probe = (tmp_path / name for name in ("mcp.json", "asset.json", "probe.json"))
    for path in (mcp, asset, probe):
        path.write_text("{}\n", encoding="utf-8")
    command = binding_command(state_file, worktree, executable, root, mcp, asset, probe)

    # When
    first = subprocess.run(command, check=False, capture_output=True, text=True, timeout=5)
    repeated = subprocess.run(command, check=False, capture_output=True, text=True, timeout=5)

    # Then
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert first.returncode == 0
    assert json.loads(first.stdout)["status"] == "bound"
    assert repeated.returncode == 0
    assert json.loads(repeated.stdout)["status"] == "reused"
    assert state["session_ids"] == ["session-exact"]
    assert len(state["runtime_fingerprints"]) == 1
    validation = subprocess.run(
        ["bash", str(VALIDATE_STATE), "runtime"], check=False, capture_output=True,
        text=True, env={**os.environ, "CWD": str(project)}, timeout=5,
    )
    assert validation.returncode == 0, validation.stdout + validation.stderr

    alternate_root = tmp_path / "alternate-root"
    alternate_root.mkdir()
    executable.write_text("#!/bin/sh\nexit 9\n", encoding="utf-8")
    rejected = subprocess.run(command, check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "binary"
    executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    changed: list[tuple[str, list[str]]] = [
        ("root", binding_command(state_file, worktree, executable, alternate_root, mcp, asset, probe)),
    ]
    (worktree / "tracked.txt").write_text("dirty\n", encoding="utf-8")
    changed.append(("revision", binding_command(state_file, worktree, executable, root, mcp, asset, probe)))
    for changed_field, changed_command in changed:
        rejected = subprocess.run(changed_command, check=False, capture_output=True, text=True, timeout=5)
        assert rejected.returncode == 3, (changed_field, rejected.stdout, rejected.stderr)
        assert json.loads(rejected.stdout)["changed"] == changed_field
    (worktree / "tracked.txt").write_text("base\n", encoding="utf-8")
    changed = []
    mcp.write_text('{"changed":true}\n', encoding="utf-8")
    changed.append(("mcp", binding_command(state_file, worktree, executable, root, mcp, asset, probe)))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "mcp"
    mcp.write_text("{}\n", encoding="utf-8")
    asset.write_text('{"changed":true}\n', encoding="utf-8")
    changed.append(("generated_asset", binding_command(state_file, worktree, executable, root, mcp, asset, probe)))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "generated_asset"
    asset.write_text("{}\n", encoding="utf-8")
    probe.write_text('{"changed":true}\n', encoding="utf-8")
    changed.append(("probe", binding_command(state_file, worktree, executable, root, mcp, asset, probe)))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "probe"
    probe.write_text("{}\n", encoding="utf-8")
    changed.append(("host", binding_command(state_file, worktree, executable, root, mcp, asset, probe, host="codebuddy-ide")))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "host"
    changed.append(("profile", binding_command(state_file, worktree, executable, root, mcp, asset, probe, profile="assisted")))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "profile"
    marketplace = tmp_path / "marketplace.json"
    marketplace.write_text('{"changed":true}\n', encoding="utf-8")
    changed.append(("marketplace", binding_command(state_file, worktree, executable, root, mcp, asset, probe, marketplace=marketplace)))
    rejected = subprocess.run(changed[-1][1], check=False, capture_output=True, text=True, timeout=5)
    assert json.loads(rejected.stdout)["changed"] == "marketplace"

    moved_worktree = tmp_path / "moved-worktree"
    worktree.rename(moved_worktree)
    rejected = subprocess.run(
        binding_command(state_file, moved_worktree, executable, root, mcp, asset, probe),
        check=False, capture_output=True, text=True, timeout=5,
    )
    assert rejected.returncode == 3
    assert json.loads(rejected.stdout)["changed"] == "worktree"


def test_session_binding_rejects_malformed_run_state_without_traceback(tmp_path: Path) -> None:
    # Given
    worktree = repository(tmp_path)
    state_file = tmp_path / "state.json"
    state_file.write_text('{"schema_version":"2","session_ids":[{}],"runtime_fingerprints":[]}\n', encoding="utf-8")
    root = tmp_path / "root"
    root.mkdir()
    mcp, asset, probe = (tmp_path / name for name in ("mcp.json", "asset.json", "probe.json"))
    for path in (mcp, asset, probe):
        path.write_text("{}\n", encoding="utf-8")

    # When
    completed = subprocess.run(
        binding_command(state_file, worktree, Path("/bin/sh"), root, mcp, asset, probe),
        check=False, capture_output=True, text=True, timeout=5,
    )

    # Then
    assert completed.returncode == 2
    assert json.loads(completed.stdout) == {"status": "unavailable", "reason": "malformed_run_state"}
    assert completed.stderr == ""


@pytest.mark.parametrize("unsafe_kind", ("relative", "symlink", "non-git"))
def test_session_binding_rejects_unsafe_worktree(tmp_path: Path, unsafe_kind: str) -> None:
    # Given
    real_worktree = repository(tmp_path)
    project = tmp_path / "project"
    project.mkdir()
    state_file = create_state(project)
    root = tmp_path / "root"
    root.mkdir()
    mcp, asset, probe = (tmp_path / name for name in ("mcp.json", "asset.json", "probe.json"))
    for path in (mcp, asset, probe):
        path.write_text("{}\n", encoding="utf-8")
    match unsafe_kind:
        case "relative":
            worktree = Path("relative-worktree")
        case "symlink":
            worktree = tmp_path / "linked-worktree"
            worktree.symlink_to(real_worktree, target_is_directory=True)
        case "non-git":
            worktree = tmp_path / "not-git"
            worktree.mkdir()
        case unreachable:
            raise AssertionError(unreachable)

    # When
    completed = subprocess.run(
        binding_command(state_file, worktree, Path("/bin/sh"), root, mcp, asset, probe),
        check=False, capture_output=True, text=True, timeout=5,
    )

    # Then
    assert completed.returncode == 2
    assert json.loads(completed.stdout)["status"] == "unavailable"
    assert not json.loads(state_file.read_text(encoding="utf-8"))["session_ids"]
