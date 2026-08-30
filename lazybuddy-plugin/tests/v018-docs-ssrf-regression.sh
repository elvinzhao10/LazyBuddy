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
exit 99
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

: >"$CALLS"
wrong_type_response="$(rpc_raw '{"jsonrpc":"2.0","id":"wrong-type","method":"tools/call","params":{"name":"get_library_docs","arguments":{"library":[],"registry":"npm"}}}')"
python3 - "$wrong_type_response" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
assert response["id"] == "wrong-type", response
assert response["error"]["code"] == -32602, response
PY
[ ! -s "$CALLS" ] || { echo 'FAIL: wrong-typed MCP arguments launched curl' >&2; exit 1; }

"${LAZYBUDDY_TEST_PYTHON:-python3}" - "$PLUGIN/mcp/docs/network_boundary.py" <<'PY'
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("lazybuddy_docs_security", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

public = module.validate_destination("https://93.184.216.34/docs")
assert public[0] == "93.184.216.34", public
for hostile in (
    "https://[::ffff:127.0.0.1]/docs",
    "https://127.0.0.1/docs",
    "https://[::1]/docs",
):
    try:
        module.validate_destination(hostile)
    except module.NetworkBoundaryError as error:
        assert error.code == "NETWORK_DESTINATION_REJECTED", error
    else:
        raise AssertionError(f"private destination accepted: {hostile}")

hops = []
def safe_request(url, addresses, timeout):
    hops.append((url, tuple(addresses)))
    if len(hops) == 1:
        return 302, "", "https://93.184.216.34/docs"
    return 200, "safe public redirect", None

body, error = module.fetch_with_redirects(
    "https://registry.npmjs.org/pkg/latest",
    20,
    resolver=lambda host, port, timeout: ["104.16.1.35"] if host == "registry.npmjs.org" else [host],
    requester=safe_request,
)
assert (body, error) == ("safe public redirect", None), (body, error)
assert len(hops) == 2, hops

def pivot_request(url, addresses, timeout):
    return 302, "", "https://[::ffff:127.0.0.1]/secret"

body, error = module.fetch_with_redirects(
    "https://registry.npmjs.org/pkg/latest",
    20,
    resolver=lambda host, port, timeout: ["104.16.1.35"],
    requester=pivot_request,
)
assert body is None, body
assert error == "NETWORK_DESTINATION_REJECTED", error

original_run = module.subprocess.run
try:
    captured = {}
    class Completed:
        returncode = 0
        stdout = "public response"

    def completed(args, **kwargs):
        captured["args"] = args
        header_path = args[args.index("--dump-header") + 1]
        with open(header_path, "w", encoding="iso-8859-1") as headers:
            headers.write("HTTP/1.1 200 OK\r\n\r\n")
        return Completed()

    module.subprocess.run = completed
    module.CURL = "curl"
    status, response, location = module._request_once(
        "https://registry.npmjs.org/pkg/latest", ["104.16.1.35"], 1,
    )
    assert (status, response, location) == (200, "public response", None)
    assert "--resolve" in captured["args"], captured
    assert captured["args"][captured["args"].index("--noproxy") + 1] == "*", captured
    assert "-L" not in captured["args"], captured

    def timed_out(*args, **kwargs):
        raise module.subprocess.TimeoutExpired(args[0], kwargs.get("timeout", 1))

    module.subprocess.run = timed_out
    try:
        module._resolve_addresses("slow.example", 443, 1)
    except module.NetworkBoundaryError as error:
        assert error.code == "DNS_RESOLUTION_TIMEOUT", error
    else:
        raise AssertionError("long DNS lookup did not fail closed")

    module.CURL = "curl"
    try:
        module._request_once("https://93.184.216.34/docs", ["93.184.216.34"], 1)
    except module.NetworkBoundaryError as error:
        assert error.code == "HTTP_REQUEST_TIMEOUT", error
    else:
        raise AssertionError("long HTTP request did not fail closed")
finally:
    module.subprocess.run = original_run
PY

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

echo "PASS: docs MCP validates every HTTPS redirect hop and returns structured invalid-argument errors without a fetch"
