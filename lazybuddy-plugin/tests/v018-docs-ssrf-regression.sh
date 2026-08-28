#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-docs-ssrf.XXXXXX")"
FAKE_BIN="$TMP/bin"
CALLS="$TMP/curl.calls"
PROJECT="$TMP/project"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$PROJECT"
cat >"$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--version" ]; then
    printf 'curl 8.0 fake\n'
    exit 0
fi

printf '%s\n' "$*" >>"$LAZYBUDDY_FAKE_CURL_CALLS"
url="${!#}"
case "$url" in
    'https://registry.npmjs.org/@scope/name/latest')
        printf '%s\n' '{"version":"1.2.3","description":"npm package","homepage":"http://127.0.0.1:9/","repository":{"url":"http://127.0.0.1:9/repo"},"readme":"short README"}'
        ;;
    'https://pypi.org/pypi/fastapi/json')
        printf '%s\n' '{"info":{"version":"2.0.0","summary":"PyPI package","description":"PyPI README is safely returned from registry metadata.","home_page":"http://127.0.0.1:9/","project_urls":{"Documentation":"http://127.0.0.1:9/docs"}}}'
        ;;
    'https://registry.npmjs.org/redirect-hop/latest')
        printf '%s\n' 'redirect destination rejected before follow' >&2
        exit 47
        ;;
    *)
        printf 'unexpected curl URL: %s\n' "$url" >&2
        exit 22
        ;;
esac
SH
chmod +x "$FAKE_BIN/curl"

rpc() {
    local library="$1" registry="$2"
    PATH="$FAKE_BIN:$PATH" LAZYBUDDY_FAKE_CURL_CALLS="$CALLS" \
        printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"get_library_docs\",\"arguments\":{\"library\":\"$library\",\"registry\":\"$registry\"}}}" \
        | PATH="$FAKE_BIN:$PATH" LAZYBUDDY_FAKE_CURL_CALLS="$CALLS" CWD="$PROJECT" bash "$PLUGIN/mcp/docs/server.sh"
}

rpc_raw() {
    PATH="$FAKE_BIN:$PATH" LAZYBUDDY_FAKE_CURL_CALLS="$CALLS" \
        printf '%s\n' "$1" \
        | PATH="$FAKE_BIN:$PATH" LAZYBUDDY_FAKE_CURL_CALLS="$CALLS" CWD="$PROJECT" bash "$PLUGIN/mcp/docs/server.sh"
}

assert_registry_only() {
    local expected="$1"
    [ -f "$CALLS" ] || { echo "FAIL: curl was not called" >&2; return 1; }
    [ "$(wc -l <"$CALLS" | tr -d ' ')" = "$expected" ] || {
        echo "FAIL: expected $expected curl calls" >&2
        cat "$CALLS" >&2
        return 1
    }
    ! grep -Eq -- '(^| )-L($| )|127\.0\.0\.1|http://' "$CALLS"
    grep -Eq -- '(^| )--proto =https($| )' "$CALLS"
    grep -Eq -- '(^| )--proto-redir =https($| )' "$CALLS"
    grep -Eq -- '(^| )--max-redirs 0($| )' "$CALLS"
}

# Given: a scoped npm package whose registry metadata advertises a loopback homepage.
# When: the real docs MCP launcher receives a get_library_docs JSON-RPC call.
# Then: exactly its encoded npm registry endpoint is requested and metadata is returned.
: >"$CALLS"
npm_response="$(rpc '@scope/name' npm)"
printf '%s' "$npm_response" | grep -q 'npm package'
assert_registry_only 1
grep -Fx -- '-sS --proto =https --proto-redir =https --max-redirs 0 --max-time 20 -A lazybuddy-docs/1.1.0 https://registry.npmjs.org/@scope/name/latest' "$CALLS" >/dev/null

# Given: a PyPI name and loopback URLs in untrusted registry metadata.
# When: the real launcher is called.
# Then: only the fixed PyPI JSON endpoint is fetched.
: >"$CALLS"
pypi_response="$(rpc fastapi pypi)"
printf '%s' "$pypi_response" | grep -q 'PyPI package'
assert_registry_only 1
grep -Fx -- '-sS --proto =https --proto-redir =https --max-redirs 0 --max-time 20 -A lazybuddy-docs/1.1.0 https://pypi.org/pypi/fastapi/json' "$CALLS" >/dev/null

: >"$CALLS"
redirect_response="$(rpc redirect-hop npm)"
printf '%s' "$redirect_response" | grep -q 'error'
assert_registry_only 1
grep -Fx -- '-sS --proto =https --proto-redir =https --max-redirs 0 --max-time 20 -A lazybuddy-docs/1.1.0 https://registry.npmjs.org/redirect-hop/latest' "$CALLS" >/dev/null

: >"$CALLS"
invalid_arguments_response="$(rpc_raw '{"jsonrpc":"2.0","id":"invalid-arguments","method":"tools/call","params":{"name":"get_library_docs","arguments":[]}}')"
python3 - "$invalid_arguments_response" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
assert response["id"] == "invalid-arguments", response
assert response["error"]["code"] == -32602, response
PY
[ ! -s "$CALLS" ] || { echo 'FAIL: malformed MCP arguments launched curl' >&2; exit 1; }

: >"$CALLS"
valid_arguments_response="$(rpc_raw '{"jsonrpc":"2.0","id":"valid-arguments","method":"tools/call","params":{"name":"list_supported_registries","arguments":{}}}')"
python3 - "$valid_arguments_response" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
content = response["result"]["content"]
assert content[0]["type"] == "text", response
assert "npm" in content[0]["text"], response
PY
[ ! -s "$CALLS" ] || { echo 'FAIL: valid local MCP arguments launched curl' >&2; exit 1; }

# Given: hostile or malformed library values.
# When: each is sent to its relevant registry resolver.
# Then: validation fails before curl is launched.
for hostile in 'http://127.0.0.1:9/' 'https://registry.npmjs.org/redirect' 'name?url=http://127.0.0.1:9/' 'name#fragment' 'name\path' 'name with space' $'name\nnext' 'scope/name'; do
    : >"$CALLS"
    response="$(rpc "$hostile" npm)"
    printf '%s' "$response" | grep -q 'error'
    [ ! -s "$CALLS" ] || { echo "FAIL: hostile npm name launched curl: $hostile" >&2; cat "$CALLS" >&2; exit 1; }
done
for hostile in 'http://127.0.0.1:9/' 'fastapi/redirect' 'name?url=http://127.0.0.1:9/' 'name#fragment' 'name\path' 'name with space' $'name\nnext' '.' '..' '%2f'; do
    : >"$CALLS"
    response="$(rpc "$hostile" pypi)"
    printf '%s' "$response" | grep -q 'error'
    [ ! -s "$CALLS" ] || { echo "FAIL: hostile PyPI name launched curl: $hostile" >&2; cat "$CALLS" >&2; exit 1; }
done

echo "PASS: docs MCP permits fixed HTTPS requests, blocks every redirect follow, and returns structured invalid-argument errors without a fetch"
