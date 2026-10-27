"""Bounded completion byte capture; callers hold the authoritative run lock."""
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# How to run: imported by dashboard-bridge.py during its locked read.
from __future__ import annotations

import base64
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from dashboard_files import Files, Json, bounded_read, safe_path
from state_transaction import TransactionError


class Record(TypedDict):
    kind: str
    base64: str
    stamp: list[int]


class Bundle(TypedDict):
    authorityPath: str
    records: dict[str, Record]
    current: Json
    consistent: bool


def identity(root: Path) -> Json:
    outputs = []
    for args in [("rev-parse", "--verify", "HEAD"), ("status", "--porcelain=v1", "--untracked-files=all")]:
        result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, timeout=5, check=False)
        if result.returncode or len(result.stdout) > 1024 * 1024:
            return None
        outputs.append(result.stdout.decode().rstrip("\n"))
    dirty = [line[3:].strip('"') for line in outputs[1].splitlines()]
    return {"head": outputs[0], "dirty": [name for name in dirty if not name.startswith((".lazybuddy/", ".lazytrae/"))]}


def record(root: Path, relative: str) -> Record:
    try:
        if tuple(part.casefold() for part in relative.split("/")[:2]) == (".lazybuddy", "dashboard"):
            raise TransactionError("protected completion reference")
        target = safe_path(root, relative)
        before = target.stat(follow_symlinks=False)
        if before.st_nlink != 1:
            raise TransactionError("linked completion reference")
        content = bounded_read(root, relative)
        after = target.stat(follow_symlinks=False)
        stamp = lambda value: [value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns]
        if stamp(before) != stamp(after):
            raise TransactionError("completion reference changed")
        return {"kind": "ok", "base64": base64.b64encode(content).decode(), "stamp": stamp(after)}
    except FileNotFoundError:
        return {"kind": "missing", "base64": "", "stamp": []}
    except (OSError, TransactionError):
        return {"kind": "invalid", "base64": "", "stamp": []}


@dataclass(slots=True)
class Capture:
    """Accumulate each referenced byte sequence once with a total wire budget."""

    root: Path
    records: dict[str, Record]
    size: int = 0

    def add(self, relative: Json) -> Json:
        if not isinstance(relative, str):
            return None
        if relative not in self.records:
            value = record(self.root, relative)
            self.size += len(value["base64"]) + len(relative)
            if self.size > 2 * 1024 * 1024 or len(self.records) >= 1024:
                raise TransactionError("completion bundle exceeds bounds")
            self.records[relative] = value
        try:
            return json.loads(base64.b64decode(self.records[relative]["base64"]))
        except (json.JSONDecodeError, UnicodeError):
            return None


def capture_completion(files: Files) -> Bundle:
    root = files.binding.root
    authority_path = f".lazybuddy/runs/{files.binding.run_id}/completion-authority.json"
    capture = Capture(root, {})
    current = identity(root)
    authority = capture.add(authority_path)
    if isinstance(authority, dict):
        plan = authority.get("plan")
        if isinstance(plan, dict):
            capture.add(plan.get("path"))
        criteria = authority.get("criteria")
        if isinstance(criteria, list):
            if len(criteria) > 1024:
                raise TransactionError("completion criteria exceed bounds")
            for criterion in criteria:
                if isinstance(criterion, dict):
                    receipt = capture.add(criterion.get("evidence_path"))
                    capture.add(criterion.get("review_path"))
                    if isinstance(receipt, dict) and isinstance(receipt.get("artifact"), dict):
                        capture.add(receipt["artifact"].get("path"))
    # A second complete collect detects mutable external references and change/revert
    # through inode/ctime, rather than pretending the run lock also locks these files.
    consistent = all(record(root, name) == value for name, value in capture.records.items())
    consistent = identity(root) == current and consistent
    for name, content in list(files.before.items()):
        if files.read(name) != (content or b""):
            consistent = False
    return {"authorityPath": authority_path, "records": capture.records, "current": current, "consistent": consistent}
