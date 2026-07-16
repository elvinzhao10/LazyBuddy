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

## macOS-only scope

The package evidence is verified on macOS only. It does not claim equivalent host loading, marketplace behavior, hook execution, or MCP connection on other operating systems. Those are observed per host session.
