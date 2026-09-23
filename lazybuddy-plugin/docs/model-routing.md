# Model routing

LazyBuddy agents inherit the current model by default. A plan can propose
switching bounded work to `lite`, ordinary work to `default`, or demanding work
to `reasoning`, and must record whether to use that delegation. An alias is an
intent, not a vendor model ID, price, or capability claim. The selected host owns the visible catalog, custom-provider registration,
credential storage, and final model resolution. A recommendation is not proof
that a host loaded LazyBuddy or ran a task.

## Select once, then record and reuse

Propose the delegation and model choices in the plan and remind the user that
switching may change quality, latency, and cost. When the plan is silent, keep
the same current model for every subagent and retry. Use the packaged selector
before the first material task dispatch. Pass `--allow-switch` only when the
plan explicitly enables switching. Consult it
again only after a completed task attempt fails acceptance. A normal TDD red
state or unavailable host/model evidence is not a failed attempt. Store its
output with the task's existing `TASK/DELTA/REFS/VERIFY` handoff and reuse that
result for the task. Do not resample models per subagent or present a later
selection as a native host observation.

```bash
# List the host's documented routing choices; it does not inspect host state.
node contracts/model-routing.js --list --host codebuddy-cli

# Recommend a role route. A safe catalog contains no endpoint or credential.
node contracts/model-routing.js --host codebuddy-cli --task mechanical \
  --allow-switch --catalog /absolute/path/to/safe-model-catalog.json

# Escalate only after failed verification or a declared high-risk task.
node contracts/model-routing.js --host codebuddy-cli --task review \
  --risk high --failed-attempts 1 --allow-switch \
  --catalog /absolute/path/to/safe-model-catalog.json
```

The supported task values are `mechanical`, `implementation`, `architecture`,
`review`, `security`, and `visual`. A safe catalog has exactly
`schema_version: 1`, its matching `host`, and `models`. Each model has only
`id`, `origin` (`builtin` or `custom`), `tier` (`economy`, `balanced`, or
`strong`), `available`, `capabilities` (`tools`, `code`, and optionally
`vision`), and optional non-negative `costRank`. `costRank` is an ordinal
caller estimate only within the named host and task; omit it when unknown and
never treat it as USD. It must not contain an API key, provider URL, account
balance, or host-private state. Use `--model` only with a model ID already
visible to the user in that host. An explicit model that is unavailable,
underqualified, or missing a required capability is refused; the selector never
silently substitutes a different model.

The baseline policy is proportional:

| Task class | Recommended route | Escalation rule |
| --- | --- | --- |
| Mechanical, bounded search, routine indexing | `lite` | Do not treat the alias as inherently cheap; use only a visible model with the needed capability. |
| Implementation and ordinary QA | `default` | Keep the selected balanced route unless verification shows a task-specific shortfall. |
| Architecture, review, security, high-risk work | `reasoning` | Do not downgrade a high-risk task. Failed verification can promote a lower route. |

Selection never uses nationality, provider origin, or a model-name heuristic.
Capability requirements and the current visible catalog decide whether a model
is eligible. Compare actual task outcomes and host-reported token/credit data
only after a real execution; do not infer API pricing from an ID or a tier.

## Host boundary

### CodeBuddy CLI

CodeBuddy CLI can resolve the aliases through scenario mappings and can accept
a selected concrete ID in an Agent tool call only when that current tool schema
offers a `model` parameter. User-selected values remain higher authority; the
blanket `CODEBUDDY_CODE_SUBAGENT_MODEL` environment override takes precedence
over per-agent settings. LazyBuddy does not write it.

The only project configuration preview is non-secret and uses IDs the user has
already seen in the current selector:

```json
{
  "variantModels": {
    "lite": "<USER-SELECTED-VISIBLE-LITE-MODEL-ID>",
    "reasoning": "<USER-SELECTED-VISIBLE-REASONING-MODEL-ID>"
  }
}
```

This preview is not an instruction to write `.codebuddy/settings.json`; never
put provider keys or unverified model IDs in a tracked project file.

### CodeBuddy IDE

Treat the CLI role aliases as advisory until the IDE accepts a visible concrete
model ID for that agent. The IDE documents an optional concrete agent model
declaration and controls its custom-model catalog and effective routing. Do not
claim CLI alias validity or per-agent override precedence for an IDE build
until it is observed there.

### WorkBuddy

Use the model manually selected in WorkBuddy or its Auto Mode result. WorkBuddy
model configuration is host-owned; LazyBuddy declares no undocumented
per-agent override and does not write a WorkBuddy model configuration.

## Existing LazyBuddy roles

The installed agent frontmatter omits `model`, so roles inherit the current
model. These aliases are plan options only:

| Alias | Roles |
| --- | --- |
| `lite` | context indexer, explorer, librarian |
| `default` | context miner, implementer, migration planner, orchestrator, QA executor |
| `reasoning` | gate reviewer, planner, reviewer, security auditor, verifier |

These values only state task complexity. They do not require a legacy model,
assert a cost advantage, or authorize custom-provider registration.
