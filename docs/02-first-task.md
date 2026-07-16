# Your first LazyBuddy task

Start with a small request whose success can be observed. You do not need to learn every command first.

## Write a useful request

State the outcome, the important constraints, and the surface that should prove it. For example:

> Add project search. Results must work on a real project, have tests, and be checked in the user interface before completion.

This gives the agent three essentials: a feature, acceptance criteria, and a proof surface. Replace project search with your own bounded change.

## Ask it in your host

In a verified CodeBuddy plugin session, workflow commands use the namespace `/lazybuddy:lazy-<command>`. For a small task, asking in plain language is enough. If slash commands are not exposed, make the equivalent natural-language request.

For a task that needs planning, a CodeBuddy session can use:

```text
/lazybuddy:lazy-ulw-plan "add project search"
```

Review and approve the plan before requesting execution. The exact choices for planning, debugging, review, and long-running work are in [workflow playbooks](04-workflow-playbooks.md).

In WorkBuddy, use the equivalent natural-language workflow or an imported skill unless a verified plugin/marketplace session exposes a command. With the skills-only fallback, do not assume commands, agents, hooks, or MCP declarations were automatically loaded.

## Check the result where it matters

Before calling the work complete, run the relevant repository checks and exercise the user-facing surface named in the request. For a UI feature, that means checking the UI; for a CLI feature, invoking the CLI; for an API, exercising the API. Use [evidence and completion](05-evidence-and-completion.md) for a fuller completion checklist.

## If this is your first host session

First establish the correct host proof. [Install and host verification](03-install-and-host-verification.md) explains why local readiness scripts are not sufficient, and [host routes](reference/host-routes.md) contains the host-specific procedure.
