# LazyBuddy v1.4.1

Released **2026-11-01**. Better verification history, resumable work, and app-specific integration.

## Eval-driven fixes

- Save verification scenarios and compare attempts against the matching task, plan, and source revisions.
- Turn an observed failure into a regression scenario without losing the original evidence.
- Keep rerun approvals tied to the work reviewed; stale or consumed approvals cannot authorize another attempt.
- Inspect checkpoint and decision history while keeping failed attempts visible.

## Measured efficiency

Reuse matching evidence and avoid repeating unchanged source capture. Simple tasks keep a direct path; local measurements do not establish universal speed, token, or cost savings.

## Host capability matrix

CodeBuddy uses its native marketplace route. WorkBuddy support depends on the installed build; the host guide describes the full-plugin and recovery routes. [Compatibility and setup](docs/reference/native-integration-1.4.1.md).

## Migration and upgrade

Follow the [installation and update guide](docs/03-install-and-host-verification.md) for your app. Keep project history and local settings, then reload or restart the selected client and verify the integration.

## Known risks

Host readiness depends on your app, build, and permissions. Package checks and native loading do not establish model-driven acceptance. See the [host guide](docs/reference/native-integration-1.4.1.md) for the supported route and verification requirements.

## Rollback

Use the receipt-aware removal or rollback flow in the [host guide](docs/reference/host-routes.md); preserve modified files and project evidence.

[Previous releases](https://github.com/elvinzhao10/LazyBuddy/releases) · [Changelog](CHANGELOG.md)
