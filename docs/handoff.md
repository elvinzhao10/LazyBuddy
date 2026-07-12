# LazyBuddy documentation handoff

## Purpose

Write the next documentation pass from the implemented package, not from the
private legacy notes. The current package release is v0.15.0-alpha.3 cleanup,
verified on macOS only.

## Start here

- `README.md` explains user-facing workflow and repository layout.
- `AGENTS.md` is the host-specific onboarding guide.
- `lazybuddy-plugin/README.md` describes the installable package and its safe
  install, verification, and uninstall paths.
- `lazybuddy-plugin/` is the package boundary: skills, commands, agents, hooks,
  MCP servers, templates, and scripts must work when copied without repository
  root `docs/` or `dev/` directories.

## Documentation ownership

The tracked `docs/` directory is intentionally small while its replacement
documentation is written. Private legacy material is organized under ignored
`dev/docs/{root,package,mcp,evaluations}/`; it is background only, not an
authoritative source and never a runtime dependency. Do not force-add it.

Place new maintained explanation in `docs/`, keep package-specific operational
instructions beside the package where installation requires them, and verify
links against the tracked tree.

## Validate before documenting behavior

Run these commands from `lazybuddy-plugin/`:

```bash
bash scripts/lazybuddy-load-check.sh
bash scripts/lazybuddy-plugin-doctor.sh
bash scripts/lazybuddy-mcp-test.sh
bash scripts/lazybuddy-verify.sh
```

Treat command output and the package source as the authority if legacy notes
conflict with current behavior. The next documentation pass should preserve the
v0.15.0-alpha.3 release version, tested host surfaces, six-server MCP
inventory, and safe host-managed uninstall procedure.

## v0.16 tooling foundation

`lazybuddy-plugin/scripts/lazybuddy-tooling.sh` owns the optional local
tooling lifecycle. It detects compatible host `rg` and `sg` providers without
altering them, provisions locked fallbacks only in an explicit empty caller
root when a provider is missing, and removes only an unmodified receipt-owned
root. It also exposes `verify --target ... --dry-run|--run` for declared,
allowlisted repository-native checks. Keep this capability package-local: it
must never read root `docs/` or `dev/`, mutate a target manifest/lockfile, or
guess a host-managed installation path.
