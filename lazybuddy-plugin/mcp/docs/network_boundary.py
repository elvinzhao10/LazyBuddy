"""Bounded HTTPS resolution and redirect enforcement for the docs MCP."""

import ipaddress
import json
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urljoin, urlsplit

CURL = shutil.which("curl")


class NetworkBoundaryError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _resolve_addresses(host, port, timeout):
    resolver = """import json,socket,sys
records=socket.getaddrinfo(sys.argv[1],int(sys.argv[2]),type=socket.SOCK_STREAM)
print(json.dumps(sorted({record[4][0] for record in records})))
"""
    try:
        result = subprocess.run(
            [sys.executable, "-I", "-c", resolver, host, str(port)],
            capture_output=True,
            text=True,
            timeout=min(timeout, 5),
        )
    except subprocess.TimeoutExpired as error:
        raise NetworkBoundaryError("DNS_RESOLUTION_TIMEOUT") from error
    if result.returncode != 0:
        raise NetworkBoundaryError("DNS_RESOLUTION_FAILED")
    try:
        addresses = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise NetworkBoundaryError("DNS_RESOLUTION_FAILED") from error
    if not isinstance(addresses, list) or not addresses:
        raise NetworkBoundaryError("DNS_RESOLUTION_FAILED")
    return addresses


def validate_destination(url, resolver=_resolve_addresses, timeout=20):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or not parsed.hostname:
        raise NetworkBoundaryError("NETWORK_DESTINATION_REJECTED")
    try:
        port = parsed.port or 443
    except ValueError as error:
        raise NetworkBoundaryError("NETWORK_DESTINATION_REJECTED") from error
    try:
        literal = ipaddress.ip_address(parsed.hostname)
        addresses = [str(literal)]
    except ValueError:
        addresses = resolver(parsed.hostname, port, timeout)
    for address in addresses:
        try:
            candidate = ipaddress.ip_address(address)
        except ValueError as error:
            raise NetworkBoundaryError("DNS_RESOLUTION_FAILED") from error
        mapped = candidate.ipv4_mapped if isinstance(candidate, ipaddress.IPv6Address) else None
        if not candidate.is_global or (mapped is not None and not mapped.is_global):
            raise NetworkBoundaryError("NETWORK_DESTINATION_REJECTED")
    return parsed.hostname, port, addresses


def _request_once(url, addresses, timeout):
    if not CURL:
        raise NetworkBoundaryError("HTTP_CLIENT_UNAVAILABLE")
    parsed = urlsplit(url)
    resolve_args = []
    for address in addresses:
        formatted = "[%s]" % address if ":" in address else address
        resolve_args.extend(["--resolve", "%s:%d:%s" % (parsed.hostname, parsed.port or 443, formatted)])
    with tempfile.NamedTemporaryFile() as headers:
        try:
            result = subprocess.run(
                [CURL, "-sS", "--noproxy", "*", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "0",
                 "--max-time", str(timeout), "--dump-header", headers.name, "-A", "lazybuddy-docs/1.2.1",
                 *resolve_args, url],
                capture_output=True,
                text=True,
                timeout=timeout + 5,
            )
        except subprocess.TimeoutExpired as error:
            raise NetworkBoundaryError("HTTP_REQUEST_TIMEOUT") from error
        headers.seek(0)
        header_text = headers.read().decode("iso-8859-1")
    if result.returncode != 0:
        raise NetworkBoundaryError("HTTP_REQUEST_FAILED")
    status_lines = [line for line in header_text.splitlines() if line.startswith("HTTP/")]
    try:
        status = int(status_lines[-1].split()[1])
    except (IndexError, ValueError) as error:
        raise NetworkBoundaryError("HTTP_RESPONSE_INVALID") from error
    location = next((line.split(":", 1)[1].strip() for line in header_text.splitlines()
                     if line.lower().startswith("location:")), None)
    return status, result.stdout, location


def fetch_with_redirects(url, timeout=20, resolver=_resolve_addresses, requester=_request_once):
    current = url
    for _ in range(6):
        try:
            _, _, addresses = validate_destination(current, resolver, timeout)
            status, body, location = requester(current, addresses, timeout)
        except NetworkBoundaryError as error:
            return None, error.code
        if 300 <= status < 400:
            if not location:
                return None, "HTTP_RESPONSE_INVALID"
            current = urljoin(current, location)
            continue
        if 200 <= status < 300 and body:
            return body, None
        return None, "HTTP_REQUEST_FAILED"
    return None, "REDIRECT_LIMIT_EXCEEDED"
