#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_ROOT="$(cd "$PLUGIN_ROOT" && pwd)"
REPOSITORY_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
EXPECTED_VERSION="1.0.3"

python3 - "$REPOSITORY_ROOT" "$PLUGIN_ROOT" "$EXPECTED_VERSION" <<'PY'
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

repository_root, plugin_root, expected = map(Path, sys.argv[1:])
expected = str(expected)

def label(path, root):
    return path.relative_to(root).as_posix()

def load_json(path, root):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AssertionError(f"version metadata at {label(path, root)} is malformed: {error}") from error

def assert_version(path, root, keys, value):
    data = load_json(path, root)
    for key in keys:
        try:
            data = data[key]
        except (KeyError, TypeError):
            data = None
            break
    if data != value:
        raise AssertionError(
            f"version mismatch at {label(path, root)}#{'.'.join(str(key) for key in keys)}: "
            f"expected {value!r}, got {data!r}"
        )

def assert_contains(path, root, pattern):
    contents = path.read_text(encoding="utf-8")
    if not re.search(pattern, contents):
        raise AssertionError(f"release identity missing at {label(path, root)}: expected {pattern!r}")

def assert_no_private_omo(root):
    offenders = sorted(path.relative_to(root).as_posix() for path in root.rglob(".omo"))
    if offenders:
        raise AssertionError(f"release artifact contains private .omo paths: {', '.join(offenders)}")

def assert_durable_lifecycle_docs(root, package_root):
    paths = [
        root / "README.md",
        root / "AGENTS.md",
        root / "docs/03-install-and-host-verification.md",
        root / "docs/10-host-capability-matrix.md",
        root / "docs/reference/host-routes.md",
        root / "docs/v1.0.3-migration-guide.md",
        root / "RELEASE_NOTES-v1.0.3.md",
        package_root / "README.md",
        package_root / "CHANGELOG.md",
        package_root / "templates/AGENTS.md",
    ]
    for path in paths:
        contents = path.read_text(encoding="utf-8")
        name = label(path, root)
        if "/private/tmp" in contents:
            raise AssertionError(f"{name} publishes a temporary installation path")
        if re.search(r"\bv1\.0\.4\b", contents):
            raise AssertionError(f"{name} mislabels a v1.0.3 gap as a future release")
        if re.search(r"release folder as the source of truth", contents, re.IGNORECASE):
            raise AssertionError(f"{name} makes a removable source checkout authoritative")
        if not re.search(r"Node\.js LTS 20", contents, re.IGNORECASE):
            raise AssertionError(f"{name} omits the Node.js prerequisite")
        if not re.search(r"\bGit\b", contents):
            raise AssertionError(f"{name} omits the Git prerequisite")
        if not re.search(r"https://github\.com/elvinzhao10/LazyBuddy(?:\.git)?", contents):
            raise AssertionError(f"{name} omits the verified official origin")
        if "launcher.js" not in contents:
            raise AssertionError(f"{name} omits the stable durable launcher")
        if not re.search(r"\b(onboard|update|status|offboard)\b", contents):
            raise AssertionError(f"{name} omits lifecycle commands")
        if not re.search(r"HOST\s+READINESS:\s*PENDING", contents, re.IGNORECASE):
            raise AssertionError(f"{name} can imply host readiness without observation")
        actionable = "\n".join(
            line for line in contents.splitlines()
            if not re.search(r"\b(do not|never)\b", line, re.IGNORECASE)
        )
        if re.search(r"(prepare|install|write|edit|merge|register)[^\n]{0,80}(private (?:cache|registry|state)|host-private)", actionable, re.IGNORECASE):
            raise AssertionError(f"{name} endorses installation through private host state")

def assert_static_versions(root, package_root, value):
    json_versions = [
        (root / ".codebuddy-plugin/marketplace.json", ("plugins", 0, "version")),
        (package_root / ".codebuddy-plugin/plugin.json", ("version",)),
        (package_root / ".workbuddy-plugin/plugin.json", ("version",)),
        (package_root / "tooling/package.json", ("version",)),
        (package_root / "tooling/lsp/python/package.json", ("version",)),
        (package_root / "tooling/lsp/typescript/package.json", ("version",)),
        (package_root / "tooling/package-lock.json", ("version",)),
        (package_root / "tooling/package-lock.json", ("packages", "", "version")),
        (package_root / "tooling/lsp/python/package-lock.json", ("version",)),
        (package_root / "tooling/lsp/python/package-lock.json", ("packages", "", "version")),
        (package_root / "tooling/lsp/typescript/package-lock.json", ("version",)),
        (package_root / "tooling/lsp/typescript/package-lock.json", ("packages", "", "version")),
    ]
    for path, keys in json_versions:
        assert_version(path, root, keys, value)

    text_versions = [
        (root / "AGENTS.md", r"\bv?1\.0\.3\b"),
        (root / "README.md", r"\bv?1\.0\.3\b"),
        (package_root / "templates/AGENTS.md", r"\bv?1\.0\.3\b"),
        (package_root / "mcp/code-intel/server.py", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/context-graph/server.py", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/docs/server.py", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/docs/server.py", r"lazybuddy-docs/1\.0\.3"),
        (package_root / "mcp/lsp/server.py", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/run-ledger/server.sh", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/status-dashboard/server.sh", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/verification/server.sh", r'"version"\s*:\s*"1\.0\.3"'),
        (package_root / "mcp/status-dashboard/dashboard.html", r"LazyBuddy v1\.0\.3"),
        (package_root / "scripts/hooks/session-start.sh", r"LazyBuddy v1\.0\.3"),
        (package_root / "scripts/lazybuddy-verify.sh", r"v1\.0\.3"),
        (package_root / "tests/v016-runtime-version-regression.sh", r'EXPECTED_VERSION="1\.0\.3"'),
    ]
    for path, pattern in text_versions:
        assert_contains(path, root, pattern)

    changelog = (package_root / "CHANGELOG.md").read_text(encoding="utf-8")
    current = re.search(r"## v1\.0\.3\b[\s\S]*?(?=\n## v|\Z)", changelog)
    if not current or not re.search(r"local-first onboarding", current.group(0), re.IGNORECASE):
        raise AssertionError("lazybuddy-plugin/CHANGELOG.md v1.0.3 notes omit local-first onboarding")
    if not re.search(r"host readiness", current.group(0), re.IGNORECASE):
        raise AssertionError("lazybuddy-plugin/CHANGELOG.md v1.0.3 notes omit honest host readiness")

def assert_release_integrity(root, package_root, value):
    assert_static_versions(root, package_root, value)
    assert_durable_lifecycle_docs(root, package_root)
    assert_no_private_omo(root)

assert_release_integrity(repository_root, plugin_root, expected)

source_manifest = plugin_root / ".codebuddy-plugin/plugin.json"
source_before = source_manifest.read_bytes()
with tempfile.TemporaryDirectory(prefix="lazybuddy v102 version fixture ") as temporary:
    fixture_root = Path(temporary) / "Lazy Buddy Release"
    shutil.copytree(repository_root, fixture_root, ignore=shutil.ignore_patterns(".git", ".debug-journal.md"))
    fixture_package = fixture_root / "lazybuddy-plugin"
    assert_release_integrity(fixture_root, fixture_package, expected)
    if " " not in str(fixture_root):
        raise AssertionError("portable release fixture does not contain spaces")
    fixture_manifest = fixture_package / ".codebuddy-plugin/plugin.json"
    value = load_json(fixture_manifest, fixture_root)
    value["version"] = "1.0.1"
    fixture_manifest.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    try:
        assert_release_integrity(fixture_root, fixture_package, expected)
    except AssertionError as error:
        message = str(error)
        if "lazybuddy-plugin/.codebuddy-plugin/plugin.json#version" not in message:
            raise AssertionError(f"mutation failure omitted the exact manifest path: {message}") from error
        if "expected '1.0.3', got '1.0.1'" not in message:
            raise AssertionError(f"mutation failure omitted the expected values: {message}") from error
    else:
        raise AssertionError("a copied product manifest mismatch was accepted")
if source_manifest.read_bytes() != source_before:
    raise AssertionError("mutation probe changed the source manifest")

source_template = plugin_root / "templates/AGENTS.md"
source_template_before = source_template.read_bytes()
with tempfile.TemporaryDirectory(prefix="lazybuddy v102 template fixture ") as temporary:
    fixture_root = Path(temporary) / "Lazy Buddy Release"
    shutil.copytree(repository_root, fixture_root, ignore=shutil.ignore_patterns(".git", ".debug-journal.md"))
    fixture_package = fixture_root / "lazybuddy-plugin"
    assert_release_integrity(fixture_root, fixture_package, expected)
    fixture_template = fixture_package / "templates/AGENTS.md"
    contents = fixture_template.read_text(encoding="utf-8")
    mutated = re.sub(r"v?1\.0\.3", "v1.0.1", contents)
    if mutated == contents:
        raise AssertionError("template mutation fixture did not change its release identity")
    fixture_template.write_text(mutated, encoding="utf-8")
    try:
        assert_release_integrity(fixture_root, fixture_package, expected)
    except AssertionError as error:
        message = str(error)
        if "lazybuddy-plugin/templates/AGENTS.md" not in message:
            raise AssertionError(f"template mutation failure omitted the exact path: {message}") from error
    else:
        raise AssertionError("a copied template version mismatch was accepted")
if source_template.read_bytes() != source_template_before:
    raise AssertionError("template mutation probe changed the source template")

with tempfile.TemporaryDirectory(prefix="lazybuddy v102 artifact fixture ") as temporary:
    fixture_root = Path(temporary) / "Lazy Buddy Release"
    shutil.copytree(repository_root, fixture_root, ignore=shutil.ignore_patterns(".git", ".debug-journal.md"))
    fixture_package = fixture_root / "lazybuddy-plugin"
    assert_release_integrity(fixture_root, fixture_package, expected)
    private_evidence = fixture_root / ".omo/evidence/internal.md"
    private_evidence.parent.mkdir(parents=True)
    private_evidence.write_text("private fixture\n", encoding="utf-8")
    before = private_evidence.read_bytes()
    try:
        assert_release_integrity(fixture_root, fixture_package, expected)
    except AssertionError as error:
        message = str(error)
        if ".omo" not in message or "release artifact" not in message:
            raise AssertionError(f"private artifact failure was not actionable: {message}") from error
    else:
        raise AssertionError("a copied release containing private .omo evidence was accepted")
    if private_evidence.read_bytes() != before:
        raise AssertionError("private artifact rejection mutated the fixture")
PY

for server_name in run-ledger verification status-dashboard context-graph code-intel docs lsp; do
    server="$PLUGIN_ROOT/mcp/$server_name/server.sh"
    response="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | CWD="$REPOSITORY_ROOT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$server")"
    version="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["serverInfo"]["version"])' <<<"$response")"
    if [ "$version" != "$EXPECTED_VERSION" ]; then
        printf 'FAIL %s reported %s (expected %s)\n' "${server#$PLUGIN_ROOT/}" "$version" "$EXPECTED_VERSION" >&2
        exit 1
    fi
done

printf 'v1.0.3 local-first version regression: PASS\n'
