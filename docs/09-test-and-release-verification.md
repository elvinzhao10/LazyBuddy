# Test and release verification

LazyBuddy uses five layers of evidence. Passing one layer must not be reported
as proof of a stronger layer.

| Layer | What it checks | What it does not prove |
| --- | --- | --- |
| 1. Static/documentation contracts | Required files, headings, inventories, and safe local links. | Host loading or connection. |
| 2. Focused regressions | Security, path, protocol, state, and failure behavior. | A host invoked the behavior. |
| 3. Local package checks | Readiness, doctor, MCP protocol, hook pipeline, and aggregate verification. | Marketplace activation or a live host session. |
| 4. Manual product QA | The requested CLI, page, API, or other real product surface. | Every host/plugin route. |
| 5. Host observation | A selected host's new-session command/skill and MCP status. | All package or product checks. |

## Read the aggregate result

`bash scripts/lazybuddy-verify.sh` produces final JSON with per-check status
and reason. It prints bounded progress while checks run. A `timeout` is a
failure; `unavailable` means the relevant command could not be launched; an
absent CodeBuddy validator is reported as UNCHECKED by doctor. None of these
states prove a host feature.

For trusted package-owned checks, a timeout terminates the dedicated process
group and JSON/stderr show whether descendants were still detectable at cleanup
time. This is best-effort cleanup, not a security boundary or a guarantee that
all descendants stopped. Genuinely untrusted commands need a VM or
container-backed runner; LazyBuddy does not enable a no-fork sandbox by
default.

## Release boundary

Normal CI is self-contained and does not require a sibling repository. A
release-only paired comparison may use an explicitly supplied sibling root as
evidence; it is not installation, runtime, or ordinary CI dependency. The
published check scope is macOS only.

Use [verification contract](reference/verification-contract.md) for commands,
[security and authority](06a-security-and-authority.md) for adversarial
boundaries, and [evidence and completion](05-evidence-and-completion.md) for a
reproducible DoneClaim.
