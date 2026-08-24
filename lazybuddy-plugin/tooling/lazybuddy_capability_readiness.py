#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
from pathlib import Path
from typing import Final

from lazybuddy_capability_contract import BrokerError, PLUGIN_ROOT, contract_digest

READINESS_CONTRACT: Final = PLUGIN_ROOT / "contracts" / "lazyseries-capability-readiness.v2.json"
READINESS_VERSION: Final = "2.0.0"
READINESS_CHECKSUM: Final = READINESS_CONTRACT.with_suffix(READINESS_CONTRACT.suffix + ".sha256")
READINESS_SCHEMA_SHA256: Final = "17898bbc1812c445c26bddacbe286d53eabcd5f2add3f30d10c2515942db1f87"
READINESS_HOSTS: Final = frozenset({"codebuddy-cli", "codebuddy-ide", "workbuddy", "trae-cli", "trae-ide", "trae-work"})
READINESS_REQUIRED_FIELDS: Final = frozenset({"schema_version", "contract_version", "policy_digest", "host", "capability", "provider", "internal_status", "native_mode", "public_label", "package_status", "probe_status", "readiness_scope", "reason_code", "message", "evidence"})
EVIDENCE_REQUIRED_FIELDS: Final = frozenset({"scope", "ref", "sha256", "session_id"})
INTERNAL_STATE_MAPPING: Final = {
    "package-ready": ("invoke-documented", "documented-tested", "ready", "not-run", "package"),
    "owned-ready": ("invoke-documented", "documented-tested", "ready", "not-run", "package"),
    "missing": ("unavailable", "unavailable", "missing", "not-run", "package"),
    "incompatible": ("unavailable", "unavailable", "incompatible", "not-run", "package"),
    "disabled": ("descriptor-only", "documented-untested", "disabled", "not-run", "package"),
    "failed-optional": ("unavailable", "unavailable", "failed", "not-run", "package"),
    "not-initialized": ("descriptor-only", "documented-untested", "not-checked", "not-run", "package"),
    "probe-observed": ("observe-only", "observed-build-specific", "not-checked", "observed", "probe"),
    "current-session-ready": ("invoke-documented", "documented-tested", "ready", "observed", "current-session"),
}
READINESS_CAPABILITIES: Final = (
    ("local_search", "ripgrep"), ("structural_search", "ast-grep"), ("code_navigation", "lsp"),
    ("architecture_search", "codegraph"), ("documentation_search", "context7"), ("web_search", "web"),
    ("external_code_search", "grep_app"), ("browser_automation", "playwright"), ("filesystem_read", "filesystem"),
)


def readiness_contract_integrity(contract_path: Path = READINESS_CONTRACT, checksum_path: Path = READINESS_CHECKSUM) -> bool:
    try:
        raw = contract_path.read_bytes()
        declared = checksum_path.read_text(encoding="utf-8").split()[0]
        contract = json.loads(raw)
    except (FileNotFoundError, IndexError, OSError, json.JSONDecodeError):
        return False
    return (
        declared == READINESS_SCHEMA_SHA256
        and hashlib.sha256(raw).hexdigest() == READINESS_SCHEMA_SHA256
        and contract.get("schema_version") == 2
        and contract.get("contract_version") == READINESS_VERSION
        and contract.get("properties", {}).get("policy_digest", {}).get("const") == contract_digest()
        and contract.get("x-internal-state-mapping") == {key: list(value) for key, value in INTERNAL_STATE_MAPPING.items()}
    )
def safe_directory(path: Path) -> bool:
    return path.is_dir() and not path.is_symlink()


def regular_unlinked(path: Path) -> bool:
    try:
        return path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1
    except OSError:
        return False


def read_object(path: Path) -> dict[str, object] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def canonical_json(value: dict[str, object]) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def tree_digest(root: Path) -> str | None:
    if not safe_directory(root):
        return None
    entries: list[str] = []
    try:
        for directory, directory_names, file_names in os.walk(root, followlinks=False):
            directory_names.sort()
            file_names.sort()
            directory_path = Path(directory)
            entries.append(f"d {directory_path.relative_to(root)}")
            for name in [*directory_names, *file_names]:
                path = directory_path / name
                relative = path.relative_to(root)
                metadata = path.lstat()
                if stat.S_ISLNK(metadata.st_mode):
                    resolved = path.resolve()
                    if not resolved.is_relative_to(root):
                        return None
                    entries.append(f"l {relative} {os.readlink(path)}")
                elif stat.S_ISDIR(metadata.st_mode):
                    continue
                elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
                    digest = hashlib.sha256()
                    with path.open("rb") as source:
                        for chunk in iter(lambda: source.read(65536), b""):
                            digest.update(chunk)
                    entries.append(f"f {relative} {digest.hexdigest()}")
                else:
                    return None
    except OSError:
        return None
    return hashlib.sha256("\n".join(entries).encode()).hexdigest()


def root_state(root: Path) -> tuple[str, dict[str, object] | None]:
    if not root.exists(): return "absent", None
    if not safe_directory(root): return "unsafe", None
    receipt_path = root / ".lazybuddy-tooling-receipt.json"
    receipt = read_object(receipt_path)
    required = {
        "package.json", "package-lock.json", "capabilities.json", "node_modules",
        ".lazybuddy-remote-capabilities.json", ".lazybuddy-tooling-receipt.json",
    }
    entries = {entry.name for entry in root.iterdir()}
    optional = {".lazybuddy-codegraph-receipt.json", ".lazybuddy-npm-runtime", ".lazybuddy-codegraph-runtime"}
    if receipt is None or not entries <= required | optional or not required <= entries:
        return "invalid", None
    if any(not regular_unlinked(root / name) for name in ("package.json", "package-lock.json", "capabilities.json", ".lazybuddy-remote-capabilities.json", ".lazybuddy-tooling-receipt.json")):
        return "invalid", None
    if not safe_directory(root / "node_modules"):
        return "invalid", None
    if any((root / name).is_symlink() or not (root / name).is_dir() for name in (".lazybuddy-npm-runtime", ".lazybuddy-codegraph-runtime") if (root / name).exists()):
        return "invalid", None
    if (root / ".lazybuddy-codegraph-receipt.json").exists() and not regular_unlinked(root / ".lazybuddy-codegraph-receipt.json"):
        return "invalid", None
    if any((root / name).read_bytes() != (PLUGIN_ROOT / "tooling" / name).read_bytes() for name in ("package.json", "package-lock.json", "capabilities.json")):
        return "invalid", None
    digest = tree_digest(root / "node_modules")
    state = read_object(root / ".lazybuddy-remote-capabilities.json")
    if digest is None or state is None: return "invalid", None
    expected_state = {
        "schema_version": 1,
        "owner": "lazybuddy-remote-capabilities",
        "capabilities": {
            "context7": {"enabled": state.get("capabilities", {}).get("context7", {}).get("enabled")},
            "grep_app": {"enabled": state.get("capabilities", {}).get("grep_app", {}).get("enabled")},
        },
    }
    expected_receipt = {
        "schema_version": 1,
        "owner": "lazybuddy-tooling",
        "root": str(root),
        "owned_entries": [
            "package.json", "package-lock.json", "capabilities.json", ".lazybuddy-remote-capabilities.json",
            "node_modules", ".lazybuddy-tooling-receipt.json", ".lazybuddy-codegraph-receipt.json", ".lazybuddy-npm-runtime",
        ],
        "node_modules_digest": digest,
    }
    if state.get("capabilities", {}).get("context7", {}).get("enabled") not in {True, False} or state.get("capabilities", {}).get("grep_app", {}).get("enabled") not in {True, False}:
        return "invalid", None
    if (root / ".lazybuddy-remote-capabilities.json").read_bytes() != canonical_json(expected_state) or receipt != expected_receipt or receipt_path.read_bytes() != canonical_json(expected_receipt):
        return "invalid", None
    return "owned", state


def language_for(target: Path | None) -> str | None:
    if target is None or not safe_directory(target):
        return None
    if any((target / marker).is_file() for marker in ("tsconfig.json", "jsconfig.json")) or any(any(target.rglob(pattern)) for pattern in ("*.ts", "*.tsx", "*.js", "*.jsx")):
        return "typescript"
    if any((target / marker).is_file() for marker in ("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt")) or any(target.rglob("*.py")):
        return "python"
    return "unsupported"


def executable(path: Path | None) -> bool:
    return path is not None and path.is_file() and not path.is_symlink() and os.access(path, os.X_OK)


def host_executable(command: str) -> str | None:
    value = shutil.which(command)
    return value if value and executable(Path(value)) else None


def lsp_owned_provider(root: Path, language: str) -> Path | None:
    receipt_path = root / ".lazybuddy-lsp-receipt.json"
    receipt = read_object(receipt_path)
    command = "typescript-language-server" if language == "typescript" else "basedpyright-langserver"
    provider = root / "lsp" / language / "node_modules" / ".bin" / command
    runtime = root / ".lazybuddy-lsp-npm-runtime"
    if not safe_directory(root) or receipt is None or not executable(provider):
        return None
    if {entry.name for entry in root.iterdir()} != {"lsp", ".lazybuddy-lsp-npm-runtime", ".lazybuddy-lsp-receipt.json"} or not safe_directory(root / "lsp") or not safe_directory(runtime):
        return None
    if {entry.name for entry in runtime.iterdir()} != {"home", "cache", "config", "tmp"} or not all(safe_directory(runtime / name) for name in ("home", "cache", "config", "tmp")):
        return None
    source = PLUGIN_ROOT / "tooling" / "lsp" / language
    if any(not regular_unlinked(root / "lsp" / language / name) or (root / "lsp" / language / name).read_bytes() != (source / name).read_bytes() for name in ("package.json", "package-lock.json")):
        return None
    digest = tree_digest(root / "lsp")
    expected = {"schema_version": 1, "owner": "lazybuddy-lsp-tooling", "root": str(root), "owned_entries": ["lsp", ".lazybuddy-lsp-npm-runtime", ".lazybuddy-lsp-receipt.json"], "lsp_digest": digest}
    return provider if digest is not None and receipt == expected and receipt_path.read_bytes() == canonical_json(expected) else None


def record(capability: str, provider: str | None, status: str, message: str, reason_code: str | None, receipt: dict[str, object] | None, details: dict[str, object], readiness_scope: str = "package") -> dict[str, object]:
    native_mode, public_label, package_status, probe_status, mapped_scope = INTERNAL_STATE_MAPPING[status]
    if readiness_scope != mapped_scope:
        raise ValueError(f"internal_status {status} requires readiness_scope {mapped_scope}")
    policy_digest = contract_digest()
    return {
        "schema_version": 2,
        "contract_version": READINESS_VERSION,
        "policy_digest": policy_digest,
        "host": "codebuddy-cli",
        "capability": capability,
        "provider": provider,
        "internal_status": status,
        "native_mode": native_mode,
        "public_label": public_label,
        "package_status": package_status,
        "probe_status": probe_status,
        "readiness_scope": readiness_scope,
        "reason_code": reason_code,
        "message": message,
        "evidence": {
            "scope": readiness_scope,
            "ref": f"automatic-tooling-contract.v1.json#sha256={policy_digest}",
            "sha256": policy_digest,
            "session_id": None,
        },
    }


def contract_failure_records() -> list[dict[str, object]]:
    return [
        record(capability, provider, "failed-optional", "The packaged readiness contract failed its integrity check.", "CONTRACT_INTEGRITY_INVALID", None, {"source": "contract"})
        for capability, provider in READINESS_CAPABILITIES
    ]


def local_record(capability: str, command: str, owned: Path, state: str) -> dict[str, object]:
    host = host_executable(command)
    if host:
        return record(capability, command, "package-ready", "A compatible package or system provider is available.", None, None, {"source": "host", "path": host})
    if state == "owned" and executable(owned):
        return record(capability, command, "owned-ready", "A receipt-owned provider is ready.", None, {"owner": "lazybuddy-tooling", "schema_version": 1, "state": "ready"}, {"source": "receipt", "path": str(owned)})
    if state in {"invalid", "unsafe"}:
        return record(capability, command, "incompatible", "The tooling root is unsafe or its receipt is invalid.", "RECEIPT_INVALID", None, {"source": "receipt"})
    return record(capability, command, "missing", "No compatible host or receipt-owned provider is available.", "PROVIDER_NOT_FOUND", None, {"source": "detection"})


def navigation_record(target: Path | None, root: Path, state: str) -> dict[str, object]:
    language = language_for(target)
    if language is None:
        return record("code_navigation", "lsp", "not-initialized", "The target project has not been initialized for readiness inspection.", "TARGET_NOT_INITIALIZED", None, {"source": "target"})
    if language == "unsupported":
        return record("code_navigation", "lsp", "missing", "No supported project language was detected.", "PROVIDER_NOT_FOUND", None, {"source": "detection"})
    command = "typescript-language-server" if language == "typescript" else "basedpyright-langserver"
    project = target / "node_modules" / ".bin" / command if target else None
    provider = project if executable(project) else Path(host_executable(command) or "")
    if executable(provider):
        return record("code_navigation", "lsp", "package-ready", "A project or system LSP provider is available.", None, None, {"source": "project" if provider == project else "host", "language": language, "path": str(provider)})
    owned = lsp_owned_provider(root, language)
    if owned is not None:
        return record("code_navigation", "lsp", "owned-ready", "A receipt-owned LSP provider is ready.", None, {"owner": "lazybuddy-lsp-tooling", "schema_version": 1, "state": "ready"}, {"source": "receipt", "language": language, "path": str(owned)})
    if state in {"invalid", "unsafe"} or (root / ".lazybuddy-lsp-receipt.json").exists():
        return record("code_navigation", "lsp", "incompatible", "The tooling root is unsafe or its receipt is invalid.", "RECEIPT_INVALID", None, {"source": "receipt", "language": language})
    return record("code_navigation", "lsp", "missing", "No compatible project, host, or receipt-owned LSP provider is available.", "PROVIDER_NOT_FOUND", None, {"source": "detection", "language": language})


def architecture_record(target: Path | None, root: Path, state: str) -> dict[str, object]:
    receipt = read_object(root / ".lazybuddy-codegraph-receipt.json") if state == "owned" else None
    if state in {"absent", "invalid", "unsafe"} or receipt is None:
        return record("architecture_search", "codegraph", "not-initialized", "The optional CodeGraph lifecycle has not been initialized.", "RECEIPT_ABSENT", None, {"source": "receipt"})
    index = target / ".codegraph" if target else None
    expected = {"schema_version": 1, "owner": "lazybuddy-codegraph", "tooling_root": str(root), "target_root": str(target), "index_path": f"{target}/.codegraph", "created_index": receipt.get("created_index"), "enabled": receipt.get("enabled")}
    if receipt != expected or not isinstance(receipt["enabled"], bool) or not isinstance(receipt["created_index"], bool) or index is None or index.is_symlink() or not index.is_dir():
        return record("architecture_search", "codegraph", "incompatible", "The CodeGraph receipt or project index is incompatible.", "RECEIPT_INVALID", None, {"source": "receipt"})
    if not receipt["enabled"]:
        return record("architecture_search", "codegraph", "disabled", "CodeGraph requires explicit enablement.", "EXPLICIT_ENABLE_REQUIRED", {"owner": "lazybuddy-codegraph", "schema_version": 1, "state": "initialized"}, {"source": "receipt"})
    suffix = {("Darwin", "arm64"): "darwin-arm64", ("Darwin", "x86_64"): "darwin-x64", ("Linux", "aarch64"): "linux-arm64", ("Linux", "arm64"): "linux-arm64", ("Linux", "x86_64"): "linux-x64"}.get((os.uname().sysname, os.uname().machine))
    binary = root / "node_modules" / "@colbymchenry" / f"codegraph-{suffix}" / "bin" / "codegraph" if suffix else None
    if not executable(binary):
        return record("architecture_search", "codegraph", "missing", "The pinned CodeGraph binary is unavailable.", "PROVIDER_NOT_FOUND", None, {"source": "receipt"})
    return record("architecture_search", "codegraph", "owned-ready", "A receipt-owned CodeGraph provider is ready.", None, {"owner": "lazybuddy-codegraph", "schema_version": 1, "state": "ready"}, {"source": "receipt"})


def optional_record(capability: str, provider: str, state: str, remote_state: dict[str, object] | None) -> dict[str, object]:
    if provider in {"context7", "grep_app"} and state in {"invalid", "unsafe"}:
        return record(capability, provider, "failed-optional", "The explicitly managed optional state is invalid.", "OPTIONAL_STATE_INVALID", None, {"source": "receipt"})
    if provider in {"context7", "grep_app"} and remote_state is not None:
        enabled = remote_state["capabilities"][provider]["enabled"]
        if enabled:
            return record(capability, provider, "missing", "The optional remote provider is enabled but its connection is unchecked.", "REMOTE_CONNECTION_UNCHECKED", None, {"source": "state"})
    return record(capability, provider, "disabled", "The optional provider requires explicit activation.", "EXPLICIT_ENABLE_REQUIRED", None, {"source": "policy"})


def records(tooling_root: Path, target: Path | None, contract_paths: tuple[Path, Path] | None = None) -> list[dict[str, object]]:
    contract_path, checksum_path = contract_paths or (READINESS_CONTRACT, READINESS_CHECKSUM)
    if not readiness_contract_integrity(contract_path, checksum_path):
        return contract_failure_records()
    state, remote_state = root_state(tooling_root)
    suffix = "darwin-arm64" if os.uname().machine == "arm64" else "darwin-x64"
    local_owned = tooling_root / "node_modules" / "@vscode" / f"ripgrep-{suffix}" / "bin" / "rg"
    structural_owned = tooling_root / "node_modules" / "@ast-grep" / "cli" / "ast-grep"
    if not executable(structural_owned):
        structural_owned = tooling_root / "node_modules" / "@ast-grep" / "cli" / "sg"
    return [
        local_record("local_search", "rg", local_owned, state),
        local_record("structural_search", "sg", structural_owned, state),
        navigation_record(target, tooling_root, state),
        architecture_record(target, tooling_root, state),
        optional_record("documentation_search", "context7", state, remote_state),
        optional_record("web_search", "web", state, remote_state),
        optional_record("external_code_search", "grep_app", state, remote_state),
        optional_record("browser_automation", "playwright", state, remote_state),
        optional_record("filesystem_read", "filesystem", state, remote_state),
    ]


def validate_readiness_record(value: object, *, source_scope: str, current_session_id: str | None = None) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("readiness receipt must be an object")
    unknown = set(value) - READINESS_REQUIRED_FIELDS
    missing = READINESS_REQUIRED_FIELDS - set(value)
    if unknown:
        raise ValueError(f"readiness receipt has unknown fields: {', '.join(sorted(unknown))}")
    if missing:
        raise ValueError(f"readiness receipt is missing required field: {', '.join(sorted(missing))}")
    if value["schema_version"] != 2:
        raise ValueError("schema_version must be 2")
    if value["contract_version"] != READINESS_VERSION:
        raise ValueError(f"contract_version must be {READINESS_VERSION}")
    if value["policy_digest"] != contract_digest():
        raise ValueError("policy_digest does not match the packaged policy")
    if not isinstance(value["host"], str) or value["host"] not in READINESS_HOSTS:
        raise ValueError("host is not a declared LazySeries surface")
    if not isinstance(value["capability"], str) or not value["capability"]:
        raise ValueError("capability must be a non-empty string")
    if value["provider"] is not None and not isinstance(value["provider"], str):
        raise ValueError("provider must be a string or null")
    internal_status = value["internal_status"]
    if not isinstance(internal_status, str):
        raise ValueError("internal_status is unknown")
    mapping = INTERNAL_STATE_MAPPING.get(internal_status)
    if mapping is None:
        raise ValueError("internal_status is unknown")
    actual_mapping = (value["native_mode"], value["public_label"], value["package_status"], value["probe_status"], value["readiness_scope"])
    if actual_mapping != mapping:
        raise ValueError("internal_status mapping is inconsistent")
    if value["reason_code"] is not None and not isinstance(value["reason_code"], str):
        raise ValueError("reason_code must be a string or null")
    if not isinstance(value["message"], str):
        raise ValueError("message must be a string")
    evidence = value["evidence"]
    if not isinstance(evidence, dict):
        raise ValueError("evidence must be an object")
    evidence_unknown = set(evidence) - EVIDENCE_REQUIRED_FIELDS
    evidence_missing = EVIDENCE_REQUIRED_FIELDS - set(evidence)
    if evidence_unknown:
        raise ValueError(f"evidence has unknown fields: {', '.join(sorted(evidence_unknown))}")
    if evidence_missing:
        raise ValueError(f"evidence is missing required field: {', '.join(sorted(evidence_missing))}")
    if evidence["scope"] != value["readiness_scope"]:
        raise ValueError("evidence scope does not match readiness_scope")
    if not isinstance(evidence["ref"], str) or not evidence["ref"]:
        raise ValueError("evidence ref must be a non-empty string")
    digest = evidence["sha256"]
    if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("evidence sha256 must be a lowercase SHA-256 digest")
    if source_scope != value["readiness_scope"]:
        if source_scope == "package":
            raise ValueError("package evidence cannot emit host-ready readiness")
        raise ValueError("source scope does not match readiness_scope")
    session_id = evidence["session_id"]
    if source_scope == "current-session":
        if not isinstance(current_session_id, str) or not current_session_id or session_id != current_session_id:
            raise ValueError("evidence does not belong to the current session")
    elif session_id is not None:
        raise ValueError("non-session evidence must not contain a session_id")
    return value


def normalize_v1_readiness_record(value: object) -> dict[str, object]:
    required = {"schema_version", "contract_version", "contract_digest", "host", "capability", "provider", "status", "readiness_scope", "reason_code", "message", "receipt", "details"}
    if not isinstance(value, dict) or set(value) != required or value.get("schema_version") != 1 or value.get("contract_version") != "0.18.0":
        raise ValueError("historical v1 readiness receipt is invalid")
    host = {"lazybuddy": "codebuddy-cli", "lazytrae": "trae-cli"}.get(value["host"])
    status = value["status"]
    if host is None or not isinstance(status, str) or status not in INTERNAL_STATE_MAPPING:
        raise ValueError("historical v1 readiness receipt has unknown host or status")
    normalized = record(value["capability"], value["provider"], status, value["message"], value["reason_code"], None, {})
    normalized["host"] = host
    return normalized


def validate(value: list[dict[str, object]]) -> None:
    if not value:
        raise ValueError("readiness records are empty")
    for item in value:
        validate_readiness_record(item, source_scope="package")


def validate_package_records(value: list[dict[str, object]]) -> None:
    validate(value)
    if any(item["readiness_scope"] != "package" for item in value):
        raise ValueError("package evidence cannot emit host-ready readiness")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Read-only LazyBuddy capability readiness report")
    actions = result.add_subparsers(dest="command", required=True)
    action = actions.add_parser("readiness-report")
    action.add_argument("--tooling-root", type=Path, default=PLUGIN_ROOT / ".lazybuddy-readiness-uninitialized")
    action.add_argument("--target", type=Path)
    action.add_argument("--json", action="store_true", required=True)
    validate_action = actions.add_parser("validate-receipt")
    validate_action.add_argument("--file", type=Path, required=True)
    validate_action.add_argument("--source-scope", choices=("package", "probe", "current-session"), required=True)
    validate_action.add_argument("--current-session-id")
    validate_action.add_argument("--contract-path", type=Path, default=READINESS_CONTRACT)
    validate_action.add_argument("--checksum-path", type=Path, default=READINESS_CHECKSUM)
    return result


def main() -> int:
    args = parser().parse_args()
    if args.command == "validate-receipt":
        try:
            if not readiness_contract_integrity(args.contract_path, args.checksum_path):
                raise ValueError("contract checksum or policy binding is invalid")
            value = json.loads(args.file.read_text(encoding="utf-8"))
            parsed = validate_readiness_record(value, source_scope=args.source_scope, current_session_id=args.current_session_id)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            print(f"readiness receipt invalid: {error}", file=sys.stderr)
            return 2
        print(json.dumps(parsed, sort_keys=True))
        return 0
    if not args.tooling_root.is_absolute() or ".." in args.tooling_root.parts: parser().error("--tooling-root must be an absolute traversal-free path")
    if args.target is not None and (not args.target.is_absolute() or ".." in args.target.parts): parser().error("--target must be an absolute traversal-free path")
    try:
        value = records(args.tooling_root, args.target)
        validate_package_records(value)
    except (BrokerError, ValueError) as error:
        print(f"readiness report error: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"records": value}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
