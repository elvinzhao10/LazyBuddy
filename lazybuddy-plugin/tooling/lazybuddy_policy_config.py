from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import NoReturn

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
CONTRACT = PLUGIN_ROOT / "contracts" / "automatic-tooling-contract.v1.json"
SIDECAR = CONTRACT.with_suffix(CONTRACT.suffix + ".sha256")
KEYCHAIN_SERVICE_PREFIX = "com.lazyseries.lazybuddy.credential"
KEYCHAIN_ACCOUNT = "v1"
ENCRYPTED_REFERENCE = re.compile(r"^aesgcm:v1:keychain://[A-Za-z0-9._/-]+:[A-Za-z0-9_-]+$")


class PolicyError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def fail(code: str, message: str) -> NoReturn:
    raise PolicyError(code, message)


def config_path() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_home / "lazyseries" / "config.yaml"


def contract_digest() -> str:
    try:
        actual = hashlib.sha256(CONTRACT.read_bytes()).hexdigest()
        expected = SIDECAR.read_text(encoding="utf-8").split()[0]
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (FileNotFoundError, IndexError, json.JSONDecodeError):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract is unreadable")
    if actual != expected or not re.fullmatch(r"[0-9a-f]{64}", expected):
        fail("AUTOMATIC_TOOLING_CHECKSUM_MISMATCH", "contract digest mismatch")
    if contract.get("schema") != "lazy-series.automatic-tooling.contract" or contract.get("schema_version") != 1:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract schema is unsupported")
    return os.environ.get("LAZYBUDDY_CONTRACT_DIGEST", actual)


def default_config() -> dict[str, object]:
    return {"schema_version": 1, "credentials": {}, "approvals": []}


def valid_reference(value: str) -> bool:
    keychain = rf"keychain://{re.escape(KEYCHAIN_SERVICE_PREFIX)}\.[A-Za-z0-9_.-]+/{KEYCHAIN_ACCOUNT}"
    environment = r"env://[A-Z][A-Z0-9_]*"
    return bool(re.fullmatch(keychain, value) or re.fullmatch(environment, value) or ENCRYPTED_REFERENCE.fullmatch(value))


def validate(value: object) -> None:
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "user config schema is unsupported")
    credentials = value.get("credentials")
    approvals = value.get("approvals")
    if not isinstance(credentials, dict) or not isinstance(approvals, list):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "user config is malformed")
    for provider, reference in credentials.items():
        if not isinstance(provider, str) or not isinstance(reference, str) or not valid_reference(reference):
            fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "user config may contain only credential references")
    for entry in approvals:
        if not isinstance(entry, dict) or set(entry) != {"workspace", "capability", "provider", "decision", "scope", "digest"}:
            fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "approval ledger is malformed")
        if entry["decision"] not in {"allow", "deny"} or entry["scope"] not in {"once", "workspace", "deny"}:
            fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "approval ledger contains an invalid decision")


def read_config(path: Path) -> dict[str, object]:
    if not path.exists():
        return default_config()
    if path.is_symlink() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "user config must be a non-symlink mode 0600 file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "user config is malformed")
    validate(value)
    return value


def write_config(path: Path, value: dict[str, object]) -> None:
    validate(value)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    lock_path = path.with_suffix(".lock")
    with open(lock_path, "a", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        descriptor, temporary = tempfile.mkstemp(prefix="config.", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(value, output, sort_keys=True, separators=(",", ":"))
                output.write("\n")
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def workspace_id(raw: str) -> str:
    candidate = Path(raw)
    if not candidate.is_absolute() or not candidate.is_dir() or candidate.is_symlink():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "workspace must be an existing absolute non-symlink directory")
    return hashlib.sha256(str(candidate.resolve()).encode("utf-8")).hexdigest()
