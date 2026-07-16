# Security and authority

LazyBuddy's local checks are useful evidence, but they are never authority to
change a host, access a credential, or claim that a host integration is live.
The selected CodeBuddy or WorkBuddy session remains the authority for that
host's plugin loading, hooks, and MCP connection. Published verification is
**macOS only**.

## What the package policy protects

The PreToolUse policy denies secret-like targets for structured `Write` and
`Edit` requests. It examines only the string fields `path`, `file_path`, and
`filePath`; it normalizes separators and lexical traversal for matching. Text
in content, replacement text, descriptions, nested fields, or unrelated keys
does not become a target path merely because it mentions `.env` or `id_rsa`.

`Bash` deliberately retains a conservative literal scan of its command input.
That protects obvious secret-path access, but can produce false positives when
a command merely contains a secret-like path literal. LazyBuddy does not claim
to parse shell syntax semantically. Destructive deletion, force-push/hard
reset, and unapproved publication checks remain separate denials.

## Network and documentation boundary

The bundled `docs` MCP resolves package documentation only through fixed HTTPS
registry requests: `registry.npmjs.org` for npm and `pypi.org` for PyPI. It
accepts validated package names, disables redirects, and never fetches a
homepage, repository, documentation URL, or arbitrary metadata link. Registry
metadata can be returned as text; it is not permission to follow a URL inside
that metadata. See [the MCP inventory](reference/mcp-inventory.md).

## Explicit roots, not discovery

From an unrelated workspace, an operator can name the copied plugin directly:

```bash
CODEBUDDY_PLUGIN_ROOT="/absolute/path/to/lazybuddy-plugin" \
  bash /absolute/path/to/lazybuddy-plugin/scripts/lazybuddy-load-check.sh
```

The explicit override selects that plugin root directly; it does not discover a
different plugin root through parents, siblings, marketplaces, or a filesystem
scan. The load check can still read a parent `.codebuddy-plugin/marketplace.json`
when no explicit `LAZYBUDDY_MARKETPLACE_FILE` is supplied, solely to validate a
marketplace entry's version against the selected root's manifest. That metadata
validation is not plugin-root discovery and does not install, register, or
prove a host integration. Without `CODEBUDDY_PLUGIN_ROOT`, only the documented
copied-repository/plugin-root layouts are tried, and an unavailable-root result
is expected elsewhere. This is package-readiness evidence, not host proof.

## Decisions that stay with the user

Host settings, marketplace installation, credentials, remote providers,
browser automation, and any connector registration require the host flow or an
explicit approval. The capability broker is task-scoped; it does not rewrite
host configuration or persist a registration. Continue with [receipts and
owned tooling](06b-receipts-and-owned-tooling.md) and [host routes](reference/host-routes.md).
