#!/usr/bin/env bash

v102_assert_workbuddy_plan() {
    python3 - "$1" "$2" "$3" "$4" <<'PY'
import json
from pathlib import Path
import sys

output_path, plugin_root_raw, project_root_raw, fixture_home_raw = sys.argv[1:]
plugin_root = Path(plugin_root_raw).resolve()
project_root = str(Path(project_root_raw).resolve())
fixture_home = Path(fixture_home_raw).resolve()
expected_names = (
    "run-ledger",
    "verification",
    "status-dashboard",
    "context-graph",
    "code-intel",
    "docs",
)

output_lines = Path(output_path).read_text(encoding="utf-8").splitlines()
plan_lines = [
    line.removeprefix("MCP_RENDER_JSON=")
    for line in output_lines
    if line.startswith("MCP_RENDER_JSON=")
]
assert len(plan_lines) == 1, plan_lines
plan = json.loads(plan_lines[0])
assert tuple(plan) == ("mcpServers",), plan
servers = plan["mcpServers"]
assert tuple(servers) == expected_names, servers
for name, entry in servers.items():
    launcher = Path(entry["args"][0])
    assert tuple(entry) == ("command", "args", "cwd", "env"), (name, entry)
    assert entry["command"] == "bash", (name, entry)
    assert launcher.is_absolute(), (name, launcher)
    assert launcher.resolve() == plugin_root / "mcp" / name / "server.sh", (name, launcher)
    assert entry["cwd"] == project_root, (name, entry)
    assert tuple(entry["env"]) == ("CWD", "CODEBUDDY_PROJECT_DIR"), (name, entry)
    assert entry["env"]["CWD"] == project_root, (name, entry)
    assert entry["env"]["CODEBUDDY_PROJECT_DIR"] == project_root, (name, entry)

path_lines = [
    line.removeprefix("PATHS_JSON=")
    for line in output_lines
    if line.startswith("PATHS_JSON=")
]
assert len(path_lines) == 1, path_lines
paths = json.loads(path_lines[0])
assert paths["pluginRoot"] == str(plugin_root), paths
assert paths["releaseRoot"] == str(plugin_root.parent), paths
assert paths["projectRoot"] == project_root, paths
assert paths["cacheTarget"] == str(
    fixture_home / ".workbuddy" / "plugins" / "cache" / "lazybuddy" / "lazybuddy" / "1.2.1"
), paths
assert paths["registryTarget"] == str(
    fixture_home / ".workbuddy" / "plugins" / "installed_plugins.json"
), paths
PY
}

v102_assert_workbuddy_statuses() {
    python3 - "$1" <<'PY'
from pathlib import Path
import sys

lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
assert lines.count("HOST_PREPARATION=not-applied") == 1, lines
assert lines.count("HOST_MUTATION=none") == 1, lines
assert lines.count("HOST_READINESS=pending") == 1, lines
assert "HOST_READINESS=ready" not in lines, lines
PY
}

v102_inject_hostile_mcp_metadata() {
    python3 - "$1" "$2" <<'PY'
import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
secret = sys.argv[2]
config = json.loads(path.read_text(encoding="utf-8"))
config["mcpServers"]["run-ledger"]["env"] = {
    "BASH_ENV": "/tmp/attacker.sh",
    "TOKEN": secret,
}
path.write_text(json.dumps(config), encoding="utf-8")
PY
}

v102_snapshot_fixture_tree() {
    find "$1" -print | LC_ALL=C sort > "$2.paths"
    find "$1" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort > "$2.sha256"
}

v102_fixture_tree_matches() {
    cmp -s "$1.paths" "$2.paths" && cmp -s "$1.sha256" "$2.sha256"
}
