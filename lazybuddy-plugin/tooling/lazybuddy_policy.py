#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from lazybuddy_policy_config import (
    ENCRYPTED_REFERENCE,
    PolicyError,
    config_path,
    contract_digest,
    fail,
    read_config,
    valid_reference,
    workspace_id,
    write_config,
)


def approval_decision(config: dict[str, object], workspace: str, capability: str, provider: str, policy: str, digest: str) -> str:
    if policy == "always-ask":
        return "ask"
    ledger = config["approvals"]
    assert isinstance(ledger, list)
    matches = [entry for entry in ledger if isinstance(entry, dict) and entry["workspace"] == workspace and entry["capability"] == capability and entry["provider"] == provider and entry["digest"] == digest]
    if any(entry["decision"] == "deny" for entry in matches):
        return "denied"
    if policy == "automatic":
        return "allowed"
    if any(entry["decision"] == "allow" and entry["scope"] in {"once", "workspace"} for entry in matches):
        return "allowed"
    return "ask"


def provider_reference(config: dict[str, object], provider: str, environment_name: str) -> str | None:
    credentials = config["credentials"]
    assert isinstance(credentials, dict)
    configured = credentials.get(provider)
    if isinstance(configured, str) and configured.startswith("keychain://"):
        return configured
    if environment_name in os.environ:
        return f"env://{environment_name}"
    if isinstance(configured, str) and ENCRYPTED_REFERENCE.fullmatch(configured):
        return configured
    return None


def emit(value: dict[str, object], as_json: bool) -> None:
    if as_json:
        print(json.dumps(value, sort_keys=True))
        return
    for key, item in value.items():
        print(f"{key.upper()}: {item}")


def provider_status(config: dict[str, object], workspace: str, policy: str) -> dict[str, object]:
    digest = contract_digest()
    documentation_decision = approval_decision(config, workspace, "documentation_search", "context7", policy, digest) if workspace else "ask"
    external_code_decision = approval_decision(config, workspace, "external_code_search", "grep_app", policy, digest) if workspace else "ask"
    architecture_decision = approval_decision(config, workspace, "architecture_search", "codegraph", policy, digest) if workspace else "ask"
    browser_decision = approval_decision(config, workspace, "browser_automation", "playwright", policy, digest) if workspace else "ask"
    return {
        "contract_digest": digest,
        "providers": {
            "ripgrep": {"self_hosted": True, "cost": "free", "api_key": "not_required", "read_only": True, "reachability": "local", "decision": "allowed"},
            "ast_grep": {"self_hosted": True, "cost": "free", "api_key": "not_required", "read_only": True, "reachability": "local", "decision": "allowed"},
            "lsp": {"self_hosted": True, "cost": "free", "api_key": "not_required", "read_only": True, "reachability": "local", "decision": "allowed"},
            "codegraph": {"self_hosted": True, "cost": "free", "api_key": "not_required", "read_only": True, "reachability": "not_started", "decision": architecture_decision},
            "context7": {"self_hosted": False, "cost": "free_or_metered", "api_key": "optional", "credential_ref": provider_reference(config, "context7", "CONTEXT7_API_KEY"), "credential_source": "reference-only", "read_only": True, "reachability": "not_contacted", "decision": documentation_decision},
            "web": {"self_hosted": False, "cost": "host_governed", "api_key": "host_managed", "read_only": True, "reachability": "host_governed", "decision": "ask"},
            "grep_app": {"self_hosted": False, "cost": "free_or_metered", "api_key": "not_required", "credential_ref": None, "read_only": True, "reachability": "not_contacted", "decision": external_code_decision},
            "filesystem": {"self_hosted": True, "cost": "free", "api_key": "not_required", "read_only": True, "reachability": "workspace_scoped", "decision": "allowed"},
            "playwright": {"self_hosted": True, "cost": "free_or_metered", "api_key": "not_required", "read_only": True, "reachability": "not_started", "decision": browser_decision},
        },
    }


def providers_status(args: argparse.Namespace) -> None:
    config = read_config(config_path())
    workspace = workspace_id(args.workspace) if args.workspace else ""
    emit(provider_status(config, workspace, args.policy), args.json)


def setup(args: argparse.Namespace) -> None:
    if not args.non_interactive:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "setup requires --non-interactive in this non-prompting command surface")
    path = config_path()
    config = read_config(path)
    if not path.exists():
        write_config(path, config)
    emit(provider_status(config, "", "ask-once"), args.json)


def providers_configure(args: argparse.Namespace) -> None:
    if not args.non_interactive or args.consent != "yes":
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "noninteractive credential configuration requires --consent yes")
    if args.provider not in {"context7"}:
        fail("AUTOMATIC_TOOLING_UNKNOWN_PROVIDER", "provider does not accept a credential reference")
    if not valid_reference(args.credential_ref):
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "credential configuration accepts only an opaque keychain, encrypted, or env reference")
    path = config_path()
    config = read_config(path)
    credentials = config["credentials"]
    assert isinstance(credentials, dict)
    credentials[args.provider] = args.credential_ref
    write_config(path, config)
    emit({"provider": args.provider, "credential_ref": args.credential_ref, "status": "configured"}, args.json)


def providers_test(args: argparse.Namespace) -> None:
    path = config_path()
    config = read_config(path)
    if not path.exists():
        write_config(path, config)
    workspace = workspace_id(args.workspace) if args.workspace else ""
    emit(provider_status(config, workspace, args.policy), args.json)


def approval(args: argparse.Namespace) -> None:
    digest = contract_digest()
    path = config_path()
    config = read_config(path)
    identity = workspace_id(args.workspace)
    if args.action == "check":
        decision = approval_decision(config, identity, args.capability, args.provider, args.policy, digest)
        if decision == "allowed" and args.policy == "ask-once":
            ledger = config["approvals"]
            assert isinstance(ledger, list)
            ledger[:] = [entry for entry in ledger if not (isinstance(entry, dict) and entry["workspace"] == identity and entry["capability"] == args.capability and entry["provider"] == args.provider and entry["digest"] == digest and entry["scope"] == "once")]
            write_config(path, config)
        emit({"decision": decision}, args.json)
        return
    ledger = config["approvals"]
    assert isinstance(ledger, list)
    ledger[:] = [entry for entry in ledger if not (isinstance(entry, dict) and entry["workspace"] == identity and entry["capability"] == args.capability and entry["provider"] == args.provider)]
    if args.action != "revoke":
        scope = "deny" if args.action == "deny" else args.scope
        ledger.append({"workspace": identity, "capability": args.capability, "provider": args.provider, "decision": "deny" if args.action == "deny" else "allow", "scope": scope, "digest": digest})
    write_config(path, config)
    emit({"decision": "revoked" if args.action == "revoke" else ("denied" if args.action == "deny" else "allowed")}, args.json)


def toolpack(args: argparse.Namespace) -> None:
    root = Path(args.toolpack_root) if args.toolpack_root else Path.home() / ".local" / "share" / "lazyseries" / "toolpack"
    if not root.is_absolute() or ".." in root.parts:
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack root must be an absolute traversal-free path")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        fail("AUTOMATIC_TOOLING_PERMISSION_DENIED", "toolpack root must not be a symlink")
    os.chmod(root, 0o700)
    emit({"root": str(root.resolve()), "source": "override" if args.toolpack_root else "default", "receipt": str(root / ".lazybuddy-toolpack-receipt.json")}, args.json)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    setup_command = commands.add_parser("setup")
    setup_command.add_argument("--non-interactive", action="store_true")
    setup_command.add_argument("--json", action="store_true")
    setup_command.set_defaults(handler=setup)
    providers_command = commands.add_parser("providers")
    providers_command.add_argument("--workspace")
    providers_command.add_argument("--policy", choices=("automatic", "ask-once", "always-ask"), default="ask-once")
    providers_command.add_argument("--json", action="store_true")
    providers_command.set_defaults(handler=providers_status)
    providers = providers_command.add_subparsers(dest="action")
    test = providers.add_parser("test")
    test.add_argument("--workspace")
    test.add_argument("--policy", choices=("automatic", "ask-once", "always-ask"), default="ask-once")
    test.add_argument("--json", action="store_true")
    test.set_defaults(handler=providers_test)
    configure = providers.add_parser("configure")
    configure.add_argument("--provider", required=True)
    configure.add_argument("--credential-ref", required=True)
    configure.add_argument("--consent")
    configure.add_argument("--non-interactive", action="store_true")
    configure.add_argument("--json", action="store_true")
    configure.set_defaults(handler=providers_configure)
    approvals = commands.add_parser("approval").add_subparsers(dest="action", required=True)
    for name in ("grant", "deny", "revoke", "check"):
        command = approvals.add_parser(name)
        command.add_argument("--workspace", required=True)
        command.add_argument("--capability", required=True)
        command.add_argument("--provider", required=True)
        command.add_argument("--policy", choices=("automatic", "ask-once", "always-ask"), default="ask-once")
        command.add_argument("--json", action="store_true")
        if name == "grant": command.add_argument("--scope", choices=("once", "workspace"), required=True)
        command.set_defaults(handler=approval)
    toolpacks = commands.add_parser("toolpack").add_subparsers(dest="action", required=True)
    resolve = toolpacks.add_parser("resolve")
    resolve.add_argument("--toolpack-root")
    resolve.add_argument("--json", action="store_true")
    resolve.set_defaults(handler=toolpack)
    return root


def main() -> int:
    try:
        args = parser().parse_args()
        args.handler(args)
    except PolicyError as error:
        print(json.dumps({"error": error.code, "status": "denied"}, sort_keys=True), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
