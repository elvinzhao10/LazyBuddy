# Host-Adapter: [SOURCE_PLATFORM] → [TARGET_PLATFORM]

**Generated:** [YYYY-MM-DD] | **Version:** [X.Y] | **Status:** [draft/in-progress/verified/released]

## Source & Target Profiles

| Field | Source | Target |
|-------|--------|--------|
| **Name** | [SOURCE_NAME] | [TARGET_NAME] |
| **Version** | [SOURCE_VERSION] | [TARGET_VERSION] |
| **Methods** | [N] skills, [N] agents, [N] hooks, [N] MCP | N/A |
| **Manifest** | [FORMAT_OR_NONE] | [MANIFEST_FORMAT] |
| **Agent model** | [SPAWN_MECHANISM] | [SPAWN_MECHANISM], fields: [NAME, DESC, MODEL, TOOLS] |
| **Hook model** | [EVENT_TYPES] | [EVENT_TYPES] — [SCRIPT/PROMPT/BOTH] |
| **MCP transport** | [STDIO/HTTP] | [STDIO/HTTP] |
| **State dir** | [STATE_DIR] | [STATE_DIR] |
| **Plugin dir** | [PLUGIN_DIR] | [PLUGIN_DIR] (immutable) |

## Tool Mapping

| Source Tool | Target Equivalent | Preserved Behavior | Notes |
|------------|------------------|-------------------|-------|
| [SOURCE_TOOL] | [TARGET_TOOL] | [BEHAVIOR] | [NOTES] |

Example: `multi_agent_v1.spawn_agent({"agent_type":"explorer"})` → WorkBuddy `Agent` tool with `message:"TASK: act as an explorer..."` + `isolation:true` — preserves subagent fork semantics; `agent_type` → described in `message`; `fork_context:false` → `isolation:true`. `update_plan` + `Task` objects → `TaskCreate`/`TaskUpdate`/`TaskList` — status workflow mapping: `pending/in_progress/complete/done` → `pending/in_progress/completed/deleted`.

## Agent, Hook, MCP, File System Mappings

| Domain | Source | Target | Parity |
|--------|--------|--------|--------|
| Agent:[ROLE] | [SOURCE_FILE] | [TARGET_FILE] → model:[MODEL], tools:[LIST] | ported/pending/skipped |
| Hook:[EVENT] | [SOURCE_SCRIPT] | [TARGET_SCRIPT] | YES/PARTIAL/NO |
| MCP:[SERVER] | [STDIO/HTTP] | [STDIO/HTTP] or ❌ (gap) | [WORKAROUND] |
| FS:${PLUGIN_ROOT} | [SOURCE_VAR] | `${CODEBUDDY_PLUGIN_ROOT}` | same semantics |
| FS:.omo/ | .omo/ | `.lazyworkbuddy/` | prefix migrate; `schema_version` bump |
| FS:[DIR] | [SOURCE_DIR] | [TARGET_DIR] | [copy/rename/adapt] |

## Verification Summary

See `verification-matrix-template.md` for full matrix. Summary: [N] direct tool maps, [N] adapted, [N] gaps. [N] agent ports. [N] hook ports. **Doctor gate:** `[DOCTOR_COMMAND]` → expect `[RESULT]`.
