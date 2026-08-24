#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Final

from lazybuddy_capability_contract import BrokerError, PLUGIN_ROOT, contract_digest, fail
from lazybuddy_capability_process import run_process, timeout_seconds
from lazybuddy_capability_receipt import prepare_toolpack, write_receipt
from lazybuddy_policy import approval_decision, config_path, read_config, workspace_id

ALIASES: Final = {
    "rg": "local_search",
    "search": "local_search",
    "sg": "structural_search",
    "semantic_navigation": "code_navigation",
}
SAFE_CAPABILITIES: Final = frozenset({"local_search", "structural_search", "code_navigation"})
REMOTE_PROVIDERS: Final = {
    "documentation_search": "context7",
    "web_search": "web",
    "external_code_search": "grep_app",
    "architecture_search": "codegraph",
    "browser_automation": "playwright",
    "filesystem_read": "filesystem",
}
METERED_PROVIDERS: Final = frozenset({"context7", "web", "grep_app", "playwright"})
ALWAYS_ASK_ACTIONS: Final = frozenset({"auth", "form", "download", "upload", "publish", "external-write", "purchase", "destructive", "secret-read"})


def absolute_directory(raw: str, label: str) -> Path:
    path = Path(raw)
    if not path.is_absolute() or ".." in path.parts:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", f"{label} must be an absolute traversal-free path")
    if not path.is_dir() or path.is_symlink():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", f"{label} must be an existing non-symlink directory")
    return path.resolve()


def installed_provider(root: Path, capability: str) -> str | None:
    providers = root / "providers"
    if capability == "local_search":
        suffix = "darwin-arm64" if os.uname().machine == "arm64" else "darwin-x64"
        candidate = providers / "node_modules" / "@vscode" / f"ripgrep-{suffix}" / "bin" / "rg"
    else:
        candidate = providers / "node_modules" / "@ast-grep" / "cli" / "ast-grep"
        if not candidate.is_file() or not os.access(candidate, os.X_OK):
            candidate = providers / "node_modules" / "@ast-grep" / "cli" / "sg"
    return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else None


def local_provider(capability: str, toolpack: Path) -> str:
    command = "rg" if capability == "local_search" else "sg"
    host = shutil.which(command)
    if host:
        return host
    owned = installed_provider(toolpack, capability)
    if owned:
        return owned
    providers = toolpack / "providers"
    providers.mkdir(mode=0o700)
    lifecycle = PLUGIN_ROOT / "scripts" / "lazybuddy-tooling.sh"
    run_process(["bash", str(lifecycle), "install", "--tooling-root", str(providers)], toolpack, 120)
    owned = installed_provider(toolpack, capability)
    if owned is None:
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", "locked local provider is unavailable")
    write_receipt(toolpack, contract_digest(), True)
    return owned


def lsp_provider(workspace: Path, toolpack: Path) -> str:
    typescript = any(any(workspace.rglob(pattern)) for pattern in ("*.ts", "*.tsx", "*.js", "*.jsx")) or (workspace / "tsconfig.json").is_file()
    language, command = ("typescript", "typescript-language-server") if typescript else ("python", "basedpyright-langserver")
    candidates = [workspace / "node_modules" / ".bin" / command]
    host = shutil.which(command)
    if host:
        candidates.append(Path(host))
    candidates.append(toolpack / "providers" / "lsp" / "lsp" / language / "node_modules" / ".bin" / command)
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    provider_root = toolpack / "providers"
    provider_root.mkdir(mode=0o700, exist_ok=True)
    if provider_root.is_symlink() or not provider_root.is_dir():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "provider root must be a real private directory")
    lsp_root = provider_root / "lsp"
    try:
        lsp_root.mkdir(mode=0o700, exist_ok=True)
    except FileExistsError:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "LSP root must be a real private directory")
    if lsp_root.is_symlink() or not lsp_root.is_dir():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "LSP root must be a real private directory")
    os.chmod(lsp_root, 0o700)
    lifecycle = PLUGIN_ROOT / "scripts" / "lazybuddy-tooling.sh"
    run_process(["bash", str(lifecycle), "lsp-install", "--target", str(workspace), "--tooling-root", str(lsp_root)], workspace, 120)
    candidate = lsp_root / "lsp" / language / "node_modules" / ".bin" / command
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", "locked LSP provider is unavailable")
    write_receipt(toolpack, contract_digest(), True)
    return str(candidate)


def sanitized_query(raw: str) -> str:
    value = raw
    for secret in os.environ.values():
        if len(secret) >= 8:
            value = value.replace(secret, "[redacted]")
    value = re.sub(r"(?i)\bsource\b(?:\s+[^\s,;]+)?", "[redacted]", value)
    value = re.sub(r"(?i)\.env\b", "[redacted]", value)
    value = re.sub(r"(?i)(?:authorization\s*:\s*)?bearer\s+[^\s,;]+", "[redacted]", value)
    value = re.sub(r"(?i)(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*[^\s,;]+", "[redacted]", value)
    value = re.sub(r"(?:^|\s)/(?:Users|home|private|var)/[^\s]*", " [path]", value)
    return " ".join(value.split())[:512]


def remote_provider(args: argparse.Namespace, canonical: str, workspace: Path) -> None:
    provider = REMOTE_PROVIDERS[canonical]
    if args.action in ALWAYS_ASK_ACTIONS:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "selected action always requires an interactive approval")
    if canonical == "filesystem_read":
        selected = Path(args.path or workspace)
        try:
            selected.resolve().relative_to(workspace)
        except ValueError:
            fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "filesystem reads must remain within the selected workspace")
    if canonical == "architecture_search":
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "CodeGraph install and index initialization remain explicit receipt-owned commands")
    config = read_config(config_path())
    decision = approval_decision(config, workspace_id(str(workspace)), canonical, provider, args.policy, contract_digest())
    if decision != "allowed":
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "provider invocation requires a matching task-scoped approval")
    if provider in METERED_PROVIDERS and not (args.automatic_spend and args.budget > 0):
        fail("AUTOMATIC_TOOLING_EGRESS_DENIED", "metered or unknown-cost provider requires explicit bounded budget consent")
    query = sanitized_query(args.query)
    if not query:
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", "provider query is empty after sanitization")
    adapter_name = f"LAZYBUDDY_PROVIDER_{provider.upper()}_COMMAND"
    adapter = os.environ.get(adapter_name)
    if not adapter:
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", "no task-scoped provider adapter is configured")
    command = shutil.which(adapter)
    if not command:
        fail("AUTOMATIC_TOOLING_PROVIDER_UNAVAILABLE", "configured task-scoped provider adapter is unavailable")
    result = run_process([command, query], workspace, timeout_seconds())
    print(json.dumps({"status": "success", "capability": canonical, "provider": provider, "output": {"trust": "untrusted", "text": sanitized_query(result)}}, sort_keys=True))


def run(args: argparse.Namespace) -> None:
    digest = contract_digest()
    canonical = ALIASES.get(args.capability, args.capability)
    if canonical not in {"local_search", "structural_search", "code_navigation", "architecture_search", "documentation_search", "web_search", "external_code_search", "browser_automation", "filesystem_read"}:
        fail("AUTOMATIC_TOOLING_UNKNOWN_CAPABILITY", "requested capability is not in the canonical contract")
    workspace = absolute_directory(args.workspace or os.getcwd(), "workspace")
    if canonical not in SAFE_CAPABILITIES:
        remote_provider(args, canonical, workspace)
        return
    toolpack, receipt = prepare_toolpack(args.toolpack_root, digest)
    timeout = timeout_seconds()
    if canonical == "code_navigation":
        provider = lsp_provider(workspace, toolpack)
        command = [provider, "--version"]
    else:
        provider = local_provider(canonical, toolpack)
        command = [provider, "--json", "--", args.query, str(workspace)] if canonical == "local_search" else [provider, "--json", "scan", "--pattern", args.query, str(workspace)]
    result = run_process(command, workspace, timeout)
    print(json.dumps({"status": "ok", "capability": canonical, "provider": provider, "result": result, "receipt": str(receipt)}, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    capability = root.add_subparsers(dest="command", required=True).add_parser("capability")
    run_command = capability.add_subparsers(dest="action", required=True).add_parser("run")
    run_command.add_argument("capability")
    run_command.add_argument("--query", required=True)
    run_command.add_argument("--workspace")
    run_command.add_argument("--toolpack-root")
    run_command.add_argument("--policy", choices=("automatic", "ask-once", "always-ask"), default="ask-once")
    run_command.add_argument("--action", default="inspect")
    run_command.add_argument("--path")
    run_command.add_argument("--automatic-spend", action="store_true")
    run_command.add_argument("--budget", type=float, default=0)
    run_command.set_defaults(handler=run)
    return root


def main() -> int:
    try:
        args = parser().parse_args()
        args.handler(args)
    except BrokerError as error:
        print(json.dumps({"error": error.code, "status": "denied"}, sort_keys=True), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
