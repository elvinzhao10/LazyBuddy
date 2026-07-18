#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_ROOT="$(cd "$PLUGIN_ROOT" && pwd)"
REPOSITORY_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
EXPECTED_VERSION="1.0.2"

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
        (root / "AGENTS.md", r"\bv?1\.0\.2\b"),
        (root / "README.md", r"\bv?1\.0\.2\b"),
        (package_root / "mcp/code-intel/server.py", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/context-graph/server.py", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/docs/server.py", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/docs/server.py", r"lazybuddy-docs/1\.0\.2"),
        (package_root / "mcp/lsp/server.py", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/run-ledger/server.sh", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/status-dashboard/server.sh", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/verification/server.sh", r'"version"\s*:\s*"1\.0\.2"'),
        (package_root / "mcp/status-dashboard/dashboard.html", r"LazyBuddy v1\.0\.2"),
        (package_root / "scripts/hooks/session-start.sh", r"LazyBuddy v1\.0\.2"),
        (package_root / "scripts/lazybuddy-verify.sh", r"v1\.0\.2"),
        (package_root / "tests/v016-runtime-version-regression.sh", r'EXPECTED_VERSION="1\.0\.2"'),
    ]
    for path, pattern in text_versions:
        assert_contains(path, root, pattern)

    changelog = (package_root / "CHANGELOG.md").read_text(encoding="utf-8")
    current = re.search(r"## v1\.0\.2\b[\s\S]*?(?=\n## v|\Z)", changelog)
    if not current or not re.search(r"local-first onboarding", current.group(0), re.IGNORECASE):
        raise AssertionError("lazybuddy-plugin/CHANGELOG.md v1.0.2 notes omit local-first onboarding")
    if not re.search(r"host readiness", current.group(0), re.IGNORECASE):
        raise AssertionError("lazybuddy-plugin/CHANGELOG.md v1.0.2 notes omit honest host readiness")

assert_static_versions(repository_root, plugin_root, expected)

source_manifest = plugin_root / ".codebuddy-plugin/plugin.json"
source_before = source_manifest.read_bytes()
with tempfile.TemporaryDirectory(prefix="lazybuddy-v102-version-fixture-") as temporary:
    fixture_root = Path(temporary) / "LazyBuddy"
    shutil.copytree(repository_root, fixture_root, ignore=shutil.ignore_patterns(".git", ".debug-journal.md"))
    fixture_package = fixture_root / "lazybuddy-plugin"
    fixture_manifest = fixture_package / ".codebuddy-plugin/plugin.json"
    value = load_json(fixture_manifest, fixture_root)
    value["version"] = "1.0.1"
    fixture_manifest.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    try:
        assert_static_versions(fixture_root, fixture_package, expected)
    except AssertionError as error:
        message = str(error)
        if "lazybuddy-plugin/.codebuddy-plugin/plugin.json#version" not in message:
            raise AssertionError(f"mutation failure omitted the exact manifest path: {message}") from error
        if "expected '1.0.2', got '1.0.1'" not in message:
            raise AssertionError(f"mutation failure omitted the expected values: {message}") from error
    else:
        raise AssertionError("a copied product manifest mismatch was accepted")
if source_manifest.read_bytes() != source_before:
    raise AssertionError("mutation probe changed the source manifest")
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

printf 'v1.0.2 local-first version regression: PASS\n'
