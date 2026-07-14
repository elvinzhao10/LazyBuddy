#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TOOLING="$PLUGIN_ROOT/scripts/lazybuddy-tooling.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-policy.XXXXXX")"
HOME_ROOT="$TMP/home"
WORKSPACE="$TMP/workspace"
mkdir -p "$HOME_ROOT" "$WORKSPACE"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }
run_json() { HOME="$HOME_ROOT" XDG_CONFIG_HOME="$HOME_ROOT/.config" "$@"; }

# Given a fresh user home and a sentinel credential, when provider discovery runs,
# then it exposes only an opaque environment reference.
output="$(HOME="$HOME_ROOT" XDG_CONFIG_HOME="$HOME_ROOT/.config" CONTEXT7_API_KEY=sentinel bash "$TOOLING" providers test --json)"
printf '%s' "$output" | python3 -c 'import json, sys; d=json.load(sys.stdin); assert d["providers"]["context7"]["credential_ref"] == "env://CONTEXT7_API_KEY"'
[[ "$output" != *sentinel* ]] || fail 'provider output leaked a raw secret'
pass 'provider discovery is env-name-only and redacted'

CONFIG="$HOME_ROOT/.config/lazyseries/config.yaml"
[ "$(stat -f '%Lp' "$CONFIG")" = 600 ] || fail 'config is not mode 0600'
pass 'config is private'

# Given a persisted workspace approval, when it is checked under the same digest,
# then it allows; a changed digest must invalidate it without running anything.
run_json bash "$TOOLING" approval grant --workspace "$WORKSPACE" --capability documentation_search --provider context7 --scope workspace --json >/dev/null
run_json bash "$TOOLING" approval check --workspace "$WORKSPACE" --capability documentation_search --provider context7 --policy ask-once --json >"$TMP/allowed.json"
python3 - "$TMP/allowed.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1], encoding='utf-8'))['decision'] == 'allowed'
PY
LAZYBUDDY_CONTRACT_DIGEST=stale run_json bash "$TOOLING" approval check --workspace "$WORKSPACE" --capability documentation_search --provider context7 --policy ask-once --json >"$TMP/stale.json"
python3 - "$TMP/stale.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1], encoding='utf-8'))['decision'] == 'ask'
PY
pass 'approval ledger persists and invalidates by contract digest'

run_json bash "$TOOLING" approval grant --workspace "$WORKSPACE" --capability external_code_search --provider grep_app --scope once --json >/dev/null
run_json bash "$TOOLING" approval check --workspace "$WORKSPACE" --capability external_code_search --provider grep_app --policy ask-once --json >"$TMP/once-allowed.json"
run_json bash "$TOOLING" approval check --workspace "$WORKSPACE" --capability external_code_search --provider grep_app --policy ask-once --json >"$TMP/once-consumed.json"
python3 - "$TMP/once-allowed.json" "$TMP/once-consumed.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1], encoding='utf-8'))['decision'] == 'allowed'
assert json.load(open(sys.argv[2], encoding='utf-8'))['decision'] == 'ask'
PY
pass 'once approval is consumed'

# Given an explicit deny, when a provider test is requested, then it must stop before any executable or network path.
run_json bash "$TOOLING" approval deny --workspace "$WORKSPACE" --capability documentation_search --provider context7 --json >/dev/null
NETWORK_MARKER="$TMP/network-called"
mkdir "$TMP/bin"
printf '#!/usr/bin/env bash\nprintf invoked >"%s"\n' "$NETWORK_MARKER" >"$TMP/bin/curl"
chmod +x "$TMP/bin/curl"
HOME="$HOME_ROOT" XDG_CONFIG_HOME="$HOME_ROOT/.config" PATH="$TMP/bin:/usr/bin:/bin" bash "$TOOLING" providers test --workspace "$WORKSPACE" --json >"$TMP/denied.json"
python3 - "$TMP/denied.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1], encoding='utf-8'))['providers']['context7']['decision'] == 'denied'
PY
[ ! -e "$NETWORK_MARKER" ] || fail 'denied provider invoked a process or network'
pass 'deny is fail-closed before execution'

# Given no override, when toolpack resolution runs, then its location is deterministic and private.
run_json bash "$TOOLING" toolpack resolve --json >"$TMP/toolpack.json"
python3 - "$TMP/toolpack.json" "$HOME_ROOT" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
assert d['root'] == os.path.realpath(os.path.join(sys.argv[2], '.local', 'share', 'lazyseries', 'toolpack'))
assert d['source'] == 'default'
PY
pass 'toolpack resolution is deterministic'

printf '{"schema_version":1,"credentials":{"context7":"sentinel"},"approvals":[]}\n' > "$CONFIG"
chmod 600 "$CONFIG"
if HOME="$HOME_ROOT" XDG_CONFIG_HOME="$HOME_ROOT/.config" bash "$TOOLING" providers test --json >"$TMP/malformed.out" 2>&1; then
    fail 'malformed credential-bearing config was accepted'
fi
if grep -q sentinel "$TMP/malformed.out"; then
    fail 'malformed config error leaked a raw secret'
fi
pass 'malformed config fails closed without secret leakage'

printf 'PASS: LazyBuddy policy foundation\n'
