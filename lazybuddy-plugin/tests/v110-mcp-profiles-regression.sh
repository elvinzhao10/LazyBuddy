#!/usr/bin/env bash
set -u

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PROFILE="$PLUGIN_ROOT/scripts/lazybuddy-mcp-profile.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-v110-profiles.XXXXXX")"
PROJECT="$TMP/project"
PLUGIN_DATA="$TMP/plugin-data"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
mkdir -p "$PROJECT/src" "$PLUGIN_DATA"
printf 'export const profileMarker = true;\n' > "$PROJECT/src/profile.ts"

pass_case() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail_case() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

if python3 - "$PLUGIN_ROOT" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
config = json.loads((root / ".mcp.json").read_text(encoding="utf-8"))
servers = config["mcpServers"]
names = ("run-ledger", "verification", "status-dashboard", "context-graph", "code-intel", "docs")
assert tuple(servers) == names
for name, declaration in servers.items():
    assert declaration["type"] == "stdio", (name, declaration)
    assert declaration["command"] == "bash", (name, declaration)
    assert declaration["args"] == [f"${{CODEBUDDY_PLUGIN_ROOT}}/mcp/{name}/server.sh"]
    assert set(declaration) == {"type", "command", "args", "env", "defer_loading"}
    assert declaration["defer_loading"] is (name in {"context-graph", "code-intel", "docs"})
    env = declaration["env"]
    assert env["CWD"] == "${CODEBUDDY_PROJECT_DIR}"
    assert env["CODEBUDDY_PROJECT_DIR"] == "${CODEBUDDY_PROJECT_DIR}"
    assert env["LAZYBUDDY_MCP_MODE"] == "${user_config.mcp_mode}"
    assert env["LAZYBUDDY_DEPENDENCY_ROOT"] == "${CODEBUDDY_PLUGIN_DATA}/dependencies"
    assert env["LAZYBUDDY_CACHE_ROOT"] == "${CODEBUDDY_PLUGIN_DATA}/cache"
    assert "required" not in declaration and "cwd" not in declaration
PY
then pass_case 'six declarations are typed stdio with exact supported fields and deterministic deferral'; else fail_case 'six declarations are typed stdio with exact supported fields and deterministic deferral'; fi

if python3 - "$PLUGIN_ROOT" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
code = json.loads((root / ".codebuddy-plugin/plugin.json").read_text(encoding="utf-8"))
work = json.loads((root / ".workbuddy-plugin/plugin.json").read_text(encoding="utf-8"))
descriptor = code["userConfig"]["mcp_mode"]
assert set(descriptor) == {"description", "sensitive"}
assert descriptor["sensitive"] is False
assert "userConfig" not in work
assert "lspServers" not in work
PY
then pass_case 'CodeBuddy userConfig is safe and WorkBuddy excludes CodeBuddy-only metadata'; else fail_case 'CodeBuddy userConfig is safe and WorkBuddy excludes CodeBuddy-only metadata'; fi

if [ -x "$PROFILE" ]; then
    pass_case 'profile CLI exists and is executable'
else
    fail_case 'profile CLI exists and is executable'
fi

DIRECT_OUT="$TMP/direct.out"
if python3 "$PROFILE" --mode direct --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$DIRECT_OUT" 2> "$TMP/direct.err"; then
    if python3 - "$DIRECT_OUT" "$PLUGIN_ROOT" "$PROJECT" "$PLUGIN_DATA" <<'PY'
import json
from pathlib import Path
import sys

output, plugin_root, project, plugin_data = map(Path, sys.argv[1:])
project = project.resolve()
plugin_data = plugin_data.resolve()
lines = output.read_text(encoding="utf-8").splitlines()
payload = json.loads(next(line.removeprefix("MCP_PROFILE_JSON=") for line in lines if line.startswith("MCP_PROFILE_JSON=")))
assert tuple(payload["mcpServers"]) == ("run-ledger", "verification", "status-dashboard")
for name, declaration in payload["mcpServers"].items():
    assert declaration["type"] == "stdio"
    assert declaration["args"] == [str(plugin_root / "mcp" / name / "server.sh")]
    assert declaration["env"]["CWD"] == str(project)
    assert declaration["env"]["CODEBUDDY_PROJECT_DIR"] == str(project)
    assert declaration["env"]["LAZYBUDDY_MCP_MODE"] == "direct"
    assert declaration["env"]["LAZYBUDDY_DEPENDENCY_ROOT"] == str(plugin_data / "dependencies")
    assert declaration["env"]["LAZYBUDDY_CACHE_ROOT"] == str(plugin_data / "cache")
assert "PROFILE_MODE=direct" in lines
assert "SELECTED_SERVERS=run-ledger,verification,status-dashboard" in lines
assert "NETWORK=not-used" in lines
assert "RUNTIME_INSTALL=none" in lines
PY
    then pass_case 'direct profile renders only three usable direct servers with plugin-data roots'; else fail_case 'direct profile renders only three usable direct servers with plugin-data roots'; fi
else
    fail_case 'direct profile command exits zero'
fi

if python3 "$PROFILE" --mode direct --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" --request-server docs > "$TMP/deferred.out" 2> "$TMP/deferred.err"; then
    fail_case 'direct profile rejects deferred docs request'
elif [ "$?" -eq 3 ] && grep -Fq 'MCP_PROFILE_DEFERRED server=docs mode=direct' "$TMP/deferred.err"; then
    pass_case 'direct profile rejects deferred docs request with explicit diagnostic'
else
    fail_case 'direct profile rejects deferred docs request with explicit diagnostic'
fi

if python3 "$PROFILE" --mode assisted --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" --request-server code-intel > "$TMP/assisted.out" 2> "$TMP/assisted.err" \
    && grep -Fq 'MCP_PROFILE_AVAILABLE server=code-intel mode=assisted loading=deferred' "$TMP/assisted.out"; then
    pass_case 'assisted profile exposes code-intel on demand'
else
    fail_case 'assisted profile exposes code-intel on demand'
fi

FAKE_BIN="$TMP/fake-bin"
mkdir -p "$FAKE_BIN"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$FAKE_BIN/typescript-language-server"
chmod +x "$FAKE_BIN/typescript-language-server"
if PATH="$FAKE_BIN:/usr/bin:/bin" python3 "$PROFILE" --mode assisted --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" --detect-lsp > "$TMP/lsp.out" 2> "$TMP/lsp.err"; then
    LSP_PATH="$PLUGIN_DATA/cache/lsp/.lsp.json"
    if python3 - "$LSP_PATH" <<'PY'
import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
assert tuple(data) == ("typescript",)
assert data["typescript"]["command"] == "typescript-language-server"
assert data["typescript"]["args"] == ["--stdio"]
assert data["typescript"]["extensionToLanguage"][".ts"] == "typescript"
PY
    then pass_case 'detected PATH LSP writes only cache-scoped .lsp.json'; else fail_case 'detected PATH LSP writes only cache-scoped .lsp.json'; fi
else
    fail_case 'detected PATH LSP command exits zero'
fi

MISSING_DATA="$TMP/missing-data"
if PATH="/usr/bin:/bin" python3 "$PROFILE" --mode assisted --project-dir "$PROJECT" --plugin-data "$MISSING_DATA" --detect-lsp > "$TMP/lsp-missing.out" 2> "$TMP/lsp-missing.err"; then
    if grep -Fq 'LSP_STATE=unavailable' "$TMP/lsp-missing.out" && [ ! -e "$MISSING_DATA" ]; then
        pass_case 'unavailable LSP remains detected-only and creates no persistent path'
    else
        fail_case 'unavailable LSP remains detected-only and creates no persistent path'
    fi
else
    fail_case 'unavailable LSP detection is a bounded non-error'
fi

if python3 "$PROFILE" --mode direct --project-dir "$PROJECT" --plugin-data "$PLUGIN_ROOT/cache" > "$TMP/invalid-path.out" 2> "$TMP/invalid-path.err"; then
    fail_case 'plugin-root persistent path is rejected'
elif [ "$?" -eq 2 ] && grep -Fq 'plugin data must stay outside the plugin and project roots' "$TMP/invalid-path.err"; then
    pass_case 'plugin-root persistent path is rejected'
else
    fail_case 'plugin-root persistent path is rejected'
fi

for mutation in missing-type duplicate-type; do
    MUTATED_PLUGIN="$TMP/$mutation/lazybuddy-plugin"
    mkdir -p "$(dirname "$MUTATED_PLUGIN")"
    cp -R "$PLUGIN_ROOT" "$MUTATED_PLUGIN"
    python3 - "$MUTATED_PLUGIN/.mcp.json" "$mutation" <<'PY'
import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
mutation = sys.argv[2]
text = path.read_text(encoding="utf-8")
if mutation == "duplicate-type":
    path.write_text(text.replace('"type": "stdio",', '"type": "stdio", "type": "stdio",', 1), encoding="utf-8")
else:
    value = json.loads(text)
    del value["mcpServers"]["run-ledger"]["type"]
    path.write_text(json.dumps(value), encoding="utf-8")
PY
    if python3 "$MUTATED_PLUGIN/scripts/lazybuddy-mcp-profile.py" --mode orchestrated --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/$mutation.out" 2> "$TMP/$mutation.err"; then
        fail_case "$mutation declaration is rejected"
    elif [ "$?" -eq 2 ] && grep -Eiq 'duplicate JSON field|typed stdio' "$TMP/$mutation.err"; then
        pass_case "$mutation declaration is rejected"
    else
        fail_case "$mutation declaration is rejected"
    fi
done

ISOLATED_PLUGIN="$TMP/one-server-failure/lazybuddy-plugin"
mkdir -p "$(dirname "$ISOLATED_PLUGIN")"
cp -R "$PLUGIN_ROOT" "$ISOLATED_PLUGIN"
chmod -x "$ISOLATED_PLUGIN/mcp/docs/server.sh"
if python3 "$ISOLATED_PLUGIN/scripts/lazybuddy-mcp-profile.py" --mode direct --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/isolated-direct.out" 2> "$TMP/isolated-direct.err" \
    && ! python3 "$ISOLATED_PLUGIN/scripts/lazybuddy-mcp-profile.py" --mode orchestrated --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/isolated-all.out" 2> "$TMP/isolated-all.err" \
    && grep -Fq 'MCP declaration docs launcher is unavailable' "$TMP/isolated-all.err"; then
    pass_case 'one deferred server failure is isolated from the direct profile'
else
    fail_case 'one deferred server failure is isolated from the direct profile'
fi

if python3 "$PROFILE" --mode $'direct\nIGNORE_PREVIOUS_INSTRUCTIONS' --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/injection.out" 2> "$TMP/injection.err"; then
    fail_case 'prompt-injection-shaped mode is rejected'
elif [ "$?" -eq 2 ] && grep -Fq 'unsupported MCP mode' "$TMP/injection.err" && [ ! -s "$TMP/injection.out" ]; then
    pass_case 'prompt-injection-shaped mode is rejected'
else
    fail_case 'prompt-injection-shaped mode is rejected'
fi

if printf '%s\n' '{"jsonrpc":"2.0","id":"deferred","method":"initialize","params":{}}' \
    | CWD="$PROJECT" CODEBUDDY_PROJECT_DIR="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" LAZYBUDDY_MCP_MODE=direct \
        bash "$PLUGIN_ROOT/mcp/docs/server.sh" > "$TMP/runtime-deferred.out" 2> "$TMP/runtime-deferred.err"; then
    fail_case 'real docs launcher enforces direct-profile deferral'
elif [ "$?" -eq 3 ] && [ ! -s "$TMP/runtime-deferred.out" ] \
    && grep -Fq 'MCP_PROFILE_DEFERRED server=docs mode=direct' "$TMP/runtime-deferred.err"; then
    pass_case 'real docs launcher enforces direct-profile deferral'
else
    fail_case 'real docs launcher enforces direct-profile deferral'
fi

for server in run-ledger verification status-dashboard; do
    if printf '%s\n' '{"jsonrpc":"2.0","id":"profile","method":"initialize","params":{}}' \
        | CWD="$PROJECT" CODEBUDDY_PROJECT_DIR="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" \
            LAZYBUDDY_MCP_MODE=direct \
            bash "$PLUGIN_ROOT/mcp/$server/server.sh" > "$TMP/$server.out" 2> "$TMP/$server.err" \
        && grep -Fq '"id": "profile"' "$TMP/$server.out"; then
        pass_case "direct server $server is usable through its real stdio launcher"
    else
        fail_case "direct server $server is usable through its real stdio launcher"
    fi
done

for server in context-graph code-intel docs lsp; do
    printf '%s\n' '{"jsonrpc":"2.0","id":"cache","method":"initialize","params":{}}' \
        | CWD="$PROJECT" CODEBUDDY_PROJECT_DIR="$PROJECT" CODEBUDDY_PLUGIN_ROOT="$PLUGIN_ROOT" \
            bash "$PLUGIN_ROOT/mcp/$server/server.sh" > "$TMP/$server-cache.out" 2> "$TMP/$server-cache.err" \
        || fail_case "$server launcher avoids plugin-root bytecode state"
done
if [ -z "$(find "$PLUGIN_ROOT/mcp" -type f -path '*/__pycache__/*' -print -quit)" ]; then
    pass_case 'Python MCP launchers avoid persistent bytecode under plugin root'
else
    fail_case 'Python MCP launchers avoid persistent bytecode under plugin root'
fi

python3 "$PROFILE" --mode planned --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/repeat-a.out" 2> "$TMP/repeat-a.err"
python3 "$PROFILE" --mode planned --project-dir "$PROJECT" --plugin-data "$PLUGIN_DATA" > "$TMP/repeat-b.out" 2> "$TMP/repeat-b.err"
if cmp -s "$TMP/repeat-a.out" "$TMP/repeat-b.out" && [ ! -s "$TMP/repeat-a.err" ] && [ ! -s "$TMP/repeat-b.err" ]; then
    pass_case 'repeated profile invocation is deterministic and clean'
else
    fail_case 'repeated profile invocation is deterministic and clean'
fi

printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "$FAIL"
[ "$FAIL" -eq 0 ]
