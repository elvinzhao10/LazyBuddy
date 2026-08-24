from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypeAlias

from lazybuddy_codebuddy_service_contract import ServiceReceipt


CHECKPOINT_ID: Final = re.compile(r"^[a-z0-9][a-z0-9._:-]{2,127}$")
JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


class CheckpointError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class CheckpointObservation:
    checkpoint_id: str
    session_id: str
    scope_root: Path
    canonical_digest: str

    def as_json(self) -> dict[str, JSONValue]:
        return {
            "status": "observed",
            "checkpoint_id": self.checkpoint_id,
            "session_id": self.session_id,
            "scope_root": str(self.scope_root),
            "coverage": {"file_edit_tools": True, "bash": False, "external": False},
            "ledger_effect": "none",
            "canonical_completion_sha256": self.canonical_digest,
            "redacted": True,
        }


def observe_checkpoint(receipt: ServiceReceipt, checkpoint_path: Path, canonical: Path) -> CheckpointObservation:
    try:
        value: JSONValue = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CheckpointError("malformed_checkpoint") from error
    required = {"checkpoint_id", "session_id", "scope_root", "bash_changes", "external_changes"}
    allowed = {*required, "untrusted"}
    if not isinstance(value, dict) or not required <= set(value) or not set(value) <= allowed:
        raise CheckpointError("malformed_checkpoint")
    checkpoint_id = value["checkpoint_id"]
    if (
        not isinstance(checkpoint_id, str)
        or not CHECKPOINT_ID.fullmatch(checkpoint_id)
        or value["session_id"] != receipt.session_id
        or value["scope_root"] != str(receipt.cwd)
        or value["bash_changes"] is not False
        or value["external_changes"] is not False
        or receipt.session_id is None
    ):
        raise CheckpointError("checkpoint_mismatch")
    digest = hashlib.sha256(canonical.read_bytes()).hexdigest()
    return CheckpointObservation(checkpoint_id, receipt.session_id, receipt.cwd, digest)
