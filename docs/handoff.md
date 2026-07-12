# LazyBuddy documentation handoff

## Purpose

Write the next documentation pass from the implemented package, not from the
private legacy notes. This repository is verified on macOS only.

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
conflict with current behavior. The next documentation pass should record the
release version, tested host surfaces, MCP inventory, and safe host-managed
uninstall procedure after the v0.15 release tasks complete.
