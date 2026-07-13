#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NoReturn

PLUGIN_ROOT: Final = Path(__file__).resolve().parent.parent
CONTRACT: Final = PLUGIN_ROOT / "contracts" / "automatic-tooling-contract.v1.json"
SIDECAR: Final = CONTRACT.with_suffix(CONTRACT.suffix + ".sha256")
MAX_QUERY_LENGTH: Final = 160
ARCHITECTURE_FILE_THRESHOLD: Final = 500
LEGACY_CAPABILITIES: Final = {
    "rg": "local_search",
    "search": "local_search",
    "sg": "structural_search",
    "semantic_navigation": "code_navigation",
    "docs": "documentation_search",
    "library_documentation": "documentation_search",
    "external_code_examples": "external_code_search",
    "architecture_exploration": "architecture_search",
}
SECRET_ASSIGNMENT: Final = re.compile(r"(?i)(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*[^\s,;]+")
SECRET_WORD_VALUE: Final = re.compile(r"(?i)\b(?:api[_-]?key|secret|token|password|credential)\b\s+[^\s,;]+")
AUTHORIZATION_BEARER: Final = re.compile(r"(?i)\bauthorization\s*:\s*bearer\s+[^\s,;]+")
PROMPT_OVERRIDE: Final = re.compile(r"(?i)\b(?:ignore|disregard|override)\b.{0,48}\b(?:instructions?|rule|policy)\b")


class DetectorError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class TaskContext:
    question: str
    already_tried_local: bool


def fail(code: str, message: str) -> NoReturn:
    raise DetectorError(code, message)


def read_contract() -> dict[str, object]:
    try:
        raw = CONTRACT.read_bytes()
        declared = SIDECAR.read_text(encoding="utf-8").split()[0]
        value = json.loads(raw)
    except (FileNotFoundError, IndexError, json.JSONDecodeError):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract is unreadable")
    if hashlib.sha256(raw).hexdigest() != declared or not re.fullmatch(r"[0-9a-f]{64}", declared):
        fail("AUTOMATIC_TOOLING_CHECKSUM_MISMATCH", "contract digest mismatch")
    if not isinstance(value, dict) or value.get("schema") != "lazy-series.automatic-tooling.contract" or value.get("schema_version") != 1:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "contract schema is unsupported")
    return value


def canonical_capability(raw: str, contract: dict[str, object]) -> str:
    canonical = LEGACY_CAPABILITIES.get(raw, raw)
    capabilities = contract.get("capabilities")
    if not isinstance(capabilities, dict) or canonical not in capabilities:
        fail("AUTOMATIC_TOOLING_UNKNOWN_CAPABILITY", "requested capability is not in the canonical contract")
    return canonical


def workspace(raw: str) -> Path:
    value = Path(raw)
    if not value.is_absolute() or ".." in value.parts or not value.is_dir() or value.is_symlink():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "workspace must be an existing absolute non-symlink directory")
    return value.resolve()


def parse_context(raw: str) -> TaskContext:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "task context must be JSON")
    if not isinstance(value, dict) or set(value) != {"question", "alreadyTriedLocal"}:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "task context must contain only question and alreadyTriedLocal")
    question = value["question"]
    tried = value["alreadyTriedLocal"]
    if not isinstance(question, str) or not question.strip() or not isinstance(tried, bool):
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "task context has invalid field types")
    return TaskContext(question=question.strip(), already_tried_local=tried)


def repository_facts(root: Path) -> dict[str, object]:
    extensions = {".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust"}
    languages: set[str] = set()
    source_files = 0
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in extensions:
            languages.add(extensions[path.suffix])
            source_files += 1
    packages = sorted(name for name in ("package.json", "pyproject.toml", "go.mod", "Cargo.toml") if (root / name).is_file())
    git_state = "not_repository"
    if (root / ".git").exists():
        result = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], check=False, capture_output=True, text=True)
        git_state = "dirty" if result.stdout else "clean"
    return {"languages": sorted(languages), "package_files": packages, "source_files": source_files, "git_state": git_state}


def bounded_query(question: str) -> str:
    redacted = AUTHORIZATION_BEARER.sub("Authorization: Bearer [redacted]", question)
    redacted = SECRET_ASSIGNMENT.sub("[redacted]", redacted)
    redacted = SECRET_WORD_VALUE.sub("[redacted]", redacted)
    compact = " ".join(redacted.split())
    return compact[:MAX_QUERY_LENGTH]


def detect_capability(context: TaskContext, facts: dict[str, object]) -> tuple[str, str, list[str]]:
    question = context.question.lower()
    evidence = [f"language:{language}" for language in facts["languages"] if isinstance(language, str)]
    if context.already_tried_local:
        evidence.append("already_tried_local")
    else:
        return "local_search", "local repository evidence has not been exhausted", evidence
    if PROMPT_OVERRIDE.search(context.question):
        evidence.append("untrusted_instruction_text_ignored")
    if any(token in question for token in ("browser", "ui", "click", "navigate page", "visual")):
        return "browser_automation", "the task explicitly requires browser or UI interaction", evidence
    source_files = facts["source_files"]
    is_large = isinstance(source_files, int) and source_files >= ARCHITECTURE_FILE_THRESHOLD
    if any(token in question for token in ("architecture", "dependency graph", "cross-module", "cross module")) and (is_large or "cross-module" in question or "cross module" in question):
        evidence.append(f"source_files:{source_files}")
        return "architecture_search", "the task requires cross-module architecture evidence", evidence
    if any(token in question for token in ("current", "latest", "version", "api", "documentation", "how does", "library")):
        return "documentation_search", "the task requires version-sensitive documentation after local evidence", evidence
    if any(token in question for token in ("other repositories", "open source example", "external code", "github example")):
        return "external_code_search", "the task requires external code evidence after local evidence", evidence
    return "local_search", "local repository evidence remains the bounded default", evidence


def detect(args: argparse.Namespace) -> None:
    facts = repository_facts(workspace(args.workspace))
    context = parse_context(args.context_json)
    capability, reason, evidence = detect_capability(context, facts)
    request = {"capability": capability, "reason": reason, "evidence": sorted(evidence), "query": bounded_query(context.question)}
    print(json.dumps({"status": "ok", "request": request, "repository": facts}, sort_keys=True))


def parse_outcomes(raw: str, contract: dict[str, object]) -> dict[str, str]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "outcomes must be JSON")
    if not isinstance(value, dict) or not value:
        fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "outcomes must be a non-empty capability map")
    outcomes: dict[str, str] = {}
    for capability, status in value.items():
        if not isinstance(capability, str) or not isinstance(status, str) or status not in {"unavailable", "denied", "success", "timeout", "provider_error"}:
            fail("AUTOMATIC_TOOLING_UNKNOWN_SCHEMA", "outcomes contain invalid capability status")
        canonical = canonical_capability(capability, contract)
        if outcomes.get(canonical) == "denied" or status == "denied":
            outcomes[canonical] = "denied"
        else:
            outcomes[canonical] = status
    return outcomes


def fallback_chain(capability: str, contract: dict[str, object]) -> list[str]:
    capabilities = contract["capabilities"]
    assert isinstance(capabilities, dict)
    definition = capabilities[capability]
    assert isinstance(definition, dict)
    fallbacks = definition.get("fallbacks")
    assert isinstance(fallbacks, list) and all(isinstance(item, str) for item in fallbacks)
    return [capability, *fallbacks]


def fallback(args: argparse.Namespace) -> None:
    contract = read_contract()
    initial = canonical_capability(args.capability, contract)
    outcomes = parse_outcomes(args.outcomes_json, contract)
    chain = fallback_chain(initial, contract)
    attempts: list[str] = []
    for index, capability in enumerate(chain):
        attempts.append(capability)
        outcome = outcomes.get(capability, "unavailable")
        if outcome == "denied":
            print(json.dumps({"status": "denied", "capability": capability, "attempts": attempts, "next_action": "none", "query_data": "redacted"}, sort_keys=True))
            return
        if outcome == "success":
            print(json.dumps({"status": "complete", "capability": capability, "attempts": attempts, "next_action": "none", "query_data": "redacted", "result_trust": "untrusted"}, sort_keys=True))
            return
        if index + 1 < len(chain):
            next_capability = chain[index + 1]
            print(json.dumps({"status": "fallback", "capability": next_capability, "attempts": [*attempts, next_capability], "next_action": "request_capability", "query_data": "redacted"}, sort_keys=True))
            return
    print(json.dumps({"status": "unavailable", "capability": initial, "attempts": attempts, "next_action": "none", "query_data": "redacted"}, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    detect_command = commands.add_parser("detect")
    detect_command.add_argument("--workspace", required=True)
    detect_command.add_argument("--context-json", required=True)
    detect_command.set_defaults(handler=detect)
    fallback_command = commands.add_parser("fallback")
    fallback_command.add_argument("capability")
    fallback_command.add_argument("--outcomes-json", required=True)
    fallback_command.add_argument("--result")
    fallback_command.set_defaults(handler=fallback)
    return root


def main() -> int:
    try:
        args = parser().parse_args()
        args.handler(args)
    except DetectorError as error:
        print(json.dumps({"error": error.code, "status": "denied"}, sort_keys=True), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
