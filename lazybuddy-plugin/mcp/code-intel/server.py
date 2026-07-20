#!/usr/bin/env python3
"""code-intel MCP server — WorkBuddy-native LSP substitute.

Provides diagnostics (runs the project's real linter/typechecker) plus heuristic
symbol tools (find_references, goto_definition, symbols) via grep. This is a
lighter, tooling-driven substitute.

NOT a real LSP: no go-to-definition via language server, no workspace rename.
diagnostics runs actual linters; symbol ops are grep heuristics.

Single-shot JSON-RPC 2.0 over stdio.
Tools: diagnostics, typecheck, find_references, goto_definition, symbols.
"""
import sys, json, os, subprocess, re, shutil

CWD = os.environ.get("CWD", ".")
MCP_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if MCP_ROOT not in sys.path:
    sys.path.insert(0, MCP_ROOT)
from path_boundary import resolve_repo_path
from jsonrpc import serve

USE_RG = shutil.which("rg") is not None
EXCLUDES = [".git", "node_modules", "dist", "build", ".next", ".lazybuddy", "reference", ".workbuddy"]


def grep_lines(pattern, is_regex=True):
    if USE_RG:
        cmd = ["rg", "-n", "--no-heading"] + (["-e", pattern] if is_regex else ["-F", pattern]) + ["."]
        for x in EXCLUDES:
            cmd += ["-g", "!" + x + "/"]
    else:
        cmd = ["grep", "-rn"] + (["-E"] if is_regex else ["-F"]) + [pattern, "."]
        for x in EXCLUDES:
            cmd += ["--exclude-dir=" + x]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=CWD, timeout=60)
        return [l for l in r.stdout.split("\n") if l] if r.stdout else []
    except Exception as e:
        sys.stderr.write("code-intel grep error: %s\n" % e)
        return []


def has_bin(b):
    return shutil.which(b) is not None


def run_cmd(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=CWD, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return -1, "error running %s: %s" % (cmd[0], e)


def detect_and_run_diagnostics(path):
    """Auto-detect project tooling and run the relevant checker on `path` (or whole project if path is empty)."""
    target = path or "."
    results = []
    pkg_json = os.path.join(CWD, "package.json")
    tsconfig = os.path.join(CWD, "tsconfig.json")
    pyproject = os.path.join(CWD, "pyproject.toml")
    setup_cfg = os.path.join(CWD, "setup.cfg")
    go_mod = os.path.join(CWD, "go.mod")
    cargo = os.path.join(CWD, "Cargo.toml")

    # --- TypeScript / JavaScript ---
    if os.path.exists(tsconfig) and has_bin("npx"):
        rc, out = run_cmd(["npx", "--no-install", "tsc", "--noEmit", "--pretty", "false"], timeout=120)
        results.append(("tsc", rc, out.strip()[:8000]))
    elif os.path.exists(pkg_json) and has_bin("npx"):
        # try eslint on the file
        if path:
            rc, out = run_cmd(["npx", "--no-install", "eslint", "--no-error-on-unmatched-pattern", path], timeout=90)
            results.append(("eslint", rc, out.strip()[:8000]))

    # --- Python ---
    is_py = target.endswith(".py") or os.path.exists(pyproject) or os.path.exists(setup_cfg)
    if is_py:
        if has_bin("ruff"):
            args = ["ruff", "check", target]
            rc, out = run_cmd(args, timeout=90)
            results.append(("ruff", rc, out.strip()[:8000]))
        elif has_bin("pyright"):
            rc, out = run_cmd(["pyright", target] if path else ["pyright"], timeout=120)
            results.append(("pyright", rc, out.strip()[:8000]))
        elif has_bin("mypy"):
            rc, out = run_cmd(["mypy", target], timeout=120)
            results.append(("mypy", rc, out.strip()[:8000]))

    # --- Go ---
    if os.path.exists(go_mod) and has_bin("go"):
        rc, out = run_cmd(["go", "vet", "./..."], timeout=120)
        results.append(("go vet", rc, out.strip()[:8000]))

    # --- Rust ---
    if os.path.exists(cargo) and has_bin("cargo"):
        rc, out = run_cmd(["cargo", "check", "--message-format=short"], timeout=180)
        results.append(("cargo check", rc, out.strip()[:8000]))

    if not results:
        return "No recognized linter/typechecker found for this project (looked for tsc/eslint/ruff/pyright/mypy/go vet/cargo). Install one or run your project's check command directly."
    out = "diagnostics for %s:\n" % (path or "whole project")
    for name, rc, txt in results:
        status = "PASS (exit %d)" % rc if rc == 0 else "ISSUES (exit %d)" % rc
        out += "\n--- %s — %s ---\n" % (name, status)
        if txt:
            out += txt + "\n"
    return out


def handle(req, notification):
    method = req.get("method", "")
    rid = req.get("id", 0)
    params = req.get("params", {})

    def reply(j):
        if not notification:
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": j}), flush=True)

    def err(m):
        if not notification:
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": m}}), flush=True)

    def tool_result(text):
        reply({"content": [{"type": "text", "text": text}]})

    if method == "initialize":
        reply({"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "code-intel", "version": "1.0.3"}})
        return

    if method == "tools/list":
        reply({"tools": [
            {"name": "diagnostics", "description": "Run the project's linter/typechecker on a file or the whole project. Auto-detects tsc/eslint/ruff/pyright/mypy/go vet/cargo. Returns errors/warnings. Use as a diagnostics gate after edits.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "repo-relative file path; omit for whole-project check"}}}},
            {"name": "typecheck", "description": "Run a full-project typecheck (tsc --noEmit / pyright / mypy / go vet / cargo check). Convenience wrapper around diagnostics with no path.", "inputSchema": {"type": "object", "properties": {}}},
            {"name": "find_references", "description": "Find all references to a symbol across the repo (word-boundary grep). Heuristic — includes comments/strings, not semantic.", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}, "limit": {"type": "integer", "default": 100}}, "required": ["symbol"]}},
            {"name": "goto_definition", "description": "Find likely definitions of a symbol (function/class/const/def/func/interface/type declarations). Heuristic grep, not a language server.", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}, "limit": {"type": "integer", "default": 30}}, "required": ["symbol"]}},
            {"name": "symbols", "description": "Outline symbols declared in a single file (function/class/const/def/interface/type). Heuristic grep.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "repo-relative file path"}}, "required": ["path"]}},
        ]})
        return

    if method == "tools/call":
        tool = params.get("name", "")
        args = params.get("arguments", {})
        try:
            if tool == "diagnostics":
                path = args.get("path", "")
                if path:
                    path = os.path.relpath(resolve_repo_path(CWD, path), os.path.realpath(CWD))
                tool_result(detect_and_run_diagnostics(path))

            elif tool == "typecheck":
                tool_result(detect_and_run_diagnostics(""))

            elif tool == "find_references":
                sym = re.escape(args["symbol"])
                limit = args.get("limit", 100)
                lines = grep_lines(r"\b" + sym + r"\b")[:limit]
                out = 'find_references "%s" (%d hits):\n' % (args["symbol"], len(lines))
                for l in lines:
                    out += "  " + l + "\n"
                tool_result(out)

            elif tool == "goto_definition":
                sym = re.escape(args["symbol"])
                limit = args.get("limit", 30)
                decl = r"\b(function|class|const|let|def|func|interface|type|enum|struct|impl|public|private|static)\s+" + sym + r"\b"
                lines = grep_lines(decl)[:limit]
                out = 'goto_definition "%s" (%d candidates):\n' % (args["symbol"], len(lines))
                for l in lines:
                    out += "  " + l + "\n"
                tool_result(out)

            elif tool == "symbols":
                path = args["path"]
                fp = resolve_repo_path(CWD, path)
                if not os.path.isfile(fp):
                    err("file not found: " + path)
                    return
                src = open(fp, errors="ignore").read().split("\n")
                decl = re.compile(r"\b(function|class|const|let|def|func|interface|type|enum|struct|impl)\s+([A-Za-z_][A-Za-z0-9_]*)")
                out = "symbols in %s:\n" % path
                count = 0
                for i, line in enumerate(src, 1):
                    for m in decl.finditer(line):
                        out += "  %s:%d  %s %s\n" % (path, i, m.group(1), m.group(2))
                        count += 1
                out = "symbols in %s (%d):\n" % (path, count) + "\n".join(out.split("\n")[1:])
                tool_result(out)

            else:
                err("unknown tool: " + tool)
        except Exception as e:
            err("tool error: " + str(e))
        return

    err("unsupported method: " + method)


def main():
    serve(handle)


if __name__ == "__main__":
    main()
