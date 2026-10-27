const text = { type: 'string', minLength: 1, maxLength: 8192 };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const flag = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const list = items => ({ type: 'array', maxItems: 10000, items });
const choice = (...values) => ({ enum: values });
const object = (properties, optional = []) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties).filter(key => !optional.includes(key)), properties });
const ref = name => ({ $ref: `#/$defs/${name}` });
const execution = choice('not_started', 'running', 'finished', 'failed', 'cancelled');
const verification = choice('unverified', 'verifying', 'verified', 'failed', 'stale', 'unavailable');
const target = object({ project_id: id, run_id: nullable(id), id });
const evidence = object({ path: text, sha256: nullable({ type: 'string', pattern: '^[a-f0-9]{64}$' }), provenance: text });
const fields = {
  amend_task: object({ scope: text, priority: integer }, ['scope', 'priority']),
  add_dependency: object({ prerequisite_id: id }), remove_dependency: object({ prerequisite_id: id }),
  add_criterion: object({ criterion_id: id, requirement: text, applicability: choice('required', 'optional', 'not_applicable'), scenarios: list(ref('scenario')) }),
  amend_criterion: object({ criterion_id: id, requirement: text, expected_version: integer }),
  add_scenario: object({ criterion_id: id, scenario: ref('scenario') }),
  amend_scenario: object({ criterion_id: id, scenario: ref('scenario') }),
  create_queued_plan: object({ plan: ref('queued_plan') }),
  amend_queued_plan: object({ title: text, readiness: choice('draft', 'ready', 'held'), priority: integer,
    prerequisites: list(id), decision_id: nullable(id) }, ['title', 'readiness', 'priority', 'prerequisites', 'decision_id']),
  reorder_queued_plan: object({ plan_ids: list(id) }),
  attach_evidence: object({ criterion_id: id, evidence }),
  propose_decision: object({ decision: ref('decision') }),
  supersede_decision: object({ decision_id: id, replacement: ref('decision') }),
};
const timestamp = { type: 'string', format: 'date-time', pattern: 'Z$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const definitions = {
  activation: object({ schema_version: { const: 1 }, activation_id: id, project_id: id, plan_id: id,
    expected_revision: integer, expected_plan_revision: integer,
    run_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' },
    source_path: text, source_sha256: hash, objective: text }),
  activation_result: object({ activation_id: id, plan_id: id, run_id: id, status: { const: 'linked' } }),
  queue_intent: object({ request: ref('activation'), content_hash: hash, actor: text, plan: ref('queued_plan'),
    content: { type: 'string', minLength: 1, maxLength: 1048576 }, status: choice('pending', 'linked'), result: ref('activation_result') }),
  queue_store: object({ schema_version: { const: 1 }, project_id: id, revision: integer,
    plans: { type: 'array', maxItems: 128, items: ref('queued_plan') },
    commands: { type: 'array', maxItems: 512, items: object({ command: ref('command'), content_hash: hash, actor: text, result: ref('acknowledgement') }) },
    intents: { type: 'array', maxItems: 128, items: ref('queue_intent') } }),
  host_source: object({ schema_version: { const: 1 }, contract_version: { const: '1.0.0' },
    record_type: { const: 'canonical-event' }, event_id: id, host: choice('codebuddy-cli', 'codebuddy-ide', 'workbuddy', 'trae-cli', 'trae-ide', 'trae-work'),
    raw_event: text, canonical_event: text, occurred_at: timestamp,
    surface: object({ surface_id: id, native_mode: choice('invoke-documented', 'observe-only', 'descriptor-only', 'unavailable'),
      host_authority: { const: 'host' }, package_owner: choice('LazyBuddy', 'LazyTrae'),
      direction: choice('host-to-package', 'package-to-host', 'bidirectional', 'none'), merge_key: id, base_digest: hash,
      freshness: object({ status: choice('current', 'pending'), observed_at: nullable(timestamp), expires_at: nullable(timestamp) }),
      source_receipt: object({ receipt_id: id, sha256: hash, redacted: { const: true } }) }), payload: { type: 'object' } }),
  provenance: object({ source_id: id, generation: text, source_event_id: id, line: integer,
    kind: choice('runtime', 'legacy', 'host', 'hook'), timestamp: nullable(text) }),
  scenario: object({ id, requirement: text, verifier_ref: text }),
  attempt: object({ id, task_id: id, criterion_id: nullable(id), criterion_version: nullable(integer),
    plan_revision: integer, consumed_plan_revision: nullable(integer), worker_id: nullable(id), parent_task_id: nullable(id),
    source_revision: nullable(text), execution, verification,
    started_at: nullable(text), finished_at: nullable(text), evidence: list(evidence), provenance: ref('provenance') }),
  criterion: object({ id, task_id: id, version: integer, requirement: text,
    applicability: choice('required', 'optional', 'not_applicable'), verification,
    scenarios: list(ref('scenario')), result_ids: list(id), history: list(ref('criterion_history')) }),
  criterion_history: object({ version: integer, requirement: text, result_ids: list(id) }),
  progress: object({ denominator: { const: 'required_criteria' }, total: integer, verified: integer,
    stale: integer, failed: integer, unavailable: integer, pending: integer,
    optional: integer, not_applicable: integer, criterion_versions: list(object({ id, version: integer })) }),
  task: object({ id, title: text, scope: text, priority: integer, depends_on: list(id), execution,
    verification, blocker: nullable(text), criteria: list(ref('criterion')), attempts: list(ref('attempt')),
    progress: ref('progress') }),
  decision: object({ id, title: text, choice: nullable(text), rationale: text, scope: list(id),
    alternatives: list(text), reference: nullable(text), state: choice('proposed', 'accepted', 'superseded'),
    supersedes: nullable(id), revision: integer }),
  queued_plan: object({ id, project_id: id, title: text, priority: integer,
    readiness: choice('draft', 'ready', 'held'), prerequisites: list(id), decision_id: nullable(id), revision: integer }),
  command: { oneOf: Object.entries(fields).map(([operation, payload]) => object({
    schema_version: { const: 1 }, command_id: id, target, expected_revision: integer,
    operation: { const: operation }, payload })) },
  acknowledgement: object({ schema_version: { const: 1 }, command_id: id, target,
    status: choice('saved', 'pending_agent', 'applied', 'conflict', 'rejected'), revision: integer,
    plan_revision: integer, consumed_plan_revision: nullable(integer), reason: nullable(text) }),
  source_cursor: object({ id, generation: text, lines: integer, sha256: text }),
  cursor: object({ schema_version: { const: 1 }, project_id: id, run_id: id, revision: integer,
    state_sha256: text, queue_revision: integer, queue_sha256: text, sources: list(ref('source_cursor')) }),
  capability: choice('available', 'unavailable', 'unobserved'),
  capabilities: object({ embedding: ref('capability'), chat_handoff: ref('capability'),
    wake: ref('capability'), observations: ref('capability') }),
  observation: object({ event: text, provenance: ref('provenance'), payload: { type: 'object' } }),
  issue: object({ code: text, source_id: nullable(id), line: nullable(integer) }),
  snapshot: object({ schema_version: { const: 1 }, project_id: id, run_id: id,
    revision: integer, plan_revision: integer, queue_revision: integer, cursor: ref('cursor'),
    freshness: choice('snapshot', 'resync_required'), capabilities: ref('capabilities'),
    tasks: list(ref('task')), decisions: list(ref('decision')), queue: list(ref('queued_plan')),
    acknowledgements: list(ref('acknowledgement')), observations: list(ref('observation')), issues: list(ref('issue')),
    queue_readiness: list(object({ plan_id: id, eligible: flag, reason: nullable(text) })) }, ['queue_readiness']),
};
export const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'lazyseries-dashboard.v1.schema.json', $defs: definitions, $ref: '#/$defs/snapshot' };
