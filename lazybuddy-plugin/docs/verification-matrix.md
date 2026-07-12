# LazyBuddy package verification contract

This contract is package-owned so a copied `lazybuddy-plugin/` can discover
its verification checks without repository-root documentation.

## Package checks

| Verification Step | Command | Expected | Artifact |
| --- | --- | --- | --- |
| Package readiness | `bash scripts/lazybuddy-load-check.sh` | `PACKAGE_READINESS=full` or an explained degraded state | command output |
| Package health | `bash scripts/lazybuddy-plugin-doctor.sh` | `Doctor check: ALL PASS` | command output |
| MCP integration | `bash scripts/lazybuddy-mcp-test.sh` | `MCP test: ALL PASS` | command output |
| Package verification | `bash scripts/lazybuddy-verify.sh` | JSON with `"all_pass":true` | command output |
