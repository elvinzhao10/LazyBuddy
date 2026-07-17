from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Final, NoReturn

PLUGIN_ROOT: Final = Path(__file__).resolve().parent.parent
CONTRACT: Final = PLUGIN_ROOT / "contracts" / "automatic-tooling-contract.v1.json"
SIDECAR: Final = CONTRACT.with_suffix(CONTRACT.suffix + ".sha256")


class BrokerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def fail(code: str, message: str) -> NoReturn:
    raise BrokerError(code, message)


def contract_digest() -> str:
    try:
        raw = CONTRACT.read_bytes()
        declared = SIDECAR.read_text(encoding="utf-8").split()[0]
        contract = json.loads(raw)
    except (FileNotFoundError, IndexError, json.JSONDecodeError):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract is unreadable")
    actual = hashlib.sha256(raw).hexdigest()
    if actual != declared or len(declared) != 64:
        fail("AUTOMATIC_TOOLING_CHECKSUM_MISMATCH", "contract digest mismatch")
    if contract.get("schema") != "lazy-series.automatic-tooling.contract" or contract.get("schema_version") != 1:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract schema is unsupported")
    return actual
