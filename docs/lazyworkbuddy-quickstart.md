# Lazyworkbuddy Quickstart

This quickstart gets a developer from a local checkout to a verified Lazyworkbuddy plugin package without reading the original LazyCodex repository.

## Prerequisites

- WorkBuddy with plugin support.
- macOS or Linux shell with `bash` and `python3`.
- This repository checked out locally.

## Install For Development

From the repository root:

```bash
mkdir -p ~/.workbuddy/plugins
ln -s "$(pwd)/lazyworkbuddy-plugin" ~/.workbuddy/plugins/lazyworkbuddy
```

Enable the plugin in the WorkBuddy settings flow if your WorkBuddy install requires explicit plugin enablement. The plugin manifest lives at `lazyworkbuddy-plugin/.workbuddy-plugin/plugin.json`.

## Verify The Package

Run the local checks before relying on the plugin:

```bash
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-docs-check.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-plugin-doctor.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-verify.sh
bash lazyworkbuddy-plugin/scripts/lazyworkbuddy-mcp-test.sh
bash lazyworkbuddy-plugin/scripts/hook-pipeline-test.sh
```

The canonical release status remains [lazyworkbuddy-current-status.md](lazyworkbuddy-current-status.md). As of v0.12 release hardening, the local package gates are `runtime-verified`; method-level parity caveats remain documented in the final parity report.

## First Workspace Run

Use the core workflow in this order:

```text
/init-deep
/ulw-plan "describe the task"
/start-work <approved-plan-name>
/review-work
```

For open-ended evidence loops, use:

```text
/ulw-loop "goal with concrete success criteria"
```

For strict evidence discipline on a high-risk task, add:

```text
/ultrawork
```

## Where State And Evidence Go

| Data | Path |
| --- | --- |
| Project memory | `workbuddy.md`, `.workbuddy/rules/` |
| Durable runs | `.lazyworkbuddy/runs/<run_id>/` |
| Run events | `.lazyworkbuddy/runs/<run_id>/events.jsonl` |
| Checkpoints | `.lazyworkbuddy/runs/<run_id>/checkpoints/` |
| v0.12 orchestration evidence | `.omo/evidence/` |

Do not edit `reference/lazycodex/`. It is a read-only source reference for behavior and attribution.

## Uninstall

Remove the development symlink:

```bash
rm -f ~/.workbuddy/plugins/lazyworkbuddy
```

Project-local memory and run state are separate. Remove them only when you intentionally want to discard workspace state:

```bash
rm -rf .lazyworkbuddy
```

## Troubleshooting

If a check fails, read the failing command output first, then inspect:

- [lazyworkbuddy-current-status.md](lazyworkbuddy-current-status.md) for current expected status.
- [lazyworkbuddy-known-gaps.md](lazyworkbuddy-known-gaps.md) for accepted platform gaps.
- [lazyworkbuddy-mcp-and-tools.md](lazyworkbuddy-mcp-and-tools.md) for MCP capability labels and substitution caveats.
- [lazyworkbuddy-security-and-permissions-plan.md](lazyworkbuddy-security-and-permissions-plan.md) for permission and redaction rules.
