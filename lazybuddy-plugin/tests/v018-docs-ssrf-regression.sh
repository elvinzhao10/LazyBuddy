#!/usr/bin/env bash
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lazybuddy-docs-ssrf.XXXXXX")"
FAKE_BIN="$TMP/bin"
CALLS="$TMP/curl.calls"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$FAKE_BIN"
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
        | PATH="$FAKE_BIN:$PATH" LAZYBUDDY_FAKE_CURL_CALLS="$CALLS" bash "$PLUGIN/mcp/docs/server.sh"
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

echo "PASS: docs MCP only requests fixed HTTPS package registry endpoints; hostile names and loopback metadata never trigger a fetch"
