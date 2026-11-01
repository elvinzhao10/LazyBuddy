# LazyBuddy 1.4.1 native integration

Release 1.4.1: 2026-11-01. The maintainer authorized final audit and publication; published tags and release assets are the distribution authority.

CodeBuddy uses its native marketplace/plugin manifests. WorkBuddy full-plugin behavior remains build-specific; its recovery route is Skills plus manually configured MCP. Do not equate the two applications.

## Native versus portable behavior

The app owns plugin discovery, native tools, user settings, model/provider selection, permissions and live sessions. This package contributes the appropriate manifests/project assets and bridges. The shared local dashboard, verification and run ledger remain package capabilities; a working browser fallback is not native embedding. Do not start a parallel loop/scheduler or copy host settings into package state. Simple requests stay direct.

## Acceptance and release gates

- Package: version classification, load/contract checks, relevant adapter regressions and extracted-archive validation.
- Host: record exact client/build/route, verify one command/Skill, roles/hooks as applicable and six project-bound MCP connections. These model-driven tests remain deferred; absent evidence stays pending.
- Release: green CI at the exact PR head, matching 1.4.1 runtime/manifests, self-contained archives and recorded digests. After maintainer authorization, merge the verified head, tag the merged revision, run the gated release workflow and verify the published asset. Keep auto-merge disabled and do not bypass failed gates.

See [platform audit](platform-status-2026-10-30.md) for first-party documentation, build distinctions and known limits; [host capability matrix](../10-host-capability-matrix.md) for route-specific contracts; and [release notes](../../RELEASE_NOTES.md) for the complete combined scope. Historical dated records retain their original version and observations.
