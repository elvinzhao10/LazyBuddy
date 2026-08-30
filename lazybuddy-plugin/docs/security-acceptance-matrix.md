# Security acceptance matrix

The regression matrix in
`tests/fixtures/security-acceptance-matrix.v1.json` fixes the release
acceptance boundary for the security hardening lane. Each case has a positive
control and a fail-closed negative control:

| Case | Positive control | Negative control |
| --- | --- | --- |
| IPv4-mapped IPv6 | ordinary loopback endpoint | `::ffff:127.0.0.1` endpoint |
| Redirects | fixed HTTPS registry request | each redirect destination, including a private second hop |
| MCP arguments | typed object accepted | non-object arguments return JSON-RPC invalid parameters |
| Evidence redaction | benign audit data preserved | secret-bearing data is redacted |
| Residual risk | typed, scoped, revision-bound non-authoritative receipt | missing scope/revision or completion-authoritative receipt |

The matrix is an acceptance contract, not evidence that a later network or MCP
hardening implementation has executed. It must remain fail-closed: a residual
risk receipt records an open limitation and never promotes task completion.
