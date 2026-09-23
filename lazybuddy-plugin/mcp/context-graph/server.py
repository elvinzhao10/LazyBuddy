#!/usr/bin/env python3
"""context-graph MCP server — heuristic fallback when real CodeGraph is disabled.

Provides blast-radius / dependency / symbol analysis via grep. It is heuristic,
not a full semantic call graph or the optional real CodeGraph MCP capability.

Single-shot JSON-RPC 2.0 over stdio (same pattern as run-ledger).
Tools: blast_radius, file_deps, symbol_search, symbol_refs, repo_overview.
"""
import sys, json, os, subprocess, re, shutil

CWD = os.environ.get("CWD", ".")
MCP_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if MCP_ROOT not in sys.path:
    sys.path.insert(0, MCP_ROOT)
from path_boundary import PathBoundaryError, resolve_repo_path
from jsonrpc import serve


USE_RG = shutil.which("rg") is not None
IMPORT_SCAN_LIMIT = 10000
EXCLUDES = [".git", "node_modules", "dist", "build", ".next", ".lazybuddy", "reference", ".workbuddy"]


def grep_lines(pattern, is_regex=True):
    """Return matching lines across the repo, excluding junk dirs."""
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
        sys.stderr.write("context-graph grep error: %s\n" % e)
        return []


def stem(path):
    b = os.path.basename(path)
    b = re.sub(r"\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|cs|c|cc|h|hpp|md)$", "", b)
    return b


def literal_imports(line):
    return re.findall(r"(?:\bfrom\s*|\bimport\s*|\brequire\s*\()\s*['\"]([^'\"]+)['\"]", line)


def imports_target(importer, spec, target):
    resolved = resolved_relative_import(importer, spec)
    return resolved == os.path.normpath(target)


def resolved_relative_import(importer, spec):
    if not spec.startswith("."):
        return None
    base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    candidates = [base]
    for ext in [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".json"]:
        candidates.append(base + ext)
    for ext in [".ts", ".js", ".py"]:
        candidates.append(os.path.join(base, "index" + ext))
    for candidate in candidates:
        try:
            candidate_path = resolve_repo_path(CWD, candidate)
        except PathBoundaryError:
            continue
        if os.path.isfile(candidate_path):
            return os.path.relpath(candidate_path, os.path.realpath(CWD))
    return None


def literal_includes(line):
    return re.findall(r"#include\s+[\"<]([^\">]+)[\">]", line)


def includes_target(importer, spec, target):
    resolved = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    return resolved == os.path.normpath(target)


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
        reply({"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "context-graph", "version": "1.3.1"}})
        return

    if method == "tools/list":
        reply({"tools": [
            {"name": "blast_radius", "description": "Who depends on this file? Returns files that import/require the given file (reverse dependencies) — the blast radius if you change it. Heuristic via import-pattern grep.", "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "repo-relative file path"}}, "required": ["path"]}},
            {"name": "file_deps", "description": "What does this file import? Parses import/require statements and resolves to dependency files (forward dependencies).", "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "repo-relative file path"}}, "required": ["path"]}},
            {"name": "symbol_search", "description": "Find symbol definitions (function/class/const/def/interface/type) matching a query, repo-wide. Heuristic declaration-pattern grep.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 50}}, "required": ["query"]}},
            {"name": "symbol_refs", "description": "Find all references to a symbol across the repo (word-boundary grep). Approximate — includes comments/strings.", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}, "limit": {"type": "integer", "default": 100}}, "required": ["symbol"]}},
            {"name": "repo_overview", "description": "Centrality ranking: top files by incoming-reference count (how many other files import them). Helps prioritize review scope.", "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 20}}}},
        ]})
        return

    if method == "tools/call":
        tool = params.get("name", "")
        args = params.get("arguments", {})
        try:
            if tool == "blast_radius":
                path = args["path"]
                name = re.escape(stem(path))
                pattern = (
                    r"(from[[:space:]]*|import[[:space:]]*|require[[:space:]]*\()[[:space:]]*['\"]([^'\"]*/)?"
                    + name + r"(\.[^'\"]+)?['\"]|#include[[:space:]]+[\"<]([^\">]*/)?"
                    + name + r"(\.[^\">]+)?[\">]"
                )
                hits = set()
                for l in grep_lines(pattern):
                    fields = l.split(":", 2)
                    if len(fields) != 3:
                        continue
                    f, _, source = fields
                    f = os.path.normpath(f)
                    if f != os.path.normpath(path) and (
                        any(imports_target(f, spec, path) for spec in literal_imports(source))
                        or any(includes_target(f, spec, path) for spec in literal_includes(source))
                    ):
                        hits.add(f)
                out = "blast_radius for %s (%d dependents):\n" % (path, len(hits))
                for f in sorted(hits)[:100]:
                    out += "  " + f + "\n"
                tool_result(out)

            elif tool == "file_deps":
                path = args["path"]
                fp = resolve_repo_path(CWD, path)
                if not os.path.isfile(fp):
                    err("file not found: " + path)
                    return
                src = open(fp, errors="ignore").read()
                deps = set()
                for m in re.finditer(r"""(?:from|import|require\()\s*['"]([^'"]+)['"]""", src):
                    spec = m.group(1)
                    if spec.startswith(".") or spec.startswith("/"):
                        base = os.path.join(os.path.dirname(path), spec)
                        for ext in ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".json"]:
                            cand = base + ext
                            try:
                                candidate_path = resolve_repo_path(CWD, cand)
                            except PathBoundaryError:
                                continue
                            if os.path.isfile(candidate_path):
                                deps.add(os.path.relpath(candidate_path, os.path.realpath(CWD)))
                                break
                        idx = os.path.join(base, "index")
                        for ext in [".ts", ".js", ".py"]:
                            cand = idx + ext
                            try:
                                candidate_path = resolve_repo_path(CWD, cand)
                            except PathBoundaryError:
                                continue
                            if os.path.isfile(candidate_path):
                                deps.add(os.path.relpath(candidate_path, os.path.realpath(CWD)))
                                break
                    else:
                        deps.add(spec + "  (external)")
                out = "file_deps for %s (%d):\n" % (path, len(deps))
                for d in sorted(deps):
                    out += "  " + d + "\n"
                tool_result(out)

            elif tool == "symbol_search":
                q = re.escape(args["query"])
                limit = args.get("limit", 50)
                decl = r"\b(function|class|const|let|def|interface|type|func|enum|struct|impl)\s+" + q + r"\b"
                lines = grep_lines(decl)[:limit]
                out = 'symbol_search "%s" (%d hits):\n' % (args["query"], len(lines))
                for l in lines:
                    out += "  " + l + "\n"
                tool_result(out)

            elif tool == "symbol_refs":
                sym = re.escape(args["symbol"])
                limit = args.get("limit", 100)
                lines = grep_lines(r"\b" + sym + r"\b")[:limit]
                out = 'symbol_refs "%s" (%d hits):\n' % (args["symbol"], len(lines))
                for l in lines:
                    out += "  " + l + "\n"
                tool_result(out)

            elif tool == "repo_overview":
                limit = args.get("limit", 20)
                import_pattern = r"(from[[:space:]]*|import[[:space:]]*|require[[:space:]]*\()[[:space:]]*['\"][^'\"]+['\"]"
                lines = grep_lines(import_pattern)
                scan_truncated = len(lines) > IMPORT_SCAN_LIMIT
                importers = {}
                for line in lines[:IMPORT_SCAN_LIMIT]:
                    fields = line.split(":", 2)
                    if len(fields) != 3:
                        continue
                    source, _, text = fields
                    source = os.path.normpath(source)
                    for spec in literal_imports(text):
                        target = resolved_relative_import(source, spec)
                        if target and target != source:
                            importers.setdefault(target, set()).add(source)
                scores = [(len(sources), target) for target, sources in importers.items()]
                scores.sort(reverse=True)
                shown = scores[:limit]
                out = "repo_overview — top %d of %d by incoming refs" % (len(shown), len(scores))
                if len(shown) < len(scores):
                    out += " (truncated)"
                if scan_truncated:
                    out += " (scan truncated at %d matching lines)" % IMPORT_SCAN_LIMIT
                out += ":\n"
                for cnt, s in shown:
                    out += "  %3d  %s\n" % (cnt, s)
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
