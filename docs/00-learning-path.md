# Learning path

Use this path in order the first time. It is deliberately short: learn the evidence boundary, make one focused request, then prove the host surface you intend to use.

## 1. Understand the boundary

Read the [mental model](01-mental-model.md). The key distinction is between a package check and a host observation. LazyBuddy is verified on macOS only, and passing a local script does not prove a CodeBuddy or WorkBuddy session is live.

## 2. Choose the smallest task

Start with one observable outcome. The [first-task guide](02-first-task.md) uses project search as an example, but a small bug fix or focused UI adjustment works just as well. Include the behavior that must work and how it will be checked.

## 3. Install only for your host

Follow [installation and host verification](03-install-and-host-verification.md), then use the detailed [host routes](reference/host-routes.md). Choose one surface:

- CodeBuddy IDE through its plugin flow.
- CodeBuddy CLI through its current marketplace discovery flow.
- WorkBuddy through its documented plugin/marketplace UI.
- WorkBuddy's verified no-package-manager fallback: import local skills and configure compatible MCP connectors manually.

Do not assume that a copied repository installs a WorkBuddy plugin. The local skills import intentionally exposes a smaller surface.

## 4. Work proportionally

For a focused change, ask normally. For an uncertain, multi-file, or architectural change, use the appropriate [workflow playbook](04-workflow-playbooks.md) and approve the resulting plan before implementation. Use the durable loop only for long-running outcomes.

## 5. Finish with evidence

Read [evidence and completion](05-evidence-and-completion.md). A passing unit test is useful evidence, but it is not automatically proof of the user-facing result. Exercise the matching CLI, page, API, or other requested surface.

If optional tooling is relevant, consult [capabilities and approvals](06-capabilities-and-approvals.md) before enabling anything. Normal onboarding and readiness checks do not enable providers, register MCP servers, install global tools, or change host settings.
