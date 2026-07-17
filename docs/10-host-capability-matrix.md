# Host capability matrix

LazyBuddy deliberately aligns policy and package safety across hosts while keeping host adapters distinct. The same package may be present on two surfaces without both hosts exposing the same loading or registration behavior.

## What each host needs

| Capability | CodeBuddy IDE / CLI | WorkBuddy | Package assertion |
| --- | --- | --- | --- |
| Skills and commands | Host plugin discovery | Plugin/marketplace or local skills import | Files and metadata are present. |
| Agents and hooks | Host plugin lifecycle | Only if the host loads the plugin surface | Package declares adapters; host must execute them. |
| MCP | Host consumes `.mcp.json` declaration | Manual compatible connector configuration for local fallback | Launchers and protocol tests are present. |
| Package readiness | Local scripts | Local scripts | Checks copied assets and contracts, not sessions. |
| Removal | Host plugin flow | Host UI/manual connectors | Package never guesses host locations. |

## Structural differences

The host adapter differs, but the safety model does not:

- **Host integration:** CodeBuddy and WorkBuddy decide plugin discovery, connector registration, session lifetime, and event delivery.
- **State/path:** package run state and receipt-owned tooling roots are local; marketplace directories, `.workbuddy` data, credentials, and connector state remain host/user-owned.
- **Inventory:** six local MCP servers are packaged. Optional remote exports and browser work remain separate explicit decisions.

## Package-built versus host-native behavior

| Behavior | LazyBuddy contribution | Raw host contribution | Learner takeaway |
| --- | --- | --- | --- |
| Workflow guidance | Ships skills, commands, and agent role text. | Decides whether/how those assets are discovered and exposed. | A Markdown command definition is not a running command. |
| Hook policy | Ships event mapping and scripts that validate supported input. | Delivers an event and decides the host lifecycle semantics. | A passing hook test does not prove a host delivered the event. |
| Local MCP | Ships six launchers and server programs. | Starts the process, negotiates connection, and shows tool availability. | A declaration is not a connection. |
| Run/evidence state | Implements package-local scripts and boundaries. | Supplies session context and user-visible integration. | Local records describe package work, not host state. |
| Optional providers | Implements policy, receipts, and export fragments. | Stores credentials and applies connector/network policy. | Selection/receipt status is not provider authorization or connection. |

The complete dependency classification is in [Dependency and host boundary reference](reference/dependency-and-host-boundaries.md).

## macOS-only scope

The package evidence is verified on macOS only. It does not claim equivalent host loading, marketplace behavior, hook execution, or MCP connection on other operating systems. Those are observed per host session.
