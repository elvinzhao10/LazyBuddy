# Platform status — 2026-10-02

Current documentation release: **v1.3.5**. Reviewed official documentation on
2026-10-02. Documentation describes available host features, not authenticated
execution of these packages. **HOST READINESS: PENDING** for every current
surface below. Package checks, version probes, and historical observations do
not establish current plugin loading, delegation, hooks, or MCP connections.

## Native platform, adapter, and observed boundaries

| Product / surface and version scope | Official native capability | Package adapter boundary | Current observation |
| --- | --- | --- | --- |
| LazyBuddy / CodeBuddy CLI, current rolling docs | Plugins bundle skills, agents, hooks, MCP and LSP; marketplace installation persists, `--plugin-dir` is session-only. Agent fields include scoped memory (`user`, `project`, `local`), background and `isolation: worktree`; plugin agent frontmatter excludes permissionMode, hooks and mcpServers. [Reference](https://www.codebuddy.ai/docs/cli/plugins-reference) | Use native scoped memory and worktree isolation; omit disabled memory rather than treating Boolean fields as native guarantees. Shared verification is separate from native agent permissions. | Pending; an executable version alone cannot establish agent field enforcement. |
| LazyBuddy / CodeBuddy IDE | IDE integration has its own connection and session lifecycle. [Integration](https://www.codebuddy.ai/docs/cli/ide-integrations) | Existing CLI-backed marketplace route requires observation in the selected IDE; IDE extension integration is not interchangeable with the standalone IDE. | Pending; historical GUI observations are build-specific. |
| LazyBuddy / WorkBuddy | CodeBuddy's marketplace reference describes shared runtime projection and host-owned management; recognizing a `.workbuddy-plugin` manifest does not prove every desktop surface loads it. [Ownership](https://www.codebuddy.ai/docs/cli/plugin-marketplaces) | Full-plugin candidate and skills/manual-MCP recovery route remain distinct. Keep desktop approvals and runtime identity. | Pending; no current desktop acceptance. |
| LazyTrae / TraeCode IDE, CN docs | Native hooks include blocking request/tool/Stop decisions. [Hook reference](https://docs.trae.cn/ide_hook-configuration-reference) | Shipped legacy advisory hooks do not automatically acquire native enforcement. See the detailed migration boundary below. | Pending; CN documentation is not global TRAE compatibility proof. |
| LazyTrae / TraeWork | Separate Work product, discovery and execution surface in the official product family. [Official docs](https://docs.trae.cn/) | Desktop/local skills plus manual MCP; web/mobile/cloud profiles remain descriptors. Do not assume local paths work remotely. | Pending for each client/execution profile. |
| LazyTrae / TraeCode CLI 2.0, CN docs | `traecli`, `/plugins`, `/skills`, `/mcp`; user config `~/.trae/traecli.toml`. [Quick start](https://docs.trae.cn/cli_get-started-with-trae-code-cli-2), [extensions](https://docs.trae.cn/cli_tools-and-extensions), [config](https://docs.trae.cn/cli_config-file) | Existing `.traecli/` candidate files are inert package output. These pages do not specify a complete plugin manifest or establish candidate compatibility. | Pending; legacy CLI 1.x and CLI 2.0 must be identified separately. |
| LazyQoder / Qoder CLI, current rolling docs | Current command is `qoder plugins install <local-directory>` with `.qoder-plugin/plugin.json`; plugin skills, agents, hooks and MCP are documented. [Plugins](https://docs.qoder.com/cli/plugins) | Older packaged CLI marketplace commands are a separate version-specific route. Do not silently substitute the new command or claim it was tested. | Pending; record executable, version and exact route before installation. |
| LazyQoder / Qoder app and Qoder IDE | Current Qoder app documents CLI-compatible hooks and user/project settings. [App hooks](https://docs.qoder.com/qoder/hooks), [CLI hooks](https://docs.qoder.com/cli/hooks) | A Settings entry proves configuration visibility only. Qoder app, IDE and any editor extension require independent discovery, hook and tool checks. | Pending for each surface; shared naming is not acceptance. |
| LazyZCode / ZCode app, current rolling docs | User and enabled-plugin hooks run; project hook configuration is ignored. PreToolUse can deny/ask or replace input; Stop continuation has a three-block limit. [Hooks](https://zcode.z.ai/en/docs/hooks) | Keep plugin protocol, executor and session snapshot semantics. Do not advertise project configuration as active hook installation. | Pending; verify in a fresh session after changes. |
| LazyKimi / current Kimi Code CLI | Node.js rewrite of Python/uv kimi-cli; migration excludes old plugins and authorizations. [Migration](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/migration.html) | `lazykimi` is the package harness, distinct from upstream `kimi`. Manifest MCP without explicit project binding remains fail-closed. | Pending; current client family is not a loaded plugin. |
| LazyKimi / Kimi Code for VS Code | Official extension uses bundled or configured CLI via `kimi.executablePath`. [Quick start](https://www.kimi.com/code/docs/en/kimi-code-for-vscode/getting-started.html) | Record extension and CLI versions, executable and workspace binding. | Pending independently of terminal CLI. |
| LazyKimi / CLI through ACP editors | Zed and JetBrains launch `kimi acp`; GUI environment and forwarded MCP transports matter. [IDE guide](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/ides.html) | Record editor, ACP transport and CLI child process. | Pending for each editor. |
| LazyKimi / Kimi Code Desktop | Dedicated coding application shares CLI settings/extensions and `~/.kimi-code` data. [Settings](https://www.kimi.com/code/docs/en/kimi-code-desktop/settings-and-extensions.html) | Shared configuration does not merge app identity or certify reuse. Removal must preserve shared credentials and other plugins. | Pending independently of CLI and VS Code. |
| LazyKimi / Kimi Work and Kimi web | Work is the general Kimi desktop Work mode, distinct from Code Desktop; Work supports full plugins, web only skills/MCP. [Work](https://www.kimi.com/en/help/kimi-work/overview), [plugin comparison](https://www.kimi.com/en/help/plugins-and-skills/overview) | LazyKimi full Work integration stays experimental; skills-copy plus manual MCP is a limited fallback. Web is not a full local execution route. | Pending; no full Work acceptance. |
| LazyDeepSeek / DeepSeek Harness | Pinned upstream `dsh-v0.2.0-rc.2`. [Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) | Package bridge emits seven native events plus two adapter-synthesized events. Do not call the synthesized events native. Profile-scoped install and generated runtime ownership remain separate. | Pending; pin compatibility and fixture checks are package evidence. |

## TraeCode native hooks and the separate-adapter decision

CN IDE docs use project `.trae/hooks.json`, user `~/.trae-cn/hooks.json`,
JSON stdin/stdout and tool name `RunCommand`. Exit 2 blocks UserPromptSubmit,
PreToolUse and Stop according to event semantics; it does not block
SessionStart. Stop JSON can request continuation, bounded by `loop_limit`
(default five). PostToolUse cannot undo an executed tool. This invalidates a
blanket claim that TRAE host hooks are advisory. The shipped LazyTrae adapter
is still advisory and its CLI/MCP gate remains the package completion
boundary. [Native protocol](https://docs.trae.cn/ide_hook-configuration-reference).

Retain a thin Trae adapter for tool-name mapping, hook serialization, approval
transport, manifest/install differences and per-region/per-version behavior.
Absence of native hooks is no longer a sound rationale for a permanently
separate core. CLI 2.0 plugin UI documentation does not prove its complete
schema or establish compatibility with the existing candidate generator.
Do not reuse CN paths or trust behavior as a global TRAE guarantee.

## Kimi installation and removal ownership

Current CLI syntax is `/plugins install <path-or-url>`; repository URLs can
select a release tag or commit, including
`https://github.com/<owner>/<repo>/releases/tag/<tag>`. A custom catalog is
`/plugins marketplace <marketplace-json-path-or-url>`; there is no documented
`marketplace add` subcommand. Local installs run from a managed copy;
reinstall after source changes. `/plugins remove <id>` removes the registry
entry but retains the managed copy and original source. Installation is
user-scoped, not project-scoped. Apply changes with `/reload` or a new session.
These are host commands, not commands for the OS shell. Preserve retained
host-owned files during package offboarding. [Plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html).

## Shared verification core direction

For v1.3.5, converge on the identical verification-floor contract and fixtures,
with self-contained vendored `scripts/shared/floor-runner.mjs` copies checked
by hash/provenance. No cross-repository runtime imports or shared external
checkout may be required by an installed package. The floor should express
observable pass/fail evidence consistently while product adapters supply
host-specific invocations. This is a bounded shared-core step, not a monorepo
migration or a promise that all runtimes have been unified.

Keep native hooks, manifests, permissions, install/removal receipts, MCP
transport/project binding and host session observation in explicit adapters.
A host-native feature is not a reason to delete independent completion
verification; nor should package fixtures be presented as native execution.

## Acceptance required before a support promotion

For each matrix row record the exact product, region, version/build,
executable/extension, project, package revision and session. Observe discovery,
one real skill/command, declared agent restrictions, relevant allowed and
blocked hook cases, project-bound MCP calls, and receipt-safe removal. Capture
before/after state for mutations. Check Kimi managed-copy retention, Trae
RunCommand/Stop limits, Qoder old/new CLI route identity, ZCode ignored project
hooks, and DSH native versus synthesized events explicitly. No current
acceptance is claimed by this documentation review.
