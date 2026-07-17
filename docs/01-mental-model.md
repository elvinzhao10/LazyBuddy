# Execution model

LazyBuddy separates *policy*, *execution*, *durable state*, and *proof*. That separation prevents a descriptive Markdown file, an installed declaration, or a passing local check from being mistaken for a live host capability.

```mermaid
flowchart TB
    Policy["skills + commands\nwhat the workflow asks for"]
    Roles["agents\nwho investigates, implements, verifies"]
    Adapter["hooks + MCP\nhost/protocol adapters"]
    Runtime["scripts\nstate changes and checks"]
    State["run files, plans, evidence, receipts"]
    Proof["test/CLI/API/host observation"]
    Policy --> Roles --> Adapter --> Runtime --> State --> Proof
```

## Policy is not execution

Skills and commands describe how an agent should approach planning, debugging, review, or completion. Agent files narrow that guidance to a role. They do not gain authority merely by existing: a host must select and load them, and an agent must still perform the described work.

## Execution is not proof

The shell and Python scripts are the operational layer. They create run records, validate state, run bounded checks, and format machine-readable results. Their output establishes local package evidence. Proof must be chosen for the requested surface: a test for library behavior, a CLI invocation for a CLI, a browser check for a page, or an observed host session for an integration.

## Host ownership stays external

The package can check manifest structure, local declarations, executable bits, and protocol fixtures. It cannot prove plugin discovery, SessionStart, hook execution, marketplace activation, or a connected MCP session. Those are host facts. This distinction is central to [05 — Evidence and completion](05-evidence-and-completion.md).
