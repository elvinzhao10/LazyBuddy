#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 lazybuddy-codebuddy-run.py --help
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Final, TypeAlias


JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]
SAFE_PERMISSION_MODES: Final = ("default", "acceptEdits", "auto", "dontAsk", "plan")


class AdapterError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class NonFiniteJsonError(ValueError):
    pass


def reject_constant(_value: str) -> None:
    raise NonFiniteJsonError


def strict_json(text: str) -> JSONValue:
    return json.loads(text, parse_constant=reject_constant)


def read_json(path: Path, reason: str) -> JSONValue:
    try:
        return strict_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise AdapterError(reason) from error


def validate_stream_input(path: Path) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        values = [strict_json(line) for line in lines]
    except (OSError, UnicodeError, ValueError) as error:
        raise AdapterError("malformed_stream_input") from error
    if not values or any(not isinstance(value, dict) for value in values):
        raise AdapterError("malformed_stream_input")


def schema_result(action: str, schema: dict[str, JSONValue], value: JSONValue | None = None) -> str:
    node = shutil.which("node")
    if node is None:
        raise AdapterError("schema_validator_unavailable")
    helper = Path(__file__).resolve().parent.parent / "tooling" / "validate-codebuddy-schema.js"
    request: dict[str, JSONValue] = {"action": action, "schema": schema}
    if action == "validate":
        request["value"] = value
    try:
        completed = subprocess.run(
            [node, str(helper)], input=json.dumps(request, allow_nan=False), capture_output=True,
            text=True, check=False, timeout=10,
        )
        response = strict_json(completed.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise AdapterError("schema_validator_failed") from error
    if not isinstance(response, dict) or not isinstance(response.get("status"), str):
        raise AdapterError("schema_validator_failed")
    return response["status"]


def schema_object(value: JSONValue) -> dict[str, JSONValue]:
    if not isinstance(value, dict):
        raise AdapterError("invalid_json_schema")
    if schema_result("compile", value) != "valid":
        raise AdapterError("invalid_json_schema")
    return value


def nonempty_string(value: JSONValue | None) -> str | None:
    return value if isinstance(value, str) and value else None


def parse_output(path: Path, output_format: str, schema: dict[str, JSONValue] | None, max_turns: int) -> dict[str, JSONValue]:
    if output_format == "json":
        response = read_json(path, "malformed_json")
        if not isinstance(response, dict): raise AdapterError("missing_result")
        session_id = nonempty_string(response.get("session_id"))
        result = response.get("result")
        events: list[JSONValue] | None = None
    else:
        events = []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError) as error: raise AdapterError("malformed_jsonl") from error
        if not lines: raise AdapterError("missing_result")
        for line in lines:
            try:
                event = strict_json(line)
            except ValueError as error: raise AdapterError("malformed_jsonl") from error
            if not isinstance(event, dict): raise AdapterError("malformed_jsonl")
            if event.get("type") in {"permission_request", "permission_required"}: raise AdapterError("permission_required")
            events.append(event)
        result_event = next((event for event in reversed(events) if isinstance(event, dict) and event.get("type") == "result"), None)
        if result_event is None: raise AdapterError("missing_result")
        response = result_event
        session_id = nonempty_string(response.get("session_id"))
        if session_id is None:
            session_id = next((nonempty_string(event.get("session_id")) for event in events if isinstance(event, dict) and nonempty_string(event.get("session_id")) is not None), None)
        observed_sessions = {candidate for event in events if isinstance(event, dict) if (candidate := nonempty_string(event.get("session_id"))) is not None}
        if len(observed_sessions) > 1: raise AdapterError("session_mismatch")
        result = response.get("result")
    if session_id is None: raise AdapterError("missing_session")
    if not isinstance(result, str): raise AdapterError("missing_result")
    if response.get("permission_required") is True or response.get("subtype") == "permission_required": raise AdapterError("permission_required")
    permission_denials = response.get("permission_denials")
    if isinstance(permission_denials, list) and permission_denials: raise AdapterError("permission_required")
    turns = response.get("num_turns", response.get("turns"))
    if isinstance(turns, int) and turns > max_turns: raise AdapterError("turn_exhaustion")
    structured = response.get("structured_output")
    if schema is not None and (structured is None or schema_result("validate", schema, structured) != "valid"): raise AdapterError("schema_mismatch")
    parsed: dict[str, JSONValue] = {"status": "pass", "session_id": session_id, "response": response}
    if events is not None:
        parsed["events"] = events
    if structured is not None:
        parsed["structured_output"] = structured
    return parsed


def exact_argv(args: argparse.Namespace, schema_text: str | None, input_text: str | None) -> list[str]:
    command = [str(args.binary), "-p", "--input-format", args.input_format, "--output-format", args.output_format,
               "--max-turns", str(args.max_turns), "--permission-mode", args.permission_mode,
               "--subagent-permission-mode", args.subagent_permission_mode,
               "--mcp-config", str(args.mcp_config), "--strict-mcp-config"]
    if args.include_partial_messages:
        command.append("--include-partial-messages")
    if schema_text is not None:
        command.extend(("--json-schema", schema_text))
    if args.permission_prompt_tool is not None:
        command.extend(("--permission-prompt-tool", args.permission_prompt_tool))
    if args.worktree is not None:
        command.extend(("--worktree", args.worktree))
    if args.resume is not None:
        command.extend(("--resume", args.resume))
    if args.input_format == "text":
        command.append(input_text if input_text is not None else args.input_file.read_text(encoding="utf-8"))
    return command


def binding_command(args: argparse.Namespace, state_file: Path, session_id: str) -> list[str]:
    return [sys.executable, str(Path(__file__).resolve().parent / "state" / "bind-session.py"), "--state-file", str(state_file), "--host", "codebuddy-cli", "--profile", args.profile, "--session-id", session_id, "--worktree", str(args.cwd), "--root", str(args.binding_root), "--executable", str(args.binary), "--mcp-file", str(args.mcp_config), "--asset-file", str(args.asset_file), "--probe-file", str(args.probe_file), "--marketplace-file", str(args.marketplace_file)]


def preflight_resume(args: argparse.Namespace) -> None:
    if args.resume is None: return
    binding_values = (args.state_file, args.binding_root, args.asset_file, args.probe_file)
    if not any(binding_values): return
    if not all(binding_values) or args.state_file is None: raise AdapterError("incomplete_session_binding")
    try:
        with tempfile.TemporaryDirectory(prefix="lazybuddy-resume-", dir="/private/tmp") as temporary:
            probe_state = Path(temporary) / "state.json"
            probe_state.write_bytes(args.state_file.read_bytes())
            completed = subprocess.run(binding_command(args, probe_state, args.resume), check=False, capture_output=True, text=True, timeout=10)
        payload = strict_json(completed.stdout)
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError) as error:
        raise AdapterError("stale_session") from error
    if isinstance(payload, dict) and completed.returncode == 0 and payload.get("status") == "reused": return
    changed = payload.get("changed") if isinstance(payload, dict) else None
    reason = {"binary": "stale_binary", "worktree": "stale_worktree", "revision": "stale_revision"}.get(changed, "stale_session")
    raise AdapterError(reason)


def bind_session(args: argparse.Namespace, session_id: str) -> None:
    binding_values = (args.state_file, args.binding_root, args.asset_file, args.probe_file)
    if not any(binding_values):
        return
    if not all(binding_values):
        raise AdapterError("incomplete_session_binding")
    completed = subprocess.run(binding_command(args, args.state_file, session_id), check=False, capture_output=True, text=True, timeout=10)
    if completed.returncode != 0:
        raise AdapterError("session_binding_failed")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    for option in ("binary", "cwd", "input-file", "result-file", "stdout-file", "stderr-file"):
        value.add_argument(f"--{option}", required=True, type=Path)
    value.add_argument("--input-format", required=True, choices=("text", "stream-json"))
    value.add_argument("--output-format", required=True, choices=("json", "stream-json"))
    value.add_argument("--json-schema-file", type=Path)
    value.add_argument("--include-partial-messages", action="store_true")
    for option in ("max-turns", "timeout"):
        value.add_argument(f"--{option}", required=True, type=int)
    value.add_argument("--mcp-config", required=True, type=Path)
    for option in ("permission-mode", "subagent-permission-mode"):
        value.add_argument(f"--{option}", required=True, choices=SAFE_PERMISSION_MODES)
    value.add_argument("--permission-prompt-tool")
    value.add_argument("--resume")
    value.add_argument("--profile", default="direct")
    value.add_argument("--worktree")
    value.add_argument("--cancel-file", type=Path)
    for option in ("state-file", "binding-root", "asset-file", "probe-file"):
        value.add_argument(f"--{option}", type=Path)
    value.add_argument(
        "--marketplace-file",
        default=Path(__file__).resolve().parents[2]
        / ".codebuddy-plugin"
        / "marketplace.json",
        type=Path,
    )
    return value


def write_result(path: Path, result: dict[str, JSONValue]) -> None:
    path.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def main() -> int:
    args = parser().parse_args()
    if args.max_turns < 1 or args.timeout < 1: parser().error("--max-turns and --timeout must be positive")
    if args.include_partial_messages and args.output_format != "stream-json": parser().error("--include-partial-messages requires stream-json output")
    if args.json_schema_file is not None and args.output_format != "json": parser().error("--json-schema-file requires json output")
    input_text: str | None = None
    try:
        if args.input_format == "stream-json": validate_stream_input(args.input_file)
        else: input_text = args.input_file.read_text(encoding="utf-8")
        schema = schema_object(read_json(args.json_schema_file, "invalid_json_schema")) if args.json_schema_file is not None else None
        preflight_resume(args)
    except (AdapterError, OSError, UnicodeError) as error:
        reason = error.reason if isinstance(error, AdapterError) else "adapter_io_error"
        write_result(args.result_file, {"status": "fail", "reason": reason})
        return 2
    schema_text = json.dumps(schema, sort_keys=True, separators=(",", ":")) if schema is not None else None; bounded = Path(__file__).resolve().parent / "lazybuddy-bounded-run.py"
    with tempfile.TemporaryDirectory(prefix="lazybuddy-codebuddy-", dir="/private/tmp") as temporary:
        root = Path(temporary)
        stdin_file = args.input_file if args.input_format == "stream-json" else root / "stdin"
        if args.input_format == "text": stdin_file.write_bytes(b"")
        bounded_result = root / "bounded.json"
        cwd_file = root / "cwd"
        command = exact_argv(args, schema_text, input_text)
        bounded_command = [
            sys.executable, str(bounded), "--label", "codebuddy-cli", "--timeout", str(args.timeout),
            "--result-file", str(bounded_result), "--cwd", str(args.cwd), "--cwd-file", str(cwd_file),
            "--stdin-file", str(stdin_file), "--stdout-file", str(args.stdout_file),
            "--stderr-file", str(args.stderr_file),
        ]
        if args.cancel_file is not None: bounded_command.extend(("--cancel-file", str(args.cancel_file)))
        completed = subprocess.run([*bounded_command, "--", *command], check=False)
        bounded_value = read_json(bounded_result, "bounded_runner_failed")
    if not isinstance(bounded_value, dict):
        write_result(args.result_file, {"status": "unavailable", "reason": "bounded_runner_failed"}); return 125
    if completed.returncode != 0:
        result: dict[str, JSONValue] = {"status": bounded_value.get("status", "fail"), "reason": bounded_value.get("reason", "process_failed"), "bounded": bounded_value}
        write_result(args.result_file, result)
        return completed.returncode if completed.returncode > 0 else 1
    try:
        result = parse_output(args.stdout_file, args.output_format, schema, args.max_turns)
        session_id = nonempty_string(result.get("session_id"))
        if session_id is None: raise AdapterError("missing_session")
        bind_session(args, session_id)
    except (AdapterError, OSError, UnicodeError, subprocess.SubprocessError) as error:
        reason = error.reason if isinstance(error, AdapterError) else "adapter_io_error"
        write_result(args.result_file, {"status": "fail", "reason": reason, "bounded": bounded_value})
        return 1
    result["bounded"] = bounded_value
    write_result(args.result_file, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
