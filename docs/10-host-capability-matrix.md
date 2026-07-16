# Host capability matrix

This matrix prevents package inventory from being mistaken for verified host
behavior. All published validation is **macOS only**.

| Capability | CodeBuddy IDE/CLI | WorkBuddy plugin/marketplace | WorkBuddy local fallback |
| --- | --- | --- | --- |
| Package assets and local checks | Present; prove package readiness only. | Present; prove package readiness only. | Local skills are an import source. |
| Commands, agents, hooks | Require a verified host session. | Require a verified plugin/marketplace session. | Not automatically loaded or claimed. |
| Six local MCP declarations | Package declarations; host connection must be observed. | Connection needs a verified session. | Configure compatible connectors manually. |
| Host setup/removal | Use CodeBuddy's plugin flow. | Use WorkBuddy's documented UI/marketplace flow. | Use Skills UI and Settings; preserve unrelated entries. |
| Proof | New-session command/skill plus MCP status. | Loaded-session observation. | Imported skill plus every manual connector observed. |

No row implies feature parity between CodeBuddy and WorkBuddy. The copied
repository is not a verified WorkBuddy installer, and a local check cannot
prove plugin discovery, hook execution, or MCP connection. See [install and
host verification](03-install-and-host-verification.md) and [MCP lifecycle](07b-mcp-lifecycle.md).
