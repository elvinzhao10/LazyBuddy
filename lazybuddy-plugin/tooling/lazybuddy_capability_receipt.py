from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Final

from lazybuddy_capability_contract import fail

RECEIPT_NAME: Final = ".lazybuddy-capability-receipt.json"


def receipt_payload(root: Path, digest: str, providers_installed: bool) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "owner": "lazybuddy-capability-broker",
            "root": str(root),
            "contract_digest": digest,
            "providers_installed": providers_installed,
            "owned_entries": [RECEIPT_NAME] + (["providers"] if providers_installed else []),
        },
        indent=2,
        sort_keys=True,
    ) + "\n"


def receipt_is_valid(root: Path, digest: str) -> bool:
    receipt = root / RECEIPT_NAME
    if not receipt.is_file() or receipt.is_symlink() or stat.S_IMODE(receipt.stat().st_mode) != 0o600 or receipt.stat().st_nlink != 1:
        return False
    try:
        value = json.loads(receipt.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    installed = value.get("providers_installed")
    if not isinstance(installed, bool):
        return False
    expected = receipt_payload(root, digest, installed)
    entries = sorted(entry.name for entry in root.iterdir())
    allowed = sorted([RECEIPT_NAME] + (["providers"] if installed else []))
    return receipt.read_text(encoding="utf-8") == expected and entries == allowed


def write_receipt(root: Path, digest: str, providers_installed: bool) -> Path:
    receipt = root / RECEIPT_NAME
    temporary = root / f"{RECEIPT_NAME}.tmp.{os.getpid()}"
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(receipt_payload(root, digest, providers_installed))
    os.replace(temporary, receipt)
    return receipt


def prepare_toolpack(raw: str | None, digest: str) -> tuple[Path, Path]:
    root = Path(raw) if raw else Path.home() / ".local" / "share" / "lazyseries" / "toolpack"
    if not root.is_absolute() or ".." in root.parts:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack root must be an absolute traversal-free path")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack root must be a real directory")
    root = root.resolve()
    os.chmod(root, 0o700)
    receipt = root / RECEIPT_NAME
    if receipt.exists():
        if not receipt_is_valid(root, digest):
            fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack receipt is stale or modified")
        return root, receipt
    if any(root.iterdir()):
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack root must be empty or receipt-owned")
    return root, write_receipt(root, digest, False)
