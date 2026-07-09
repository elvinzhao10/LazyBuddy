#!/usr/bin/env python3
"""docs MCP server — WorkBuddy-native context7 substitute.

Fetches just-in-time library documentation from package registries (npm, pypi)
via curl. Replaces LazyCodex's context7 MCP (an external HTTP doc service). This
is a lighter substitute: resolve a library name -> fetch its README/description.
See docs/lazyworkbuddy-known-gaps.md G-003.

For free-form web search, the agent should use its native WebSearch/WebFetch
tools — this server focuses on structured library-doc resolution (context7's
core value-add).

Single-shot JSON-RPC 2.0 over stdio.
Tools: get_library_docs, list_supported_registries.
"""
import sys, json, os, subprocess, re

CWD = os.environ.get("CWD", ".")
CURL = None
for c in ["curl", "/usr/bin/curl"]:
    try:
        if subprocess.run([c, "--version"], capture_output=True, timeout=5).returncode == 0:
            CURL = c
            break
    except Exception:
        pass


def fetch(url, timeout=20):
    if not CURL:
        return None, "curl not available"
    try:
        r = subprocess.run([CURL, "-sSL", "--max-time", str(timeout), "-A", "lazyworkbuddy-docs/0.11", url],
                           capture_output=True, text=True, timeout=timeout + 5)
        if r.returncode == 0 and r.stdout:
            return r.stdout, None
        return None, r.stderr or ("curl exit %d" % r.returncode)
    except Exception as e:
        return None, str(e)


def fetch_json(url, timeout=20):
    body, err = fetch(url, timeout)
    if err:
        return None, err
    try:
        return json.loads(body), None
    except Exception as e:
        return None, "not JSON: %s" % e


def section(readme, topic):
    """Try to extract the markdown section matching `topic` (## heading)."""
    if not readme or not topic:
        return None
    lines = readme.split("\n")
    pat = re.compile(r"^#+\s*" + re.escape(topic), re.I)
    start = None
    for i, l in enumerate(lines):
        if pat.match(l):
            start = i
            break
    if start is None:
        return None
    out = [lines[start]]
    for l in lines[start + 1:]:
        if re.match(r"^#+\s", l) and not re.match(r"^#+\s*" + re.escape(topic), l, re.I):
            break
        out.append(l)
    return "\n".join(out).strip()


def get_npm_docs(library, topic):
    data, err = fetch_json("https://registry.npmjs.org/" + library + "/latest")
    if err:
        return None, "npm: " + err
    readme = data.get("readme") or ""
    homepage = data.get("homepage") or ""
    desc = data.get("description") or ""
    repo = ""
    if isinstance(data.get("repository"), dict):
        repo = data["repository"].get("url", "")
    if not readme or len(readme) < 50:
        # try fetching homepage or github readme
        if homepage:
            body, _ = fetch(homepage)
            if body:
                readme = body
    if topic:
        sec = section(readme, topic)
        if sec:
            readme = sec
    readme = (readme or "").strip()[:12000]
    return {
        "registry": "npm",
        "library": library,
        "version": data.get("version", ""),
        "description": desc,
        "homepage": homepage,
        "repository": repo,
        "docs": readme or "(no readme available)",
    }, None


def get_pypi_docs(library, topic):
    data, err = fetch_json("https://pypi.org/pypi/" + library + "/json")
    if err:
        return None, "pypi: " + err
    info = data.get("info", {})
    desc = info.get("summary") or info.get("description") or ""
    homepage = info.get("home_page") or ""
    project_urls = info.get("project_urls") or {}
    repo = project_urls.get("Source") or project_urls.get("Repository") or ""
    docs_url = project_urls.get("Documentation") or project_urls.get("Homepage") or homepage
    readme = info.get("description") or ""
    if topic and readme:
        sec = section(readme, topic)
        if sec:
            readme = sec
    readme = (readme or desc or "").strip()[:12000]
    return {
        "registry": "pypi",
        "library": library,
        "version": info.get("version", ""),
        "description": info.get("summary", ""),
        "homepage": homepage,
        "repository": repo,
        "docs_url": docs_url,
        "docs": readme or "(fetch the homepage/docs_url for full docs)",
    }, None


def _is_html(s):
    s = (s or "").lstrip().lower()
    return s.startswith("<!doctype") or s.startswith("<html") or s.startswith("<?xml")


def _better(a, b):
    """True if result a is more useful than b: prefer non-HTML and longer docs."""
    da, db = a.get("docs", ""), b.get("docs", "")
    a_html, b_html = _is_html(da), _is_html(db)
    if a_html != b_html:
        return not a_html  # prefer the non-HTML one
    return len(da) > len(db)


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except Exception:
        print(json.dumps({"jsonrpc": "2.0", "id": 0, "error": {"code": -32700, "message": "parse error"}}))
        return

    method = req.get("method", "")
    rid = req.get("id", 0)
    params = req.get("params", {})

    def reply(j):
        print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": j}))

    def err(m):
        print(json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32603, "message": m}}))

    def tool_result(text):
        reply({"content": [{"type": "text", "text": text}]})

    if method == "initialize":
        reply({"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "docs", "version": "0.11.0"}})
        return

    if method == "tools/list":
        reply({"tools": [
            {"name": "get_library_docs", "description": "Fetch just-in-time docs for a library. Resolves the library name via npm and pypi registries and returns its README/description (and homepage/repo). Optional topic extracts the matching markdown section. Use before coding against an unfamiliar library API.", "inputSchema": {"type": "object", "properties": {"library": {"type": "string", "description": "library/package name (e.g. 'fastapi', 'zod', 'react')"}, "topic": {"type": "string", "description": "optional: extract the markdown section with this heading (e.g. 'Installation', 'Usage')"}, "registry": {"type": "string", "enum": ["npm", "pypi", "auto"], "default": "auto"}}, "required": ["library"]}},
            {"name": "list_supported_registries", "description": "List the package registries this docs server can resolve from.", "inputSchema": {"type": "object", "properties": {}}},
        ]})
        return

    if method == "tools/call":
        tool = params.get("name", "")
        args = params.get("arguments", {})
        try:
            if tool == "get_library_docs":
                library = args["library"]
                topic = args.get("topic", "")
                registry = args.get("registry", "auto")
                result = None
                errors = []
                if registry in ("auto", "npm"):
                    r, e = get_npm_docs(library, topic)
                    if r:
                        result = r
                    else:
                        errors.append(e)
                if registry == "auto":
                    # also try pypi; prefer the more-substantial non-HTML readme
                    r2, e2 = get_pypi_docs(library, topic)
                    if r2:
                        if result is None or _better(r2, result):
                            result = r2
                    elif registry == "auto":
                        errors.append(e2)
                elif registry == "pypi":
                    r, e = get_pypi_docs(library, topic)
                    if r:
                        result = r
                    else:
                        errors.append(e)
                if result is None:
                    err("could not fetch docs for '%s': %s" % (library, "; ".join(errors)))
                    return
                out = "## %s (%s registry, v%s)\n" % (library, result["registry"], result.get("version", "?"))
                if result.get("description"):
                    out += result["description"] + "\n\n"
                if result.get("homepage") or result.get("docs_url"):
                    out += "homepage: " + (result.get("homepage") or result.get("docs_url")) + "\n"
                if result.get("repository"):
                    out += "repo: " + result["repository"] + "\n"
                if topic:
                    out += "(section: %s)\n" % topic
                out += "\n--- docs ---\n" + result.get("docs", "")
                tool_result(out)

            elif tool == "list_supported_registries":
                tool_result("Supported registries:\n  - npm (registry.npmjs.org) — JS/TS packages\n  - pypi (pypi.org) — Python packages\n\nFor other ecosystems (Go, Rust, etc.) or free-form web search, use the agent's native WebFetch/WebSearch tools.")

            else:
                err("unknown tool: " + tool)
        except Exception as e:
            err("tool error: " + str(e))
        return

    err("unsupported method: " + method)


if __name__ == "__main__":
    main()
