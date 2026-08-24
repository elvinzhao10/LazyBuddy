#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Final, TypedDict


TOOLING_ROOT: Final = Path(__file__).resolve().parents[2] / "tooling"
sys.path.insert(0, str(TOOLING_ROOT))
from lazybuddy_adaptive_fingerprint import canonical_fingerprint, revision_fingerprint  # noqa: E402
from lazybuddy_adaptive_snapshot import write_state_file_atomic  # noqa: E402


FINGERPRINT_NAMES: Final = (
    "host",
    "profile",
    "probe",
    "binary",
    "session",
    "worktree",
    "mcp",
    "generated_asset",
    "marketplace",
    "root",
    "revision",
)
MAX_FINGERPRINT_FILE_BYTES: Final = 16 * 1024 * 1024


class Fingerprints(TypedDict):
    host: str
    profile: str
    probe: str
    session: str
    binary: str
    root: str
    revision: str
    worktree: str
    mcp: str
    generated_asset: str
    marketplace: str


class Binding(TypedDict):
    session_id: str
    host: str
    worktree: str
    fingerprints: Fingerprints


@dataclass(frozen=True, slots=True)
class RuntimeBindingError(Exception):
    reason: str

    def __str__(self) -> str:
        return self.reason


def absolute_nonlinked(path: Path, *, kind: str) -> Path:
    if not path.is_absolute():
        raise RuntimeBindingError(f"{kind}_not_absolute")
    current = path
    while True:
        if current.is_symlink():
            raise RuntimeBindingError(f"{kind}_linked")
        if current.parent == current:
            break
        current = current.parent
    try:
        status = path.stat()
    except OSError as error:
        raise RuntimeBindingError(f"{kind}_unavailable") from error
    if kind in {"root", "worktree"} and not stat.S_ISDIR(status.st_mode):
        raise RuntimeBindingError(f"{kind}_not_directory")
    if kind not in {"root", "worktree"} and not stat.S_ISREG(status.st_mode):
        raise RuntimeBindingError(f"{kind}_not_file")
    return path


def bounded_file_digest(path: Path, *, kind: str) -> str:
    safe_path = absolute_nonlinked(path, kind=kind)
    digest = hashlib.sha256()
    total = 0
    with safe_path.open("rb") as handle:
        while chunk := handle.read(64 * 1024):
            total += len(chunk)
            if total > MAX_FINGERPRINT_FILE_BYTES:
                raise RuntimeBindingError(f"{kind}_too_large")
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def git_value(worktree: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["/usr/bin/git", "-C", str(worktree), *arguments],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if completed.returncode != 0:
        raise RuntimeBindingError("worktree_not_git_member")
    return completed.stdout.strip()


def worktree_fingerprints(worktree: Path) -> tuple[str, str]:
    safe_worktree = absolute_nonlinked(worktree, kind="worktree")
    top_level = Path(git_value(safe_worktree, "rev-parse", "--show-toplevel"))
    if top_level != safe_worktree:
        raise RuntimeBindingError("worktree_not_git_root")
    git_directory = git_value(safe_worktree, "rev-parse", "--absolute-git-dir")
    revision = revision_fingerprint(safe_worktree)
    if revision.status != "available" or revision.digest is None:
        raise RuntimeBindingError("revision_unavailable")
    worktree_digest = canonical_fingerprint({"path": str(safe_worktree), "git_directory": git_directory})
    return worktree_digest, revision.digest


def make_binding(args: argparse.Namespace) -> Binding:
    if not args.session_id or len(args.session_id) > 256 or "\x00" in args.session_id:
        raise RuntimeBindingError("invalid_session_id")
    if not args.profile or len(args.profile) > 64 or "\x00" in args.profile:
        raise RuntimeBindingError("invalid_profile")
    root = absolute_nonlinked(args.root, kind="root")
    worktree_digest, revision_digest = worktree_fingerprints(args.worktree)
    root_status = root.stat()
    fingerprints: Fingerprints = {
        "host": canonical_fingerprint({"host": args.host}),
        "profile": canonical_fingerprint({"profile": args.profile}),
        "probe": bounded_file_digest(args.probe_file, kind="probe"),
        "session": canonical_fingerprint({"session_id": args.session_id}),
        "binary": bounded_file_digest(args.executable, kind="binary"),
        "root": canonical_fingerprint({"path": str(root), "device": root_status.st_dev, "inode": root_status.st_ino}),
        "revision": revision_digest,
        "worktree": worktree_digest,
        "mcp": bounded_file_digest(args.mcp_file, kind="mcp"),
        "generated_asset": bounded_file_digest(
            args.asset_file,
            kind="generated_asset",
        ),
        "marketplace": bounded_file_digest(
            args.marketplace_file,
            kind="marketplace",
        ),
    }
    return {"session_id": args.session_id, "host": args.host, "worktree": str(args.worktree), "fingerprints": fingerprints}


def read_state(path: Path) -> dict[str, object]:
    absolute_nonlinked(path, kind="state")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeBindingError("malformed_run_state") from error
    if not isinstance(value, dict) or value.get("schema_version") != "2":
        raise RuntimeBindingError("malformed_run_state")
    session_ids = value.get("session_ids")
    bindings = value.setdefault("runtime_fingerprints", [])
    if not isinstance(session_ids, list) or not isinstance(bindings, list):
        raise RuntimeBindingError("malformed_run_state")
    if any(not isinstance(session_id, str) or not session_id for session_id in session_ids):
        raise RuntimeBindingError("malformed_run_state")
    if len(session_ids) != len(set(session_ids)):
        raise RuntimeBindingError("duplicate_session_id")
    binding_ids = [binding.get("session_id") for binding in bindings if isinstance(binding, dict)]
    if len(binding_ids) != len(bindings) or binding_ids != session_ids:
        raise RuntimeBindingError("malformed_run_state")
    return value


def changed_fingerprint(existing: dict[str, object], candidate: Binding) -> str | None:
    fingerprints = existing.get("fingerprints")
    if not isinstance(fingerprints, dict):
        raise RuntimeBindingError("malformed_run_state")
    for name in FINGERPRINT_NAMES:
        if fingerprints.get(name) != candidate["fingerprints"][name]:
            return name
    if existing.get("host") != candidate["host"] or existing.get("worktree") != candidate["worktree"]:
        return "binding"
    return None


def bind(state: dict[str, object], candidate: Binding) -> tuple[str, str | None]:
    session_ids = state["session_ids"]
    bindings = state["runtime_fingerprints"]
    if not isinstance(session_ids, list) or not isinstance(bindings, list):
        raise RuntimeBindingError("malformed_run_state")
    existing = next((item for item in bindings if isinstance(item, dict) and item.get("session_id") == candidate["session_id"]), None)
    if existing is not None:
        changed = changed_fingerprint(existing, candidate)
        return ("reused", None) if changed is None else ("stale", changed)
    session_ids.append(candidate["session_id"])
    bindings.append(candidate)
    state["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return "bound", None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-file", required=True, type=Path)
    parser.add_argument("--host", required=True)
    parser.add_argument("--profile", default="direct")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--worktree", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--executable", required=True, type=Path)
    parser.add_argument("--mcp-file", required=True, type=Path)
    parser.add_argument("--asset-file", required=True, type=Path)
    parser.add_argument("--probe-file", required=True, type=Path)
    parser.add_argument(
        "--marketplace-file",
        default=Path(__file__).resolve().parents[3]
        / ".codebuddy-plugin"
        / "marketplace.json",
        type=Path,
    )
    args = parser.parse_args()
    try:
        candidate = make_binding(args)
        state = read_state(args.state_file)
        status, changed = bind(state, candidate)
        if status == "stale":
            print(json.dumps({"status": status, "reason": "fingerprint_changed", "changed": changed}))
            return 3
        if status == "bound":
            write_state_file_atomic(str(args.state_file), state)
        print(json.dumps({"status": status, "session_id": args.session_id}))
        return 0
    except (RuntimeBindingError, OSError, subprocess.SubprocessError) as error:
        reason = error.reason if isinstance(error, RuntimeBindingError) else type(error).__name__
        print(json.dumps({"status": "unavailable", "reason": reason}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
