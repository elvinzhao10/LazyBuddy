# LazyBuddy

![LazyBuddy](lazybuddy-banner.jpg)

LazyBuddy helps you use structured, evidence-based workflows in **CodeBuddy
CLI**, **CodeBuddy IDE**, and **WorkBuddy**. It prepares local package assets
and guidance; a host is only considered ready after it is observed in a fresh
session.

The current stable release is [v1.1.0](https://github.com/elvinzhao10/LazyBuddy/releases/tag/v1.1.0).

## Recommended: install with AI help

You do not need to manually work through every setup detail. Open an AI coding
assistant in your project and paste this:

> Help me install LazyBuddy from https://github.com/elvinzhao10/LazyBuddy for
> this project. Use the stable v1.1.0 route. Run safe package checks first,
> explain each step plainly, and ask me before changing marketplace, plugin,
> Skills, MCP, account, credential, or trust settings.

The assistant can guide onboarding, but you approve every host-managed change.

## Manual setup

Manual setup is available when you prefer complete control. You need
**Node.js LTS 20 or newer** and **Git**. Start from the verified origin
`https://github.com/elvinzhao10/LazyBuddy` and follow the
[installation guide](docs/03-install-and-host-verification.md).

Run `onboard` once to create a durable installation. After that, use the stable
launcher for `update`, `status`, and safe `offboard`:

```text
node "<install-root>/LazyBuddy/launcher.js" status
```

## What “ready” means

- **Package readiness** means the copied package and local checks are valid.
- **Host readiness** needs a fresh host session, one real Skill or command,
  and every expected MCP connection.

Until that is observed, the honest result is **HOST READINESS: PENDING**.
Local files and load checks never prove that a host loaded the plugin.

## Choose one route

Pick one host route during onboarding:

- **CodeBuddy CLI** uses the documented local marketplace route.
- **CodeBuddy IDE** uses that marketplace route when the CLI is available.
- **WorkBuddy** uses its full-plugin marketplace route.

Skills plus manual MCP connectors are a recovery-only option. Do not run that
fallback beside a full-plugin route for the same project. Stop the session,
remove only LazyBuddy's previous entries through the host UI, choose one route,
and start a new session to verify it.

## Design mindset

Start with the result you want and how you will know it worked. Then use the
smallest amount of structure that fits the task. You can simply describe the
work in plain language; the modes are guidance, not commands you need to
memorize.

| Mode | Use it when | Example request |
| --- | --- | --- |
| Direct | The change is small and clear. | “Fix this error and run the relevant test.” |
| Assisted | You need help understanding an unfamiliar area or failure. | “Help me find why this command fails, then verify the fix.” |
| Planned | The work has several parts or important choices. | “Make a plan for this feature before changing files.” |
| Orchestrated | The work affects a release, security, or a risky change. | “Review this release and prepare it for publication.” |
| Long-horizon | The goal needs to continue across sessions. | “Keep working on this migration with checkpoints.” |

## Keep host changes deliberate

LazyBuddy does not automate credentials, OAuth values, private registries, or
trust settings. It asks for approval before any host-managed action and keeps
safe package checks separate from marketplace and connector changes.

## Package inventory

| Surface | Count | Role |
| --- | ---: | --- |
| Skills | 14 | Host-facing workflow policies for planning, execution, review, and verification. |
| Commands | 14 | Named host entry points for those workflow policies. |
| Agents | 13 | Specialist role definitions for planning, implementation, QA, security, and context. |
| MCP declarations | 6 | Local services for ledger, verification, status, context, code intelligence, and docs. |

## Technical reference and evaluation

The source-level explanation lives in [docs/README.md](docs/README.md). It
maps the package structure, request flow, state model, security boundaries,
MCP lifecycle, and release checks with diagrams tied to the implementation.

For a capability-by-capability comparison with the original LazyCodex design,
including what LazyBuddy implements and where it intentionally differs, see
[lazybuddy-evaluation.md](lazybuddy-evaluation.md).

LazyBuddy is primarily inspired by LazyCodex
([upstream project](https://github.com/code-yeongyu/lazycodex)). Its
relationship to OmO and upstream sources is recorded in [NOTICE](NOTICE).
It is an independent implementation and does not require LazyCodex or OmO at
runtime.

## Learn more

- [Install and verify a host](docs/03-install-and-host-verification.md)
- [Supported v1.1.0 route](docs/v1.1.0-supported-route.md)
- [Host routes and recovery](docs/reference/host-routes.md)
- [Release notes](RELEASE_NOTES-v1.1.0.md)
- [Documentation index](docs/README.md)

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution and provenance.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for development checks, release expectations, and guidance for reporting
sanitized reproduction details. Report vulnerabilities privately according to
[SECURITY.md](SECURITY.md).
