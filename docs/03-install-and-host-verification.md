# Install and host verification

This page separates the safe local package checks from the live host proof needed before relying on LazyBuddy integration behavior. All published verification is **macOS only**.

## The two-step rule

1. Run package checks to establish **package readiness**.
2. Use the selected host and observe its loaded session or settings to establish **host proof**.

Package readiness validates copied package assets, declarations, inventories, and local contracts. It does not prove plugin discovery, marketplace installation, SessionStart, hook execution, MCP connection, or a running host session. The [verification contract](reference/verification-contract.md) records the detailed check-to-claim boundary.

## Run the package checks

From the repository root, run:

```bash
bash lazybuddy-plugin/scripts/lazybuddy-load-check.sh
bash lazybuddy-plugin/scripts/lazybuddy-plugin-doctor.sh
bash lazybuddy-plugin/scripts/lazybuddy-verify.sh
```

The load check reports package readiness, such as `PACKAGE_READINESS=full` or an explained degraded state. The doctor and aggregate verification add local package evidence. They are read-only package checks: they do not activate optional providers, register host MCP entries, install a global host integration, or prove a host connection.

## Pick exactly one host route

Use the detailed steps and required observation in [host routes](reference/host-routes.md).

| Surface | Setup boundary | Required proof |
| --- | --- | --- |
| CodeBuddy IDE | Use the host plugin flow for the copied package; reload only if the host offers it. | In a new session, observe a `lazybuddy` skill or command and MCP status. |
| CodeBuddy CLI | Use current host marketplace discovery, confirm the publisher and immutable revision or release reference, then use the host-generated install action. | Start a new CLI session and inspect plugin/MCP activation. |
| WorkBuddy plugin/marketplace | Use WorkBuddy’s documented plugin/marketplace UI. | Confirm a loaded session before relying on plugin hooks, agents, commands, or MCP. |
| WorkBuddy skills-only fallback | Import `lazybuddy-plugin/skills/` with Skills UI and add compatible MCP connectors manually. | Observe an imported skill and every manual connector in Settings. |

The copied repository is **not** a verified WorkBuddy plugin installer. The skills-only fallback is deliberately narrower: it does not claim automatic loading of hooks, agents, commands, or MCP declarations.

## What not to do during onboarding

Do not treat package scripts as authority to change marketplace, account, credentials, host settings, remote providers, browser automation, or optional architecture tooling. Those are separate user decisions. For optional-capability details, see [capabilities and approvals](06-capabilities-and-approvals.md).

After the required host proof, continue with [your first task](02-first-task.md). For safe removal, use [safe removal](08-safe-removal.md) rather than guessing host-managed paths.
